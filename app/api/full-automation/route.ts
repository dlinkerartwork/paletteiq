import { and, asc, eq, sql } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { getDb } from '@/db';
import { projects, imageBatches, studioSettings, paletteAccounts, paletteStores } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { assertSameOrigin } from '@/lib/palette-accounts';
import { runWithCloudAutomationUser } from '@/lib/cloud-automation-context';
import { isActiveBatchStatus, retryableFailedImage, eligibleForBulk } from '@/lib/production-rules';
import { selectDiverseConcepts, normalizeCreativeControls } from '@/lib/creative-intelligence';
import { primaryCharacterSubject } from '@/lib/primary-character-focus';
import { projectPromptContext, isActivePromptBatch, type PromptProject } from '@/lib/prompt-batch-jobs';
import { normalizeListing } from '@/lib/etsy-listing';
import { safeRejectedImageResearch } from '@/lib/research-image-input';
import { GET as researchGet } from '@/app/api/research-jobs/route';
import { GET as promptGet, POST as promptPost } from '@/app/api/prompt-jobs/route';
import { GET as imageGet, POST as imagePost } from '@/app/api/image-batches/route';
import { POST as studioPost } from '@/app/api/studio/route';
import { POST as rewritePost } from '@/app/api/regenerate-prompt/route';
import { isImageBatchModel, imageBatchModelError, DEFAULT_IMAGE_BATCH_MODEL } from '@/lib/image-batch-models';

type Stage = 'research'|'expanding'|'prompts'|'images'|'revising'|'regenerating'|'verifying'|'listing'|'completed'|'paused';
type Flow = { enabled: boolean; stage: Stage; target: number; textModel?: string; promptModel?: string; batchImageModel?: string; imageQuality?: string; startedAt: number; updatedAt: number;
  resumeStage?: Stage; lastError?: string; leaseUntil?: number; expandAttempts?: number;
  promptAttempts?: number; imageAttempts?: number; revisionAttempts?: number;
  reviewQueue?: string[]; revisedIds?: string[]; regenerationBatchId?: string };
type Subject = PromptProject['characters'][number] & { imageUrl?: string; origin?: string;
  similarityReview?: { status?: string; score?: number; reason?: string } };
type Project = Omit<PromptProject, 'characters'> & Pick<PromptProject, 'id' | 'name' | 'title' | 'theme' | 'subtheme' | 'microtheme' | 'style' | 'palette' | 'texture' | 'primaryKeyword' | 'keywords' | 'longTailKeywords' | 'notes' | 'emotionDirection' | 'ageDirection' | 'cutenessDirection' | 'creativeControls' | 'research' | 'promptJob'> & { characters: Subject[]; fullAutomation?: Flow;
  researchJob?: { status: string; error?: string; responseId?: string; selectedImages?: string[]; model?: string }; listing?: { title?: string };
  url?: string; images?: string[]; selectedImageUrls?: string[]; characterTarget?: number; researchModel?: string; progressivePrompts?: boolean };
type Prefs = { automationPromptModel?: string; automationImageModel?: string;
  quality?: string; seoProvider?: string; seoOpenaiModel?: string; seoGeminiModel?: string };
