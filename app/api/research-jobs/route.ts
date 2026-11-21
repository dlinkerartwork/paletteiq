import { env } from 'cloudflare:workers';
import { sharedProviderSecret } from '@/lib/store-secrets';
import { and, eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { userCredential } from '@/lib/credentials';
import { mergeSourceEmotionProfile, normalizeCreativeAnalysis, normalizeCreativeControls, selectDiverseConcepts } from '@/lib/creative-intelligence';
import { researchAnalysisInstruction } from '@/lib/creative-research-prompts';
import { fetchResearchImageDataUrls, safeRejectedImageResearch } from '@/lib/research-image-input';
import { splitResearchImages, hybridMergeInstruction, type HybridWorker } from '@/lib/hybrid-research';
import { primaryCharacterSubject } from '@/lib/primary-character-focus';
import { researchBatchJsonl, batchResearchResult, type BatchReceipt } from '@/lib/openai-batch-research';
import { parseResearchWorkerOutput } from '@/lib/research-worker-output';

type Concept = { name: string; family?: string; expression?: string; shape?: string; silhouette?: string; accessories?: string; colorPlan?: string; description?: string };
type StoredCharacter = { id: string; name: string; family?: string; expression?: string; shape?: string; silhouette?: string; accessories?: string; colorPlan?: string; description?: string; status?: string; prompt?: string; origin?: string; imageUrl?: string };
type Source = { title: string; description: string; tags: string[]; images: string[] };
type ResearchJob = {
  id: string; status: 'submitting' | 'queued' | 'in_progress' | 'completed' | 'failed';
  model: string; transport?: 'batch'|'standard'; responseId?: string; mergeBatchId?: string; createdAt: number; updatedAt: number;
  target: number; requested: number; completedCount: number;
  selectedImages: string[]; source: Source; error?: string;
  workers?: HybridWorker[]; mergeStatus?: 'planned'|'submitting'|'queued'|'in_progress'|'completed'|'failed'|'uncertain';
};
type Collection = {
  id: string; name: string; url?: string; title?: string; images?: string[];
  selectedImageUrls?: string[]; sourceDescription?: string; sourceTags?: string[];
  characters: StoredCharacter[]; researchJob?: ResearchJob;
  [key: string]: unknown;
};
type ApiResponse = { id?: string; status?: string; output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }>; error?: { message?: string }; incomplete_details?: { reason?: string } };
const bad = (error: string, status = 400) => Response.json({ error }, { status });

const workerPreview = (worker: HybridWorker) => {
  // These are NONFINAL candidate ideas only. Never expose raw provider JSON
  // as markup, count them as saved assets, or import them before Style DNA merge.
  let parsed: {theme?:unknown;style?:unknown;characters?:unknown} = {};
  try { if (worker.status==='completed' && worker.resultText)
    parsed=JSON.parse(worker.resultText) as typeof parsed; } catch { /* no provisional preview */ }
  const candidates=Array.isArray(parsed.characters)?parsed.characters:[];
  const concepts=candidates.slice(0,60).flatMap((raw): Array<{name:string;family:string;description:string}>=>{
    if (!raw || typeof raw!=='object') return [];
    const item=raw as Record<string,unknown>;
    if (typeof item.name!=='string'||!item.name.trim()) return [];
    return [{name:item.name.trim().slice(0,120),
      family:typeof item.family==='string'?item.family.slice(0,80):'',
      description:typeof item.description==='string'?item.description.slice(0,160):''}];
  });
  return {index:worker.index,status:worker.status,imageCount:worker.images.length,
    theme:typeof parsed.theme==='string'?parsed.theme.slice(0,120):'',
    style:typeof parsed.style==='string'?parsed.style.slice(0,160):'',
    concepts,error:worker.error?.slice(0,180),warning:worker.warning?.slice(0,240)};
};
const safeJob = (job: ResearchJob) => ({
  id: job.id, status: job.status, target: job.target, requested: job.requested,
  completedCount: job.completedCount, model: job.model, createdAt: job.createdAt,
  updatedAt: job.updatedAt, error: job.error,
  workersCompleted: job.workers?.filter(w => w.status === 'completed').length,
  workersTotal: job.workers?.length, mergeStatus: job.mergeStatus,
  transport:job.transport||'background',
  workerPreviews:job.workers?.map(workerPreview),
});
const active = (job?: ResearchJob) => job && ['submitting', 'queued', 'in_progress'].includes(job.status);
const openai = (key: string, path: string, init?: RequestInit) => fetch('https://api.openai.com/v1/' + path, {
  ...init,
  headers: { Authorization: 'Bearer ' + key, ...(init?.headers || {}) },
});
const extractText = (response: ApiResponse) =>
  response.output?.flatMap(item => item.content ?? []).map(item => item.text || '').join('') ||
  (typeof response.output_text === 'string' ? response.output_text : '');
const listingId = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['www.etsy.com', 'etsy.com'].includes(url.hostname)) return null;
    return url.pathname.match(/^\/listing\/(\d+)/)?.[1] || null;
  } catch { return null; }
};
const validImage = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'etsystatic.com' || url.hostname.endsWith('.etsystatic.com'));
  } catch { return false; }
};

