import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects, imageBatches, studioSettings } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { assertSameOrigin } from '@/lib/palette-accounts';
import { isActiveBatchStatus, retryableFailedImage, eligibleForBulk } from '@/lib/production-rules';
import { selectDiverseConcepts, normalizeCreativeControls } from '@/lib/creative-intelligence';
import { projectPromptContext, isActivePromptBatch, type PromptProject } from '@/lib/prompt-batch-jobs';
import { normalizeListing } from '@/lib/etsy-listing';
import { GET as researchGet } from '@/app/api/research-jobs/route';
import { GET as promptGet, POST as promptPost } from '@/app/api/prompt-jobs/route';
import { GET as imageGet, POST as imagePost } from '@/app/api/image-batches/route';
import { POST as studioPost } from '@/app/api/studio/route';
import { POST as rewritePost } from '@/app/api/regenerate-prompt/route';

type Stage = 'research'|'expanding'|'prompts'|'images'|'revising'|'regenerating'|'verifying'|'listing'|'completed'|'paused';
type Flow = { enabled: boolean; stage: Stage; target: number; startedAt: number; updatedAt: number;
  resumeStage?: Stage; lastError?: string; leaseUntil?: number; expandAttempts?: number;
  promptAttempts?: number; imageAttempts?: number; revisionAttempts?: number;
  reviewQueue?: string[]; revisedIds?: string[]; regenerationBatchId?: string };
type Subject = PromptProject['characters'][number] & { imageUrl?: string; origin?: string;
  similarityReview?: { status?: string; score?: number; reason?: string } };
type Project = Omit<PromptProject, 'characters'> & Pick<PromptProject, 'id' | 'name' | 'title' | 'theme' | 'subtheme' | 'microtheme' | 'style' | 'palette' | 'texture' | 'primaryKeyword' | 'keywords' | 'longTailKeywords' | 'notes' | 'emotionDirection' | 'ageDirection' | 'cutenessDirection' | 'creativeControls' | 'research' | 'promptJob'> & { characters: Subject[]; fullAutomation?: Flow;
  researchJob?: { status: string; error?: string }; listing?: { title?: string };
  url?: string; images?: string[]; selectedImageUrls?: string[] };
type Prefs = { automationPromptModel?: string; automationImageModel?: string;
  quality?: string; seoProvider?: string; seoOpenaiModel?: string; seoGeminiModel?: string };
const idValid = (x: unknown): x is string => typeof x === 'string' && /^[\w-]{8,80}$/.test(x);
const isActive = (f?: Flow) => !!f?.enabled && f.stage !== 'completed' && f.stage !== 'paused';
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const busy = new Set<string>();
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
function progress(p: Project) {
  return { flow: p.fullAutomation || null, characterCount: p.characters.length,
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
const imageModel = (prefs: Prefs) =>
  ['gpt-image-2.5-flare','gpt-image-2.5-sunburst'].includes(prefs.automationImageModel || '')
    ? prefs.automationImageModel! : 'gpt-image-2.5-flare';
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
          normalizeCreativeControls(p.creativeControls).characterVariation);
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
      if (!missing.length) await setStage(owner,id,'images');
      else if (p.promptJob && isActivePromptBatch(p.promptJob)) await apiGet(req,promptGet,id);
      else if ((f.promptAttempts||0)<3) {
        await save(owner,id,latest=>({...latest,fullAutomation:{
          ...latest.fullAutomation!,promptAttempts:(latest.fullAutomation?.promptAttempts||0)+1,updatedAt:Date.now()}}));
        const config=await prefs(owner);
        const model=/^gpt-[a-z0-9.-]{1,80}$/.test(config.automationPromptModel||'')?config.automationPromptModel!:'gpt-4.1-mini';
        await apiPost(req,promptPost,{projectId:id,characterIds:missing.slice(0,200).map(c=>c.id),model,regenerate:false});
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
            model:imageModel(config),quality:quality(config),regenerate:!fresh.length});
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
            model:imageModel(config),quality:quality(config),regenerate:true});
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
          seoProvider:config.seoProvider||'openai',
          seoOpenaiModel:config.seoOpenaiModel||'gpt-4.1-mini',
          seoGeminiModel:config.seoGeminiModel||'gemini-2.5-pro',
          analyzeWithAi:true});
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
export async function GET(req:Request) {
  const user=await getChatGPTUser();
  if (!user) return bad('Sign in required',401);
  const id=new URL(req.url).searchParams.get('projectId');
  if (!idValid(id)) return bad('Invalid collection ID');
  const found=await load(user.userId,id);
  return found?Response.json(progress(found.p),{headers:{'Cache-Control':'no-store'}}):bad('Collection not found',404);
}
export async function POST(req:Request) {
  const user=await getChatGPTUser();
  if (!user) return bad('Sign in required',401);
  if (!assertSameOrigin(req)) return bad('Cross-site automation request denied',403);
  let body:{action?:string;projectId?:string;target?:number;syncAll?:boolean};
  try {body=await req.json();} catch {return bad('Invalid JSON');}
  if (body.action==='tick' && body.syncAll===true) {
    const rows=await getDb().select().from(projects).where(eq(projects.owner,user.userId))
      .orderBy(asc(projects.updatedAt)).limit(100);
    const active=rows.map(x=>({id:x.id,flow:(JSON.parse(x.data) as Project).fullAutomation}))
      .filter(x=>isActive(x.flow)).slice(0,2);
    const results=[];for(const item of active)results.push(await tick(req,user.userId,item.id));
    return Response.json({active:active.length,results});
  }
  if (!idValid(body.projectId)) return bad('Invalid collection ID');
  const id=body.projectId;
  const current=await load(user.userId,id);
  if (!current) return bad('Collection not found',404);
  if (body.action==='start') {
    const target=Number(body.target);
    if (!Number.isInteger(target)||target<1||target>200) return bad('Full automation supports 1–200 characters');
    if (isActive(current.p.fullAutomation)) return bad('Automation already running',409);
    if (current.p.characters.some(c=>c.imageUrl)) return bad('Full automation must start before image generation',409);
    const now=Date.now();
    const flow:Flow={enabled:true,stage:'research',target,startedAt:now,updatedAt:now,
      expandAttempts:0,promptAttempts:0,imageAttempts:0};
    return Response.json(progress(await save(user.userId,id,p=>({...p,fullAutomation:flow}))));
  }
  if (body.action==='pause') {
    return Response.json(progress(await save(user.userId,id,p=>p.fullAutomation?({
      ...p,fullAutomation:{...p.fullAutomation,stage:'paused',
        resumeStage:p.fullAutomation.stage,lastError:'Paused by user',leaseUntil:0,updatedAt:Date.now()}}):p)));
  }
  if (body.action==='resume') {
    if (current.p.fullAutomation?.stage!=='paused') return bad('No paused automation to resume',409);
    return Response.json(progress(await save(user.userId,id,p=>({
      ...p,fullAutomation:{...p.fullAutomation!,stage:p.fullAutomation?.resumeStage||'research',
        lastError:undefined,leaseUntil:0,updatedAt:Date.now()}}))));
  }
  if (body.action==='tick') return Response.json(await tick(req,user.userId,id));
  return bad('Unknown automation action');
}