const idValid = (x: unknown): x is string => typeof x === 'string' && /^[\w-]{8,80}$/.test(x);
const isActive = (f?: Flow) => !!f?.enabled && f.stage !== 'completed' && f.stage !== 'paused';
const resumeStage = (f?: Flow): Stage =>
  f?.resumeStage && f.resumeStage !== 'paused' && f.resumeStage !== 'completed'
    ? f.resumeStage : 'research';
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const busy = new Set<string>();
// Up to three independent collections advance per scheduler cycle. Each
// collection keeps its own optimistic lease, paid-job receipts and target.
const MULTI_COLLECTION_TICK_LIMIT = 3;
const TICK_SCAN_LIMIT = 100;
async function load(owner: string, id: string) {
  const rows = await getDb().select().from(projects).where(and(eq(projects.owner, owner), eq(projects.id, id))).limit(1);
  return rows[0] ? { row: rows[0], p: JSON.parse(rows[0].data) as Project } : null;
}
async function save(owner: string, id: string, fn: (p: Project) => Project) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const old = await load(owner, id);
    if (!old) throw Error('Collection missing');
    const next = fn(old.p);
    const updated = await getDb().update(projects).set({
      name: next.name.slice(0, 160), data: JSON.stringify(next),
      updatedAt: Math.max(Date.now(), old.row.updatedAt + 1),
    }).where(and(eq(projects.owner, owner), eq(projects.id, id),
      eq(projects.updatedAt, old.row.updatedAt))).returning({ id: projects.id });
    if (updated.length) return next;
  }
  throw Error('Another tab changed the collection during full automation; review before resuming.');
}
async function setStage(owner: string, id: string, phase: Stage, extras: Partial<Flow> = {}) {
  return save(owner, id, p => ({ ...p, fullAutomation: {
    ...p.fullAutomation!, ...extras, stage: phase, leaseUntil: 0, updatedAt: Date.now(),
  } }));
}
function canRestartMissingResearch(p: Project) {
  return p.fullAutomation?.enabled && p.fullAutomation.stage === 'paused' &&
    resumeStage(p.fullAutomation) === 'research' &&
    !p.researchJob && !p.characters.length &&
    !!p.url && !!(p.selectedImageUrls ?? p.images ?? []).length;
}
function canRetryRejectedResearch(p: Project) {
  return p.fullAutomation?.enabled && p.fullAutomation.stage === 'paused' &&
    resumeStage(p.fullAutomation) === 'research' &&
    !p.characters.length && !!p.url &&
    !!(p.researchJob?.selectedImages?.length ||
      (p.selectedImageUrls ?? p.images ?? []).length) &&
    safeRejectedImageResearch(p.researchJob);
}
function researchRecovery(p: Project) {
  const flow = p.fullAutomation;
  const job = p.researchJob;
  if (!flow?.enabled || flow.stage !== 'paused' ||
      resumeStage(flow) !== 'research') return null;
  if (job) {
    if (canRetryRejectedResearch(p)) return { state:'rejected-image-url',
      message:'OpenAI rejected the image URL with HTTP 400 before creating a background job. PaletteIQ can retry once using downloaded image data. Check OpenAI usage first.' };
    // A failed job may still have reached OpenAI before a network error.
    // Never offer automatic resubmission for an existing research receipt.
    return { state: job.status, message: job.status === 'failed'
      ? 'Saved research job failed. Check OpenAI usage and the original job error before attempting new paid research.'
      : job.status === 'submitting'
        ? 'Research submission may be pending or ambiguous. Do not create a second paid job.'
        : job.status === 'completed'
          ? 'Research completed. Resume the workflow to import or advance.'
          : 'A saved research job exists. Resume to check its status; do not submit another research request.' };
  }
  if (!p.url) return { state:'missing-source', message:'No Etsy source URL is saved. Load the Etsy listing and save the collection before recovery.' };
  if (!(p.selectedImageUrls ?? p.images ?? []).length) return { state:'missing-references',
    message:'No selected Etsy reference images are saved. Load and select reference images before recovery.' };
  if (p.characters.length) return { state:'existing-characters',
    message:'This collection already has characters. Do not reset its research state.' };
  return { state:'ready', message:'No saved research job is present. Check OpenAI usage before starting missing research once.' };
}
function progress(p: Project) {
  return { flow: p.fullAutomation || null,
    researchRecovery: researchRecovery(p),
    researchJobStatus: p.researchJob?.status || 'not_started',
    researchJobError: p.researchJob?.error || null,
    canRetryRejectedResearch: Boolean(canRetryRejectedResearch(p)),
    canRestartMissingResearch: Boolean(canRestartMissingResearch(p)), characterCount: p.characters.length,
    promptCount: p.characters.filter(c => !!c.prompt?.trim()).length,
    imageCount: p.characters.filter(c => !!c.imageUrl).length,
    flaggedCount: p.characters.filter(c => c.similarityReview?.status === 'needs_review').length,
    listingReady: Boolean(p.listing?.title) };
}
async function prefs(owner: string): Promise<Prefs> {
  const rows = await getDb().select({preferences:studioSettings.preferences}).from(studioSettings)
    .where(eq(studioSettings.owner, owner)).limit(1);
  try { return rows[0]?.preferences ? JSON.parse(rows[0].preferences) as Prefs : {}; }
  catch { return {}; }
}
async function apiPost(req: Request, handler: (req: Request) => Promise<Response>, payload: object) {
  const response = await handler(new Request(req.url, { method:'POST',
    headers: { 'content-type':'application/json' }, body:JSON.stringify(payload) }));
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw Error(String(data.error || 'Internal workflow operation failed').slice(0, 330));
  return data;
}
async function apiGet(req: Request, handler: (req: Request) => Promise<Response>, projectId: string, imageSync = false) {
  const url = new URL(req.url);
  url.searchParams.set('projectId', projectId);
  if (imageSync) url.searchParams.set('sync', '1');
  const response = await handler(new Request(url));
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw Error(String(data.error || 'Workflow status retrieval failed').slice(0, 330));
  return data;
}
async function jobs(owner: string, id: string) {
  return getDb().select().from(imageBatches)
    .where(and(eq(imageBatches.owner,owner),eq(imageBatches.projectId,id)));
}
// A Batch model is a user-selected setting, not a fallback. An unsupported
// value must stop before a paid request rather than change the model silently.
const imageModel = (p: Project, prefs: Prefs) => {
  const selected = p.fullAutomation?.batchImageModel || prefs.automationImageModel || DEFAULT_IMAGE_BATCH_MODEL;
  if (!isImageBatchModel(selected)) throw Error(imageBatchModelError(selected));
  return selected;
};
// A collection's text model is frozen when Full Automation starts. Changes to
// Settings must not silently switch models on already accepted paid jobs.
const textModel = (p: Project, fallback = 'gpt-6.1-terra') => {
  const saved = p.fullAutomation?.textModel || p.researchJob?.model;
  return saved && /^gpt-[a-z0-9.-]{1,80}$/.test(saved) ? saved : fallback;
};
const quality = (prefs: Prefs) =>
  ['low','medium','high'].includes(prefs.quality || '') ? prefs.quality! : 'low';