async function getCollection(owner: string, projectId: string) {
  if (!/^[\w-]{8,80}$/.test(projectId)) throw new Error('Invalid collection id');
  const rows = await getDb().select().from(projects).where(and(eq(projects.id, projectId), eq(projects.owner, owner))).limit(1);
  return rows[0] ? { row: rows[0], data: JSON.parse(rows[0].data) as Collection } : null;
}
async function mutateJob(owner: string, projectId: string, jobId: string, mutate: (job: ResearchJob) => ResearchJob) {
  // Compare-and-swap is essential: three concurrent workers must not erase
  // each other's response IDs or accidentally start duplicate paid merges.
  for (let attempt = 0; attempt < 6; attempt++) {
    const saved = await getCollection(owner, projectId);
    if (!saved || saved.data.researchJob?.id !== jobId) return null;
    const job = { ...mutate(saved.data.researchJob), updatedAt: Date.now() };
    const stamp = Math.max(Date.now(), saved.row.updatedAt + 1);
    const changed = await getDb().update(projects)
      .set({ data: JSON.stringify({ ...saved.data, researchJob: job }), updatedAt: stamp })
      .where(and(eq(projects.id, projectId), eq(projects.owner, owner), eq(projects.updatedAt, saved.row.updatedAt)))
      .returning({ id: projects.id });
    if (changed.length) return job;
  }
  throw Error('Concurrent research status update. Refresh collection before resubmitting any paid work.');
}
async function persistJob(owner: string, projectId: string, jobId: string, update: Partial<ResearchJob>) {
  return mutateJob(owner, projectId, jobId, old => ({ ...old, ...update }));
}
async function updateWorker(owner: string, projectId: string, jobId: string, index: number,
  changes: Partial<HybridWorker>) {
  return mutateJob(owner, projectId, jobId, old => ({
    ...old, workers: (old.workers || []).map(w => w.index === index ? { ...w, ...changes } : w),
  }));
}
function normalizedProposals(value: unknown): Concept[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const raw = value as { characters?: unknown };
  if (!Array.isArray(raw.characters)) return [];
  return raw.characters.slice(0, 200).flatMap((item): Concept[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const char = item as Record<string, unknown>;
    if (typeof char.name !== 'string' || !char.name.trim()) return [];
    return [{
      name: char.name.trim().slice(0, 160),
      family: typeof char.family === 'string' ? char.family.slice(0, 120) : '',
      expression: typeof char.expression === 'string' ? char.expression.slice(0, 160) : '',
      shape: typeof char.shape === 'string' ? char.shape.slice(0, 180) : '',
      silhouette: typeof char.silhouette === 'string' ? char.silhouette.slice(0, 180) : '',
      accessories: typeof char.accessories === 'string' ? char.accessories.slice(0, 180) : '',
      colorPlan: typeof char.colorPlan === 'string' ? char.colorPlan.slice(0, 180) : '',
      description: typeof char.description === 'string' ? char.description.slice(0, 500) : '',
    }];
  });
}
async function finish(owner: string, projectId: string, job: ResearchJob, response: ApiResponse) {
  const saved = await getCollection(owner, projectId);
  if (!saved || saved.data.researchJob?.id !== job.id) return bad('Research run was superseded or deleted', 409);
  if (saved.data.researchJob.status === 'completed') return Response.json({ job: safeJob(saved.data.researchJob), project: saved.data });
  let parsed: unknown;
  try {
    // Reuse the same normalization for the final Style DNA synthesis.
    // A completed merge may also wrap its research JSON one level deep.
    parsed = JSON.parse(parseResearchWorkerOutput(extractText(response),job.source.title).resultText);
  } catch (error) {
    const failed = await persistJob(owner, projectId, job.id, { status: 'failed',
      error: 'Background research output cannot be imported from the saved response: ' +
        (error instanceof Error ? error.message : String(error)).slice(0,250) });
    return Response.json({ job: failed && safeJob(failed) });
  }
  const source = job.source;
  const research = mergeSourceEmotionProfile(normalizeCreativeAnalysis(parsed), source.title, source.tags);
  const candidates = normalizedProposals(parsed);
  if (!research.theme || !candidates.length) {
    const failed = await persistJob(owner, projectId, job.id, { status: 'failed', error: 'AI response did not contain a theme and character concepts. Retry explicitly.' });
    return Response.json({ job: failed && safeJob(failed) });
  }
  const previous = saved.data.characters || [];
  const uniquePrevious = [...new Map(previous.filter(c => c.name).map(c => [c.name.trim().toLowerCase(), c])).values()];
  const needed = Math.max(0, job.target - uniquePrevious.length);
  const selected = selectDiverseConcepts(candidates, uniquePrevious, job.target, needed,
    normalizeCreativeControls(saved.data.creativeControls).characterVariation,
    primaryCharacterSubject(source.title));
  const characters: StoredCharacter[] = [
    ...uniquePrevious,
    ...selected.map(c => ({ id: crypto.randomUUID(), name: c.name, family: c.family,
      expression: c.expression, shape: c.shape, silhouette: c.silhouette, accessories: c.accessories, colorPlan: c.colorPlan, description: c.description || '', origin: 'ai',
      prompt: '', status: 'draft' })),
  ];
  const updatedJob: ResearchJob = { ...job, status: 'completed', ...(job.workers?.length ? { mergeStatus:'completed' as const } : {}), completedCount: characters.length, updatedAt: Date.now() };
  // Merge the current stored record, not the user's stale browser snapshot. This
  // keeps independently saved images/upscale records and manual character edits intact.
  const updated: Collection = {
    ...saved.data, researchJob: updatedJob, url: saved.data.url,
    title: source.title, name: saved.data.name === 'Untitled collection' ? source.title : saved.data.name,
    images: source.images, selectedImageUrls: job.selectedImages,
    sourceDescription: source.description, sourceTags: source.tags,
    theme: research.theme, subtheme: research.subtheme, microtheme: research.microtheme,
    primaryKeyword: research.primaryKeyword, longTailKeywords: research.longTailKeywords,
    emotionDirection: research.emotionProfile.dominantMood,
    ageDirection: research.emotionProfile.ageCues.join(', '),
    cutenessDirection: research.emotionProfile.styleCues.join(', '),
    style: research.style || saved.data.style, palette: research.palette || saved.data.palette,
    texture: research.texture || saved.data.texture,
    keywords: research.keywords.length ? research.keywords : source.tags,
    notes: research.notes, research, characters,
  };
  const applied = await getDb().update(projects)
    .set({ name: updated.name.slice(0, 160), data: JSON.stringify(updated),
      updatedAt: Math.max(Date.now(), saved.row.updatedAt + 1) })
    .where(and(eq(projects.id, projectId), eq(projects.owner, owner), eq(projects.updatedAt, saved.row.updatedAt)))
    .returning({ id: projects.id });
  if (!applied.length) {
    // Another tab saved the collection while we parsed this response. The next
    // poll can retry import from the SAME remote response at no new AI charge.
    return Response.json({ job: safeJob(job), retryImport: true });
  }
  return Response.json({ job: safeJob(updatedJob), project: updated });
}

// New jobs use actual OpenAI Batch pricing, not Background Responses.
// Standard Responses requests return a resumable receipt, not a Batch job.
// Existing Batch receipts are still read by getResearchBatchResult.
export async function submitStandardTextResponse(key:string,model:string,
  instruction:string,maxTokens:number):Promise<string>{
  const response=await openai(key,'responses',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model,input:[{role:'user',content:[{type:'input_text',text:instruction}]}],
      background:true,store:true,text:{format:{type:'json_object'}},
      max_output_tokens:maxTokens}),
  });
  if(!response.ok)throw Error('OpenAI standard Responses HTTP '+response.status+': '+
    (await response.text()).slice(0,220));
  const data=await response.json() as ApiResponse;
  if(!data.id||!/^resp_[\w-]+$/.test(data.id))
    throw Error('OpenAI standard response accepted without a valid tracking ID');
  return data.id;
}
export async function getStandardTextResponseResult(key:string,responseId:string):
  Promise<{status:string;text?:string;error?:string}>{
  const result=await openai(key,'responses/'+encodeURIComponent(responseId));
  if(!result.ok)throw Error('OpenAI standard Responses status HTTP '+result.status);
  const data=await result.json() as ApiResponse;
  if(data.status==='completed'){
    const text=extractText(data);
    return text?{status:'completed',text}:{status:'failed',error:'Empty standard Responses output'};
  }
  if(['failed','cancelled','incomplete'].includes(data.status||''))
    return {status:'failed',error:data.error?.message||data.incomplete_details?.reason||'Standard Response failed'};
  return {status:data.status||'in_progress'};
}
export async function submitResearchBatch(key:string,customId:string,model:string,
  input:unknown,maxTokens:number):Promise<string>{
  const form=new FormData();
  form.set('purpose','batch');
  form.set('file',new Blob([researchBatchJsonl(customId,model,input,maxTokens)],
    {type:'application/jsonl'}),'paletteiq-research-'+customId+'.jsonl');
  const upload=await openai(key,'files',{method:'POST',body:form});
  if(!upload.ok)throw Error('OpenAI file upload HTTP '+upload.status);
  const file=await upload.json() as {id?:string};
  if(!file.id)throw Error('OpenAI Batch input file ID missing');
  const request=await openai(key,'batches',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({input_file_id:file.id,endpoint:'/v1/responses',
      completion_window:'24h',
      metadata:{app:'paletteiq',action:'research',group:customId}}),
  });
  if(!request.ok)throw Error('OpenAI Batch creation HTTP '+request.status+': '+
    (await request.text()).slice(0,150));
  const batch=await request.json() as BatchReceipt;
  if(!batch.id||!/^batch_[\w-]+$/.test(batch.id))
    throw Error('OpenAI Batch accepted but no valid tracking ID was returned');
  return batch.id;
}
export async function getResearchBatchResult(key:string,batchId:string,requestKey:string):
  Promise<{status:string;text?:string;error?:string}>{
  const poll=await openai(key,'batches/'+encodeURIComponent(batchId));
  if(!poll.ok)throw Error('OpenAI Research Batch status HTTP '+poll.status);
  const batch=await poll.json() as BatchReceipt;
  if(!['completed','failed','cancelled','expired'].includes(batch.status))
    return {status:batch.status};
  if(batch.status==='completed' && !batch.output_file_id && !batch.error_file_id)
    return {status:'in_progress'}; // Output file often appears after completion.
  const outputs:string[]=[];
  for(const id of [batch.output_file_id,batch.error_file_id].filter((x):x is string=>!!x)){
    const fetched=await openai(key,'files/'+encodeURIComponent(id)+'/content');
    if(!fetched.ok)throw Error('Research Batch output HTTP '+fetched.status);
    const raw=await fetched.text();
    if(raw.length>3_000_000)throw Error('Research Batch result is too large');
    outputs.push(raw);
  }
  const parsed=batchResearchResult(outputs.join('\n'),requestKey);
  if(parsed?.error)return {status:'failed',error:parsed.error};
  if(parsed?.text)return {status:'completed',text:parsed.text};
  return {status:'failed',error:'No valid research result in Batch output (status '+batch.status+')'};
}
async function pollResearchBatch(owner:string,id:string,job:ResearchJob):Promise<Response>{
  const key=await userCredential(owner,'openai')||sharedProviderSecret(owner,'OPENAI_API_KEY');
  if(!key)return bad('OpenAI key needed to retrieve Research Batch',503);
  // One Batch per worker. Read already submitted IDs, never recreate requests.
  await Promise.all((job.workers||[]).filter(w=>w.batchId &&
      ['queued','in_progress'].includes(w.status)).map(async worker=>{
    try{
      const output=await getResearchBatchResult(key,worker.batchId!,
        'research-worker-'+worker.index);
      if(output.status==='completed' && output.text){
        await updateWorker(owner,id,job.id,worker.index,{
          status:'completed',resultText:output.text.slice(0,160000)});
      }else if(output.status==='failed'){
        await updateWorker(owner,id,job.id,worker.index,{
          status:'failed',error:output.error||'OpenAI Batch worker failed'});
      }else if(output.status==='in_progress'){
        await updateWorker(owner,id,job.id,worker.index,{status:'in_progress'});
      }
    }catch{/* Network errors are transient; preserve the remote Batch ID. */}
  }));
  let latest=(await getCollection(owner,id))?.data.researchJob;
  if(!latest||latest.id!==job.id)return bad('Research Batch was replaced',409);
  for(const w of latest.workers||[]){
    if(['planned','submitting'].includes(w.status)&&!w.batchId &&
        Date.now()-(w.startedAt||latest.createdAt)>120000){
      await updateWorker(owner,id,job.id,w.index,{status:'uncertain',
        error:'No saved Batch ID; inspect OpenAI Batch activity before retrying'});
    }
  }
  latest=(await getCollection(owner,id))?.data.researchJob;
  if(!latest)return bad('Research Batch missing',409);
  const pending=(latest.workers||[]).some(w=>
    ['planned','submitting','queued','in_progress'].includes(w.status));
  if(pending)return Response.json({job:safeJob(latest)});
  const problematic=(latest.workers||[]).filter(w=>
    ['failed','uncertain'].includes(w.status));
  if(problematic.length){
    const stopped=await persistJob(owner,id,job.id,{status:'failed',
      error:'Research Batch worker failed/uncertain. Inspect OpenAI before retrying. '+
        problematic.map(w=>w.error||w.status).join(' ').slice(0,240)});
    return Response.json({job:safeJob(stopped||latest)});
  }
  // Single-Batch research can be imported as soon as its one worker completes.
  if(!latest.mergeStatus){
    const text=latest.workers?.[0]?.resultText||'';
    return finish(owner,id,latest,{output:[{content:[{text}]}]});
  }
  if(latest.mergeStatus==='planned'){
    let claimed=false;
    const pendingMerge=await mutateJob(owner,id,job.id,old=>{
      claimed=old.mergeStatus==='planned'&&!old.mergeBatchId;
      return claimed?{...old,mergeStatus:'submitting'}:old;
    });
    if(claimed && pendingMerge){
      try{
        const instruction=hybridMergeInstruction(latest.source,latest.workers||[],latest.requested);
        const batchId=await submitResearchBatch(key,'research-merge',latest.model,
          [{role:'user',content:[{type:'input_text',text:instruction}]}],
          Math.min(30000,3200+latest.requested*190));
        const saved=await persistJob(owner,id,job.id,{
          mergeBatchId:batchId,mergeStatus:'queued',status:'in_progress'});
        return Response.json({job:safeJob(saved||pendingMerge)});
      }catch(error){
        const uncertain=await persistJob(owner,id,job.id,{
          status:'failed',mergeStatus:'uncertain',
          error:'Style DNA Batch submission may have reached OpenAI. Review usage before any retry. '+
            (error instanceof Error?error.message:String(error)).slice(0,160)});
        return Response.json({job:safeJob(uncertain||pendingMerge)});
      }
    }
  }
  latest=(await getCollection(owner,id))?.data.researchJob;
  if(!latest)return bad('Research merge tracking unavailable',409);
  if(latest.mergeStatus==='submitting'&&!latest.mergeBatchId &&
    Date.now()-latest.updatedAt>120000){
    const stopped=await persistJob(owner,id,job.id,{status:'failed',
      mergeStatus:'uncertain',error:'Merge Batch receipt missing. Inspect OpenAI activity'});
    return Response.json({job:safeJob(stopped||latest)});
  }
  if(latest.mergeBatchId && ['queued','in_progress'].includes(latest.mergeStatus||'')){
    try{
      const out=await getResearchBatchResult(key,latest.mergeBatchId,'research-merge');
      if(out.status==='completed'&&out.text){
        return finish(owner,id,latest,{output:[{content:[{text:out.text}]}]});
      }
      if(out.status==='failed'){
        const failed=await persistJob(owner,id,job.id,{status:'failed',
          mergeStatus:'failed',error:out.error||'Style DNA Batch failed'});
        return Response.json({job:safeJob(failed||latest)});
      }
      if(out.status==='in_progress'&&latest.mergeStatus==='queued')
        latest=await persistJob(owner,id,job.id,{mergeStatus:'in_progress'})||latest;
    }catch{/* Keep the remote receipt for another harmless status poll. */}
  }
  return Response.json({job:safeJob(latest)});
}