async function tick(req: Request, owner: string, id: string) {
  const key = owner + ':' + id;
  if (busy.has(key)) return { waiting: true };
  const initial = await load(owner,id);
  if (!initial || !isActive(initial.p.fullAutomation)) return initial ? progress(initial.p) : { error: 'Collection missing' };
  const flow = initial.p.fullAutomation!;
  if (flow.leaseUntil && flow.leaseUntil > Date.now()) return { waiting:true, ...progress(initial.p) };
  // Persist lease to prevent double-billing from two browser tabs.
  const claimed = await getDb().update(projects).set({
    data: JSON.stringify({ ...initial.p, fullAutomation: { ...flow, leaseUntil:Date.now()+300000 } }),
    updatedAt: Math.max(Date.now(),initial.row.updatedAt+1),
  }).where(and(eq(projects.owner,owner),eq(projects.id,id),
    eq(projects.updatedAt,initial.row.updatedAt))).returning({id:projects.id});
  if (!claimed.length) return { waiting:true };
  busy.add(key);
  try {
    const stored = await load(owner,id);
    if (!stored) throw Error('Collection missing');
    const p = stored.p, f = p.fullAutomation!;
    if (f.stage === 'research') {
      if (!p.researchJob) {
        if (Date.now() - f.startedAt > 120000) throw Error('Background analysis did not start; check job history.');
      } else if (p.researchJob.status === 'failed') throw Error(p.researchJob.error || 'Background research failed');
      else {
        if (p.researchJob.status !== 'completed') await apiGet(req,researchGet,id);
        const after = await load(owner,id);
        if (after?.p.researchJob?.status === 'completed') await setStage(owner,id,'expanding');
      }
    } else if (f.stage === 'expanding') {
      if (p.characters.length >= f.target) await setStage(owner,id,'prompts');
      else if ((f.expandAttempts || 0) >= Math.min(60,Math.ceil(f.target/10)+8))
        throw Error('Character expansion did not reach the target: ' + p.characters.length + '/' + f.target);
      else {
        const n=Math.min(15,f.target-p.characters.length);
        const out=await apiPost(req,studioPost,{
          action:'expand',count:n,target:f.target,title:p.title||p.name,
          analysis:projectPromptContext(p),images:p.selectedImageUrls||p.images,
          model:textModel(p),
          existing:p.characters.map(c=>({name:c.name,family:c.family,expression:c.expression})),
        });
        const proposals=(Array.isArray(out.characters)?out.characters:[]) as Array<Record<string,string>>;
        const candidates=proposals.map(c=>({
          id:crypto.randomUUID(),name:String(c.name||''),family:c.family||'',
          expression:c.expression||'',shape:c.shape||'',silhouette:c.silhouette||'',
          accessories:c.accessories||'',colorPlan:c.colorPlan||'',description:c.description||'',
          prompt:'',status:'draft',origin:'ai',
        }));
        const selected=selectDiverseConcepts(candidates,p.characters,f.target,n,
          normalizeCreativeControls(p.creativeControls).characterVariation,
          primaryCharacterSubject(p.title||p.name));
        const revised=await save(owner,id,latest=>{
          const seen=new Set(latest.characters.map(c=>c.name.trim().toLowerCase()));
          const unique=selected.filter(c=>{const name=c.name.trim().toLowerCase();if(!name||seen.has(name))return false;seen.add(name);return true;});
          return {...latest,characters:[...latest.characters,...unique],
            fullAutomation:{...latest.fullAutomation!,expandAttempts:(latest.fullAutomation?.expandAttempts||0)+1,updatedAt:Date.now()}};
        });
        if (revised.characters.length>=f.target) await setStage(owner,id,'prompts');
      }
    } else if (f.stage === 'prompts') {
      const missing=p.characters.filter(c=>!c.prompt?.trim());
      // Never automatically create another paid Prompt Batch when the earlier
      // job failed, became uncertain, expired, or completed with missing items.
      // In particular, progressive mode may have accepted a Batch ID that
      // failed to persist; only a person can review that charge risk.
      if (p.promptJob && ['failed','cancelled','expired','completed_with_errors'].includes(p.promptJob.status))
        throw Error('Prompt Batch needs review before any paid retry. '+missing.length+' prompts remain. Check OpenAI Batch activity first.');
      if (!missing.length) await setStage(owner,id,'images');
      else if (p.promptJob && isActivePromptBatch(p.promptJob)) await apiGet(req,promptGet,id);
      else if (p.promptJob && p.promptJob.status==='completed')
        throw Error('Prompt Batch completed with '+missing.length+' missing prompts. Review saved results before another paid request.');
      else if ((f.promptAttempts||0)<3) {
        await save(owner,id,latest=>({...latest,fullAutomation:{
          ...latest.fullAutomation!,promptAttempts:(latest.fullAutomation?.promptAttempts||0)+1,updatedAt:Date.now()}}));
        const config=await prefs(owner);
        const model=p.fullAutomation?.promptModel || config.automationPromptModel || 'gpt-6-luna';
        await apiPost(req,promptPost,{projectId:id,characterIds:missing.slice(0,200).map(c=>c.id),model,regenerate:false,progressive:p.progressivePrompts===true});
      } else throw Error('Incomplete prompts after three attempts. Review missing prompts before resuming.');
    } else if (f.stage === 'images') {
      const records=await jobs(owner,id);
      if (records.some(row=>isActiveBatchStatus(row.status))) await apiGet(req,imageGet,id,true);
      else {
        const missing=p.characters.filter(c=>!c.imageUrl&&!!c.prompt?.trim());
        if (p.characters.some(c=>!c.prompt?.trim())) await setStage(owner,id,'prompts');
        else if (missing.length) {
          if ((f.imageAttempts||0)>=Math.ceil(f.target/120)+3)
            throw Error('Too many image Batch attempts; review failed images before further API charges.');
          const fresh=missing.filter(c=>eligibleForBulk(c)).slice(0,120);
          const retry=missing.filter(c=>retryableFailedImage(c)).slice(0,120);
          const selected=fresh.length?fresh:retry;
          if (!selected.length) throw Error('Cannot safely retry unimported images. Check Batch activity.');
          await save(owner,id,latest=>({...latest,fullAutomation:{
            ...latest.fullAutomation!,imageAttempts:(latest.fullAutomation?.imageAttempts||0)+1,updatedAt:Date.now()}}));
          const config=await prefs(owner);
          await apiPost(req,imagePost,{projectId:id,characterIds:selected.map(c=>c.id),
            model:imageModel(p,config),quality:f.imageQuality || quality(config),regenerate:!fresh.length});
        } else {
          const unverified=p.characters.filter(c=>c.imageUrl &&
            c.similarityReview?.status!=='clear' && c.similarityReview?.status!=='needs_review');
          if (unverified.length) throw Error(unverified.length+' image(s) have unverified similarity checks. Review required.');
          const flagged=p.characters.filter(c=>c.imageUrl&&c.similarityReview?.status==='needs_review').map(c=>c.id);
          if (flagged.length) await setStage(owner,id,'revising',{reviewQueue:flagged,revisedIds:[],revisionAttempts:0});
          else await setStage(owner,id,'listing');
        }
      }
    } else if (f.stage === 'revising') {
      const pending=(f.reviewQueue||[]).filter(x=>!(f.revisedIds||[]).includes(x));
      if (!pending.length) await setStage(owner,id,'regenerating');
      else if ((f.revisionAttempts||0)>=Math.max(5,(f.reviewQueue||[]).length)*3)
        throw Error('Could not rewrite all flagged prompts; manual review required.');
      else {
        await save(owner,id,latest=>({...latest,fullAutomation:{
          ...latest.fullAutomation!,revisionAttempts:(latest.fullAutomation?.revisionAttempts||0)+1,updatedAt:Date.now()}}));
        await apiPost(req,rewritePost,{projectId:id,characterIds:pending.slice(0,3),automation:true});
      }
    } else if (f.stage === 'regenerating') {
      if (!(f.reviewQueue||[]).length) await setStage(owner,id,'listing');
      else {
        // A single review regeneration Batch has a hard upper bound. Never
        // silently split or repeatedly charge for a larger flagged queue.
        if ((f.reviewQueue||[]).length > 120)
          throw Error('More than 120 images were flagged for similarity. Review and split manually; Full Automation will not submit multiple regeneration Batches.');
        const records=await jobs(owner,id);
        const active=records.find(row=>isActiveBatchStatus(row.status)&&
          (JSON.parse(row.items) as Array<{id:string}>).some(item=>(f.reviewQueue||[]).includes(item.id)));
        if (active) await setStage(owner,id,'verifying',{regenerationBatchId:active.id});
        else if (f.regenerationBatchId) await setStage(owner,id,'verifying');
        else {
          const config=await prefs(owner);
          const result=await apiPost(req,imagePost,{projectId:id,characterIds:f.reviewQueue,
            model:imageModel(p,config),quality:f.imageQuality || quality(config),regenerate:true});
          const batch=result.job as {id?:string}|undefined;
          await setStage(owner,id,'verifying',{regenerationBatchId:batch?.id});
        }
      }
    } else if (f.stage === 'verifying') {
      const records=await jobs(owner,id), batch=records.find(x=>x.id===f.regenerationBatchId);
      if (!batch) throw Error('Regeneration tracking missing. Check OpenAI Batch activity.');
      if (isActiveBatchStatus(batch.status)) await apiGet(req,imageGet,id,true);
      else {
        const stillFlagged=(f.reviewQueue||[]).filter(x=>p.characters.find(c=>c.id===x)?.similarityReview?.status!=='clear');
        if (stillFlagged.length) throw Error(stillFlagged.length+' regenerated image(s) are still too similar or unverified. No more automatic reruns.');
        await setStage(owner,id,'listing');
      }
    } else if (f.stage === 'listing') {
      if (p.characters.some(c=>!c.imageUrl)) throw Error('Cannot draft listing while image files are missing.');
      if (p.listing?.title) await setStage(owner,id,'completed');
      else {
        const config=await prefs(owner);
        const result=await apiPost(req,studioPost,{action:'listing-draft',project:p,
          seoProvider:config.seoProvider||'gemini',
          seoOpenaiModel:textModel(p,config.seoOpenaiModel||'gpt-4.1-mini'),
          seoGeminiModel:config.seoGeminiModel||'gemini-3.5-flash',
          analyzeWithAi:false});
        const draft=normalizeListing(result.draft);
        if (!draft.title) throw Error('AI returned an empty Etsy listing title');
        await save(owner,id,latest=>({...latest,
          listing:latest.listing?.title?latest.listing:draft,
          fullAutomation:{...latest.fullAutomation!,stage:'completed',leaseUntil:0,updatedAt:Date.now()}}));
      }
    }
    const updated=await load(owner,id);
    return updated?progress(updated.p):{error:'Collection missing'};
  } catch (error) {
    const message=error instanceof Error?error.message.slice(0,380):'Full automation failed';
    await save(owner,id,p=>({...p,fullAutomation:{...p.fullAutomation!,
      stage:'paused',resumeStage:p.fullAutomation?.stage||'research',
      lastError:message,leaseUntil:0,updatedAt:Date.now()}})).catch(()=>{});
    const updated=await load(owner,id);
    return {error:message,...(updated?progress(updated.p):{})};
  } finally {
    busy.delete(key);
    await save(owner,id,p=>p.fullAutomation?({...p,fullAutomation:{...p.fullAutomation,leaseUntil:0}}):p).catch(()=>{});
  }
}
// Only the independently deployed Cloudflare Cron Worker may request this tick.
// HMAC verification is mandatory: the endpoint never trusts a client-supplied
// account/store identifier and does not expose a general privileged API.
const CLOUD_TICK_MESSAGE = ':paletteiq-full-automation-v1';
async function verifiedCloudTick(req: Request) {
  const secret = (env as unknown as Record<string, string | undefined>).PALETTEIQ_CLOUD_AUTOMATION_SECRET;
  const time = req.headers.get('x-paletteiq-cloud-timestamp') || '';
  const signature = req.headers.get('x-paletteiq-cloud-signature') || '';
  if (!secret || secret.length < 32 || !/^\\d{13}$/.test(time) ||
      !/^[0-9a-f]{64}$/i.test(signature) ||
      Math.abs(Date.now() - Number(time)) > 90_000) return false;
  const bytes = Uint8Array.from(signature.match(/.{2}/g)!, hex => parseInt(hex, 16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, bytes,
    new TextEncoder().encode(time + CLOUD_TICK_MESSAGE));
}
function uuidFromCompact(compact: string) {
  return compact.slice(0,8)+'-'+compact.slice(8,12)+'-'+compact.slice(12,16)+'-'+
    compact.slice(16,20)+'-'+compact.slice(20);
}
async function tickCloudCollections(req: Request) {
  // Cloud mode MUST have persistent D1 and R2 bindings. Never use a desktop
  // loopback DB from an external scheduler.
  if (!env.DB || !env.BUCKET) return { active: 0, error: 'Cloud D1/R2 bindings are not configured' };
  const db = getDb();
  const candidates = await db.select().from(projects).where(sql`
    json_extract(${projects.data}, '$.fullAutomation.enabled') = 1
    AND json_extract(${projects.data}, '$.fullAutomation.stage') NOT IN ('completed','paused')
  `).orderBy(asc(projects.updatedAt)).limit(MULTI_COLLECTION_TICK_LIMIT);
  const results: Array<{ projectId: string; waiting?: boolean; error?: string; stage?: string }> = [];
  for (const row of candidates) {
    const parsed = /^user_([0-9a-f]{32})_store_([0-9a-f]{32})$/i.exec(row.owner);
    if (!parsed) { results.push({ projectId: row.id, error: 'Invalid store scope' }); continue; }
    const accountId = uuidFromCompact(parsed[1]);
    const storeId = uuidFromCompact(parsed[2]);
    const [accounts, stores] = await Promise.all([
      db.select().from(paletteAccounts).where(eq(paletteAccounts.id, accountId)).limit(1),
      db.select().from(paletteStores).where(and(eq(paletteStores.id, storeId),
        eq(paletteStores.accountId, accountId))).limit(1),
    ]);
    if (!accounts[0] || !stores[0]) {
      results.push({ projectId: row.id, error: 'Account or store no longer exists' });
      continue;
    }
    try {
      const status = await runWithCloudAutomationUser({
        userId: row.owner, email: accounts[0].email,
        displayName: stores[0].name, fullName: null,
      }, () => tick(req, row.owner, row.id));
      results.push({ projectId: row.id,
        waiting: 'waiting' in status ? Boolean(status.waiting) : false,
        error: 'error' in status ? String(status.error) : undefined,
        stage: 'flow' in status ? status.flow?.stage : undefined });
    } catch (error) {
      results.push({ projectId: row.id,
        error: error instanceof Error ? error.message.slice(0,240) : 'Cloud tick failed' });
    }
  }
  return { active: candidates.length, results };
}

export async function GET(req:Request) {
  const user=await getChatGPTUser();
  if (!user) return bad('Sign in required',401);
  const id=new URL(req.url).searchParams.get('projectId');
  if (!idValid(id)) return bad('Invalid collection ID');
  const found=await load(user.userId,id);
  return found?Response.json(progress(found.p),{headers:{'Cache-Control':'no-store'}}):bad('Collection not found',404);
}
export async function POST(req:Request) {
  // Privileged path has no browser session and is accepted only with a
  // short-lived signature from the separately configured cloud scheduler.
  if (req.headers.has('x-paletteiq-cloud-timestamp') ||
      req.headers.has('x-paletteiq-cloud-signature')) {
    if (!(await verifiedCloudTick(req))) return bad('Invalid cloud scheduler signature',403);
    let payload: { action?: string };
    try { payload = await req.json(); } catch { return bad('Invalid cloud scheduler request'); }
    if (payload.action !== 'cloud-tick') return bad('Invalid cloud scheduler action',403);
    return Response.json(await tickCloudCollections(req), { headers: { 'Cache-Control':'no-store' } });
  }
  const user=await getChatGPTUser();
  if (!user) return bad('Sign in required',401);
  if (!assertSameOrigin(req)) return bad('Cross-site automation request denied',403);
  let body:{action?:string;projectId?:string;target?:number;model?:string;syncAll?:boolean};
  try {body=await req.json();} catch {return bad('Invalid JSON');}
  if (body.action==='tick' && body.syncAll===true) {
    // Least recently updated collections go first. Their tick mutates
    // updatedAt, rotating the queue so long-running Research/Batch jobs do
    // not starve later collections when there are more than three.
    const rows=await getDb().select().from(projects).where(eq(projects.owner,user.userId))
      .orderBy(asc(projects.updatedAt)).limit(TICK_SCAN_LIMIT);
    const active=rows.map(x=>({id:x.id,flow:(JSON.parse(x.data) as Project).fullAutomation}))
      .filter(x=>isActive(x.flow));
    // A collection with a live lease is already running elsewhere. Skip it
    // rather than letting three long requests block all other collections.
    const available=active.filter(item=>!item.flow?.leaseUntil || item.flow.leaseUntil<=Date.now());
    const selected=available.slice(0,MULTI_COLLECTION_TICK_LIMIT);
    const results=await Promise.all(selected.map(async item=>{
      try { return {projectId:item.id,...await tick(req,user.userId,item.id)}; }
      catch(error){return {projectId:item.id,error:error instanceof Error?error.message.slice(0,240):'Workflow tick failed'};}
    }));
    return Response.json({active:active.length,processed:selected.length,results});
  }
  if (!idValid(body.projectId)) return bad('Invalid collection ID');
  const id=body.projectId;
  const current=await load(user.userId,id);
  if (!current) return bad('Collection not found',404);
  if (body.action==='start') {
    const target=Number(body.target);
    if (!Number.isInteger(target)||target<1||target>200) return bad('Full automation supports 1–200 characters');
    const requestedModel=String(body.model||'gpt-6.1-terra');
    if (!/^gpt-[a-z0-9.-]{1,80}$/.test(requestedModel)) return bad('Choose a valid OpenAI text/vision model');
    if (current.p.fullAutomation && current.p.fullAutomation.stage !== 'completed')
      return bad('An automation workflow already exists. Resume the paused workflow rather than submitting duplicate paid work.',409);
    if (current.p.characters.some(c=>c.imageUrl)) return bad('Full automation must start before image generation',409);
    const config=await prefs(user.userId);
    const selectedBatchImageModel=config.automationImageModel || DEFAULT_IMAGE_BATCH_MODEL;
    if (!isImageBatchModel(selectedBatchImageModel)) return bad(imageBatchModelError(selectedBatchImageModel),422);
    const now=Date.now();
    const savedPromptModel=String(config.automationPromptModel||'gpt-6-luna');
    if(!/^gpt-[a-z0-9.-]{1,80}$/.test(savedPromptModel))return bad('Invalid saved AI Prompt Batch model',422);
    const flow:Flow={enabled:true,stage:'research',target,textModel:requestedModel,promptModel:savedPromptModel,batchImageModel:selectedBatchImageModel,imageQuality:'low',startedAt:now,updatedAt:now,
      expandAttempts:0,promptAttempts:0,imageAttempts:0};
    return Response.json(progress(await save(user.userId,id,p=>({...p,characterTarget:target,researchModel:requestedModel,fullAutomation:flow}))));
  }
  if (body.action==='pause') {
    if (!current.p.fullAutomation) return bad('No Full Automation workflow exists',409);
    // Repeated Pause must not store "paused" as a resumable stage or erase
    // the original reason why a failed paid job stopped.
    if (current.p.fullAutomation.stage === 'paused')
      return Response.json(progress(current.p));
    return Response.json(progress(await save(user.userId,id,p=>({
      ...p,fullAutomation:{...p.fullAutomation!,stage:'paused',
        resumeStage:p.fullAutomation!.stage,lastError:'Paused by user',leaseUntil:0,updatedAt:Date.now()}}))));
  }
  if (body.action==='restart-missing-research') {
    // This cannot retry a submitted, failed or ambiguous paid research request:
    // only a collection with NO research job receipt can use this path.
    if (!canRestartMissingResearch(current.p))
      return bad('Research recovery is not safe: a saved job or incompatible workflow already exists. Inspect the research job before retrying.',409);
    const now=Date.now();
    const next=await save(user.userId,id,p=>{
      if (!canRestartMissingResearch(p)) throw Error('Research recovery state changed; reload before retrying.');
      return { ...p,fullAutomation:{...p.fullAutomation!,
        stage:'research',startedAt:now,updatedAt:now,leaseUntil:0,lastError:undefined} };
    });
    return Response.json(progress(next));
  }
  if (body.action==='resume') {
    if (current.p.fullAutomation?.stage!=='paused') return bad('No paused automation to resume',409);
    return Response.json(progress(await save(user.userId,id,p=>({
      ...p,fullAutomation:{...p.fullAutomation!,stage:resumeStage(p.fullAutomation),
        lastError:undefined,leaseUntil:0,updatedAt:Date.now()}}))));
  }
  if (body.action==='tick') return Response.json(await tick(req,user.userId,id));
  return bad('Unknown automation action');
}