export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  let body: { action?: string; jobId?: string; projectId?: string; url?: string; selectedImages?: unknown[]; target?: number; model?: string; retryFailed?: boolean; hybridResearch?: boolean };
  try { body = await req.json(); } catch { return bad('Invalid JSON'); }
  const projectId = String(body.projectId || '');
  const saved = await getCollection(user.userId, projectId).catch(() => null);
  if (!saved) return bad('Save your collection first, then start background research.', 404);
  if (body.action === 'recover-existing') {
    const job=saved.data.researchJob;
    if (!job || job.id !== body.jobId || job.status !== 'failed' ||
        job.transport !== 'standard' || job.mergeStatus !== 'planned' ||
        job.responseId || job.mergeBatchId || !job.workers?.length) {
      return bad('No eligible failed Research group is available for saved-response recovery.',409);
    }
    // Never recover an ambiguous submission, retry OpenAI generation, or
    // reset a merge receipt. Only reread the already-paid response IDs.
    const failed=job.workers.filter(w=>w.status==='failed');
    if (!failed.length ||
        failed.some(w=>!w.responseId ||
          !w.error?.startsWith('Invalid research worker output:')) ||
        job.workers.some(w=>!['completed','failed'].includes(w.status))) {
      return bad('Research has an uncertain or unrelated failure. Review saved OpenAI activity; no new work was submitted.',409);
    }
    const key=await userCredential(user.userId,'openai') ||
      sharedProviderSecret(user.userId,'OPENAI_API_KEY');
    if (!key) return bad('OpenAI key required to retrieve the original Research responses.',503);
    let recovered: Array<{index:number;resultText:string;warning?:string}>;
    try {
      recovered=await Promise.all(failed.map(async worker=>{
        const response=await openai(key,'responses/'+encodeURIComponent(worker.responseId!));
        if (!response.ok) throw Error('Cannot retrieve saved Worker '+(worker.index+1)+
          ' (HTTP '+response.status+')');
        const data=await response.json() as ApiResponse;
        if (data.status!=='completed')
          throw Error('Saved Worker '+(worker.index+1)+' is '+(data.status||'unavailable')+
            ', not completed');
        const parsed=parseResearchWorkerOutput(extractText(data),job.source.title);
        return {index:worker.index,resultText:parsed.resultText,warning:parsed.warning};
      }));
    } catch(error) {
      return bad('Saved-response recovery could not validate Group 1 or another failed group: '+
        (error instanceof Error?error.message:String(error)).slice(0,380)+
        '. No new paid worker was submitted; completed groups remain saved.',422);
    }
    for(const worker of recovered){
      await updateWorker(user.userId,projectId,job.id,worker.index,{
        status:'completed',resultText:worker.resultText,warning:worker.warning,error:undefined,
      });
    }
    const latest=(await getCollection(user.userId,projectId))?.data.researchJob;
    if(!latest || latest.id!==job.id ||
       !latest.workers?.every(w=>w.status==='completed' && w.resultText))
      return bad('Recovered groups have been saved, but Research status needs review. No new paid worker was submitted.',409);
    const hasConcepts=latest.workers.some(w=>{
      try {
        const parsed=JSON.parse(w.resultText || '{}') as {characters?:unknown[]};
        return Array.isArray(parsed.characters) && parsed.characters.length>0;
      } catch { return false; }
    });
    if(!hasConcepts)
      return bad('No group returned character concepts. Saved visual evidence is retained; inspect it before paying for synthesis.',422);
    const resumed=await persistJob(user.userId,projectId,job.id,{
      status:'in_progress',error:undefined,
    });
    return Response.json({
      job:safeJob(resumed||latest),recovered:recovered.length,
      message:'Existing OpenAI worker responses recovered. The previously planned Style DNA merge may now proceed; no new worker was submitted.',
    });
  }
  if (active(saved.data.researchJob)) return Response.json({ job: safeJob(saved.data.researchJob!) }, { status: 409 });
  // A rejected 400 download failure contains no OpenAI background response ID.
  // All other existing jobs require manual investigation, not resubmission.
  if (saved.data.researchJob && !(body.retryFailed === true && safeRejectedImageResearch(saved.data.researchJob)))
    return bad('A saved research job exists. Check its status and OpenAI usage before starting another paid request.',409);
  if (body.retryFailed === true && !safeRejectedImageResearch(saved.data.researchJob))
    return bad('This research job is not eligible for a safe retry.',409);
  const url = String(body.url || '');
  const id = listingId(url);
  if (!id || saved.data.url !== url) return bad('Saved collection must contain the same valid Etsy reference URL');
  const model = String(body.model || 'gpt-4.1-mini');
  if (!/^gpt-[a-z0-9.-]{1,80}$/.test(model)) return bad('Choose a valid OpenAI vision model');
  const target = Number(body.target);
  if (!Number.isInteger(target) || target < 1 || target > 1000) return bad('Target must be between 1 and 1000');
  const requested = Math.min(target, 160); // Above 160, finish the remaining subjects with AI Fill.
  const etsyKey = await userCredential(user.userId, 'etsy') || sharedProviderSecret(user.userId, 'ETSY_API_KEY');
  const aiKey = await userCredential(user.userId, 'openai') || sharedProviderSecret(user.userId, 'OPENAI_API_KEY');
  if (!etsyKey || !aiKey) return bad('Connect Etsy API and OpenAI API in Settings before starting research.', 503);
  const listingRes = await fetch(`https://api.etsy.com/v3/application/listings/${id}?includes=Images`, { headers: { 'x-api-key': etsyKey } });
  if (!listingRes.ok) return bad(`Could not load Etsy listing (HTTP ${listingRes.status})`, 502);
  const listing = await listingRes.json() as { title?: string; description?: string; tags?: string[]; images?: Array<{ url_fullxfull?: string; url_570xN?: string }> };
  const source: Source = {
    title: String(listing.title || '').slice(0, 350),
    description: String(listing.description || '').slice(0, 9000),
    tags: Array.isArray(listing.tags) ? listing.tags.filter(t => typeof t === 'string').slice(0, 40) : [],
    images: Array.isArray(listing.images) ? [...new Set(listing.images.map(im => String(im.url_fullxfull || im.url_570xN || '')).filter(validImage))] : [],
  };
  // Always honor the user's CURRENT explicit selection on retry.
  // The previous failed job's images are an audit record, never a default:
  // silently replacing a new 8-image selection with 19 old images is costly.
  if (!Array.isArray(body.selectedImages) || !body.selectedImages.length ||
      body.selectedImages.length > 24 ||
      body.selectedImages.some(value => typeof value !== 'string')) {
    return bad('Select 1–24 Etsy images for this research request. The previous job selection will not be reused.', 400);
  }
  const candidates = body.selectedImages as string[];
  const allowed = new Set(source.images);
  const selectedImages = [...new Set(candidates)];
  // Do not silently drop missing/expired references or change the number of
  // images sent to OpenAI after the user confirms it in the browser.
  if (selectedImages.length !== candidates.length || selectedImages.some(value => !allowed.has(value))) {
    return bad('Image selection changed or contains duplicates. Re-load the Etsy images, select the desired references, and try again.', 409);
  }
  // OpenAI cannot consistently fetch remote Etsy CDN URLs itself.
  // Use smaller legitimate Etsy thumbnails where the listing API supplies them.
  // Download and validate ALL references before claiming a paid response.
  const referenceUrls = selectedImages.map(url => {
    const image = listing.images?.find(entry => entry.url_fullxfull === url || entry.url_570xN === url);
    return image?.url_570xN && validImage(image.url_570xN) ? image.url_570xN : url;
  });
  let imageDataUrls: string[];
  try { imageDataUrls = await fetchResearchImageDataUrls(referenceUrls); }
  catch (error) {
    return bad('Research images could not be prepared: ' +
      (error instanceof Error ? error.message : 'image download failed') +
      '. No new OpenAI background job was submitted.', 422);
  }
  const now = Date.now();
  const hybrid = selectedImages.length > 1 && body.retryFailed !== true;
  const partitions = splitResearchImages(selectedImages, hybrid ? 3 : 1);
  const workers: HybridWorker[] = partitions.map((part, index) => ({
    index, images: part, status:'planned',
  }));
  const job: ResearchJob = { id: crypto.randomUUID(), status: 'submitting', model, target, requested,
    createdAt: now, updatedAt: now, completedCount: saved.data.characters?.length || 0,
    selectedImages, source, transport:'standard', workers,
    ...(hybrid ? { mergeStatus:'planned' as const } : {}) };
  // Etsy metadata and image preparation can take several seconds. During that
  // time the Full Automation monitor or another job can legitimately update
  // this same collection row. Refresh immediately before the paid-job claim,
  // and retry ONLY the local compare-and-swap (never an OpenAI request).
  // A successful claim remains the sole authorization to submit paid work.
  let claimedControls = saved.data.creativeControls;
  let claimed = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const fresh = await getCollection(user.userId, projectId);
    if (!fresh) return bad('Collection disappeared while preparing research. No OpenAI request was sent.', 404);
    if (fresh.data.url !== url)
      return bad('Collection Etsy URL changed while preparing research. No OpenAI request was sent.', 409);
    const currentImages = fresh.data.selectedImageUrls ?? fresh.data.images ?? [];
    if (currentImages.length !== selectedImages.length ||
        currentImages.some((image, index) => image !== selectedImages[index]))
      return bad('Selected Etsy images changed while preparing research. Review the current selection; no OpenAI request was sent.', 409);
    // A concurrent request may already have claimed the job. Never replace
    // its receipt, even if the browser still shows an older research status.
    if (active(fresh.data.researchJob))
      return Response.json({error:'Research is already submitting or running. No duplicate OpenAI request was sent.',
        job:safeJob(fresh.data.researchJob!)}, {status:409});
    if (fresh.data.researchJob &&
        !(body.retryFailed === true && safeRejectedImageResearch(fresh.data.researchJob)))
      return bad('Research status changed while preparing the request. Check the saved job and OpenAI usage; no new request was sent.',409);
    if (body.retryFailed === true && !safeRejectedImageResearch(fresh.data.researchJob))
      return bad('Research is no longer eligible for a safe retry. No OpenAI request was sent.',409);

    job.completedCount = fresh.data.characters?.length || 0;
    const stamp = Math.max(Date.now(), fresh.row.updatedAt + 1);
    const claim = await getDb().update(projects)
      .set({ data: JSON.stringify({ ...fresh.data, researchJob: job }), updatedAt: stamp })
      .where(and(eq(projects.id, projectId), eq(projects.owner, user.userId),
        eq(projects.updatedAt, fresh.row.updatedAt)))
      .returning({ id: projects.id });
    if (claim.length) {
      claimedControls = fresh.data.creativeControls;
      claimed = true;
      break;
    }
    // A racing metadata/status write lost this CAS; reread and revalidate.
    // The backoff is only for database contention, not paid-job submission.
    await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1)));
  }
  if (!claimed)
    return bad('Collection was updated repeatedly while claiming research. No OpenAI request was sent; check saved research status before retrying.', 409);
  // New Research uses parallel standard Responses with persisted response IDs.
  // Legacy Batch IDs remain recoverable without resubmitting paid work.
  if(job.transport==='batch'){
    const submissions=workers.map(async worker=>{
      try{
        await updateWorker(user.userId,projectId,job.id,worker.index,{
          status:'submitting',startedAt:Date.now(),
        });
        const indices=worker.images.map(url=>selectedImages.indexOf(url));
        const count=Math.ceil(requested/workers.length);
        const instruction=researchAnalysisInstruction(source,worker.images.length,count,
          normalizeCreativeControls(claimedControls))+
          '\nRESEARCH WORKER '+(worker.index+1)+'/'+workers.length+
          ': analyze only supplied reference images; never infer other image contents.';
        const input=[{role:'user',content:[
          {type:'input_text',text:instruction},
          ...indices.map(index=>({type:'input_image',image_url:imageDataUrls[index]})),
        ]}];
        const batchId=await submitResearchBatch(aiKey,
          'research-worker-'+worker.index,model,input,
          Math.min(13000,3000+count*190));
        await updateWorker(user.userId,projectId,job.id,worker.index,
          {batchId,status:'queued'});
      }catch(error){
        // A timeout after provider acceptance is ambiguous. Never submit
        // another paid Batch for the same worker automatically.
        await updateWorker(user.userId,projectId,job.id,worker.index,{
          status:'uncertain',error:'Research Batch submission needs inspection: '+
          (error instanceof Error?error.message:String(error)).slice(0,195),
        }).catch(()=>{});
      }
    });
    await Promise.all(submissions);
    const latest=(await getCollection(user.userId,projectId))?.data.researchJob;
    if(!latest)return bad('Research Batch receipts not saved. Inspect OpenAI usage',503);
    const updated=await persistJob(user.userId,projectId,job.id,{status:'in_progress'});
    return Response.json({job:safeJob(updated||latest)},{status:202});
  }
  if (hybrid) {
    // Each worker has its own durable response ID and independent set of
    // references. Calls start concurrently but are NEVER auto-resubmitted.
    // A connection failure after acceptance remains 'uncertain' for manual
    // investigation, not a blind retry that could double-charge.
    const submissions = workers.map(async worker => {
      try {
        await updateWorker(user.userId, projectId, job.id, worker.index, { status:'submitting', startedAt:Date.now() });
        const indices = worker.images.map(url => selectedImages.indexOf(url));
        const subjectCount = Math.ceil(requested / workers.length);
        const instruction = researchAnalysisInstruction(source, worker.images.length, subjectCount,
          normalizeCreativeControls(claimedControls)) +
          '\nHYBRID WORKER ' + (worker.index + 1) + '/' + workers.length +
          ': analyze ONLY your supplied image group. Final cross-group Style DNA synthesis follows.';
        const input = [{ role:'user', content:[
          { type:'input_text', text:instruction },
          ...indices.map(index => ({ type:'input_image', image_url:imageDataUrls[index] })),
        ] }];
        const ai = await openai(aiKey, 'responses', {
          method:'POST', headers:{ 'Content-Type':'application/json' },
          body:JSON.stringify({ model, input, background:true, store:true,
            text:{ format:{ type:'json_object' } },
            max_output_tokens:Math.min(13000,Math.max(8192,3000 + subjectCount*190)) }),
        });
        if (!ai.ok) {
          const error='Worker ' + (worker.index+1) + ' failed to start (HTTP ' + ai.status +
            '): ' + (await ai.text()).slice(0,170);
          await updateWorker(user.userId,projectId,job.id,worker.index,{status:'failed',error});
          return;
        }
        const result=await ai.json() as ApiResponse;
        if (!result.id || !/^resp_[\w-]+$/.test(result.id))
          throw Error('OpenAI accepted a worker but did not provide a tracking ID');
        await updateWorker(user.userId,projectId,job.id,worker.index,{
          status:result.status==='in_progress'?'in_progress':'queued',responseId:result.id,
        });
      } catch (error) {
        await updateWorker(user.userId,projectId,job.id,worker.index,{
          status:'uncertain',error:'Worker submission may have reached OpenAI: ' +
            (error instanceof Error?error.message:String(error)).slice(0,210) +
            '. Check OpenAI activity before any retry.',
        }).catch(()=>{});
      }
    });
    await Promise.all(submissions);
    const latest=await getCollection(user.userId,projectId);
    const updatedJob=latest?.data.researchJob;
    if (!updatedJob) return bad('Research receipt missing after worker submission. Check OpenAI usage.',503);
    if (updatedJob.workers?.some(w=>['failed','uncertain'].includes(w.status))) {
      // Successful workers are still running; GET will collect their outputs
      // before reporting the failure, so no paid work is lost or repeated.
      return Response.json({job:safeJob(updatedJob)},{status:202});
    }
    await persistJob(user.userId,projectId,job.id,{status:'in_progress'});
    return Response.json({job:safeJob({...updatedJob,status:'in_progress'})},{status:202});
  }
  try {
    const instruction = researchAnalysisInstruction(source, selectedImages.length, requested,
      normalizeCreativeControls(claimedControls));
    const input = [{ role: 'user', content: [
      { type: 'input_text', text: instruction },
      ...imageDataUrls.map(image_url => ({ type: 'input_image', image_url })),
    ] }];
    const ai = await openai(aiKey, 'responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, input, background: true, store: true,
        text: { format: { type: 'json_object' } },
        max_output_tokens: Math.min(30000, 3200 + requested * 190),
      }),
    });
    if (!ai.ok) throw new Error('OpenAI background research failed to start (HTTP ' + ai.status + '): ' + (await ai.text()).slice(0, 260));
    const response = await ai.json() as ApiResponse;
    if (!response.id || !/^resp_[\w-]+$/.test(response.id)) throw new Error('OpenAI did not provide a resumable background response ID.');
    const savedJob = await persistJob(user.userId, projectId, job.id, {
      status: response.status === 'in_progress' ? 'in_progress' : 'queued',
      responseId: response.id,
    });
    return Response.json({ job: safeJob(savedJob || { ...job, status: 'queued' }) }, { status: 202 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await persistJob(user.userId, projectId, job.id, { status: 'failed', error: msg.slice(0, 500) });
    return bad(msg.slice(0, 500), 502);
  }
}

export async function GET(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  const projectId = new URL(req.url).searchParams.get('projectId') || '';
  const saved = await getCollection(user.userId, projectId).catch(() => null);
  if (!saved) return bad('Collection not found', 404);
  const job = saved.data.researchJob;
  if (!job) return Response.json({ job: null });
  if (job.status === 'completed') return Response.json({ job: safeJob(job), project: saved.data });
  if (job.status === 'failed') return Response.json({ job: safeJob(job) });
  if(job.transport==='batch') return pollResearchBatch(user.userId,projectId,job);
  if (job.workers?.length && !job.responseId) {
    const key = await userCredential(user.userId,'openai') ||
      sharedProviderSecret(user.userId,'OPENAI_API_KEY');
    if (!key) return bad('OpenAI API key is needed to retrieve the research workers.',503);
    // Poll the already-submitted IDs; never create new worker requests here.
    await Promise.all(job.workers.filter(w=>['queued','in_progress'].includes(w.status) && w.responseId)
      .map(async worker => {
        const ai=await openai(key,'responses/'+encodeURIComponent(worker.responseId!));
        if (!ai.ok) return; // transient polling failures are retried next time
        const response=await ai.json() as ApiResponse;
        if (response.status==='completed') {
          const raw=extractText(response);
          try {
            const parsed=parseResearchWorkerOutput(raw, job.source.title);
            await updateWorker(user.userId,projectId,job.id,worker.index,{
              status:'completed',resultText:parsed.resultText,
              warning:parsed.warning,error:undefined,
            });
          } catch (error) {
            // The completed response ID remains saved. Do not submit another
            // paid worker just because its output schema differs.
            await updateWorker(user.userId,projectId,job.id,worker.index,{
              status:'failed',error:'Invalid research worker output: ' +
                (error instanceof Error?error.message:String(error)).slice(0,210),
            });
          }
        } else if (['failed','incomplete','cancelled'].includes(String(response.status))) {
          await updateWorker(user.userId,projectId,job.id,worker.index,{
            status:'failed',error:(response.error?.message||response.incomplete_details?.reason||
              'Background worker failed').slice(0,240),
          });
        } else if (response.status==='in_progress' && worker.status==='queued') {
          await updateWorker(user.userId,projectId,job.id,worker.index,{status:'in_progress'});
        }
      }));
    let latest=(await getCollection(user.userId,projectId))?.data.researchJob;
    if (!latest || latest.id!==job.id) return bad('Research job replaced while polling',409);
    // If the server stopped mid-submission there might be a paid OpenAI
    // request with no stored response ID. Mark it uncertain for inspection;
    // NEVER automatically resubmit that worker.
    for (const worker of latest.workers || []) {
      if (['planned','submitting'].includes(worker.status) && !worker.responseId &&
          Date.now()-(worker.startedAt || latest.createdAt)>120000) {
        await updateWorker(user.userId,projectId,job.id,worker.index,{
          status:'uncertain',error:'Worker submission interrupted before a tracking ID was saved. Check OpenAI Logs; no automatic retry.'});
      }
    }
    latest=(await getCollection(user.userId,projectId))?.data.researchJob;
    if (!latest) return bad('Research job missing during status recovery',409);
    const pending=(latest.workers||[]).some(w=>['planned','submitting','queued','in_progress'].includes(w.status));
    const rejected=(latest.workers||[]).filter(w=>['failed','uncertain'].includes(w.status));
    if (pending) return Response.json({job:safeJob(latest)});
    if (rejected.length) {
      const failure=await persistJob(user.userId,projectId,job.id,{
        status:'failed',error:rejected.map(w=>'Worker '+(w.index+1)+': '+(w.error||w.status)).join(' | ').slice(0,480),
      });
      return Response.json({job:safeJob(failure||latest)});
    }
    if (latest.mergeStatus==='planned') {
      // Never pay for Style DNA synthesis when every worker returned visual
      // notes but no actual character concepts.
      const hasConcepts=(latest.workers||[]).some(worker=>{
        try {
          const parsed=JSON.parse(worker.resultText||'{}') as {characters?:unknown[]};
          return Array.isArray(parsed.characters) && parsed.characters.length>0;
        } catch { return false; }
      });
      if (!hasConcepts) {
        const incomplete=await persistJob(user.userId,projectId,job.id,{
          status:'failed',
          error:'Research groups contained no usable character concepts. Existing response IDs remain saved; inspect outputs before a paid synthesis retry.',
        });
        return Response.json({job:safeJob(incomplete||latest)});
      }
      // Claim the ONE paid synthesis request atomically, even if both the
      // desktop monitor and the browser poll simultaneously.
      let claimed=false;
      const mergeJob=await mutateJob(user.userId,projectId,job.id,old=>{
        claimed=old.mergeStatus==='planned' && !old.responseId;
        return claimed?{...old,mergeStatus:'submitting'}:old;
      });
      if (claimed && mergeJob) {
        try {
          const instruction=hybridMergeInstruction(latest.source,latest.workers||[],latest.requested);
          const ai=await openai(key,'responses',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({model:latest.model,
              input:[{role:'user',content:[{type:'input_text',text:instruction}]}],
              background:true,store:true,text:{format:{type:'json_object'}},
              max_output_tokens:Math.min(30000,3200+latest.requested*190)}),
          });
          if (!ai.ok) {
            const err='Style DNA merge failed (HTTP '+ai.status+'): '+(await ai.text()).slice(0,210);
            const failed=await persistJob(user.userId,projectId,job.id,{
              status:'failed',mergeStatus:'failed',error:err});
            return Response.json({job:safeJob(failed||mergeJob)});
          }
          const response=await ai.json() as ApiResponse;
          if (!response.id||!/^resp_[\w-]+$/.test(response.id))
            throw Error('Merge response accepted without a resumable tracking ID');
          const updated=await persistJob(user.userId,projectId,job.id,{
            responseId:response.id,mergeStatus:response.status==='in_progress'?'in_progress':'queued',
            status:'in_progress'});
          return Response.json({job:safeJob(updated||mergeJob)});
        } catch (error) {
          const failed=await persistJob(user.userId,projectId,job.id,{
            status:'failed',mergeStatus:'uncertain',
            error:'Style DNA merge may have been submitted. Check OpenAI activity; do not retry automatically. '+
              (error instanceof Error?error.message:String(error)).slice(0,220)});
          return Response.json({job:safeJob(failed||mergeJob)});
        }
      }
    }
    if (latest.mergeStatus==='submitting' && Date.now()-latest.updatedAt>120000) {
      const failed=await persistJob(user.userId,projectId,job.id,{status:'failed',
        mergeStatus:'uncertain',error:'Style DNA synthesis was interrupted before tracking the request. Check OpenAI activity before retrying.'});
      return Response.json({job:safeJob(failed||latest)});
    }
    latest=(await getCollection(user.userId,projectId))?.data.researchJob;
    return Response.json({job:latest?safeJob(latest):null});
  }
  if (!job.responseId) {
    if (job.status === 'submitting' && Date.now() - job.createdAt > 120_000) {
      const failed = await persistJob(user.userId, projectId, job.id, { status: 'failed',
        error: 'The server was interrupted during background submission, before its tracking ID was saved. Check OpenAI usage before explicitly retrying to avoid duplicate charges.' });
      return Response.json({ job: safeJob(failed || job) });
    }
    return Response.json({ job: safeJob(job) });
  }
  const key = await userCredential(user.userId, 'openai') || sharedProviderSecret(user.userId, 'OPENAI_API_KEY');
  if (!key) return bad('OpenAI API key is needed to retrieve the saved background response.', 503);
  const ai = await openai(key, 'responses/' + encodeURIComponent(job.responseId));
  if (!ai.ok) return bad('Cannot check background research (HTTP ' + ai.status + '): ' + (await ai.text()).slice(0, 200), 502);
  const response = await ai.json() as ApiResponse;
  if (response.status === 'completed') return finish(user.userId, projectId, job, response);
  if (['failed', 'cancelled', 'incomplete'].includes(String(response.status))) {
    const failed = await persistJob(user.userId, projectId, job.id, { status: 'failed',
      error: (response.error?.message || response.incomplete_details?.reason || 'Background response did not complete').slice(0, 400) });
    return Response.json({ job: safeJob(failed || job) });
  }
  const status = response.status === 'in_progress' ? 'in_progress' : 'queued';
  return Response.json({ job: safeJob({ ...job, status }) });
}
