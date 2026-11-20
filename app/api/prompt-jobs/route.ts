import { env } from 'cloudflare:workers';
import { sharedProviderSecret } from '@/lib/store-secrets';
import { and, eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { userCredential } from '@/lib/credentials';
import {
  buildPromptBatchInput, isActivePromptBatch, parsePromptBatchOutput,
  promptFingerprint, type PromptBatchJob, type PromptProject,
} from '@/lib/prompt-batch-jobs';

const fail = (error: string, status = 400) => Response.json({ error }, { status });

const MAX_PROMPTS = 200;
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired']);
type RemoteBatch = {
  id: string; status: string; output_file_id?: string | null;
  error_file_id?: string | null; request_counts?: { total: number; completed: number; failed: number };
  errors?: { data?: Array<{ message?: string }> };
};
type PromptRequest = {
  projectId?: string; characterIds?: string[]; model?: string; regenerate?: boolean; progressive?: boolean;
};
const safeJob = (job: PromptBatchJob) => ({
  id: job.id, status: job.status, total: job.total, imported: job.imported,
  failed: job.failed, processedGroups: job.processedGroups,
  totalGroups: job.totalGroups, model: job.model, createdAt: job.createdAt,
  updatedAt: job.updatedAt, error: job.error,
  mode:job.mode||'batch',groupStates:job.progressiveBatches?.map(g=>({key:g.key,status:g.status,error:g.error})),
});
async function openai(key: string, path: string, options: RequestInit = {}) {
  const response = await fetch('https://api.openai.com/v1/' + path, {
    ...options, headers: { Authorization: 'Bearer ' + key, ...options.headers },
  });
  if (!response.ok) throw new Error('OpenAI ' + response.status + ': ' + (await response.text()).slice(0, 240));
  return response;
}
async function ownedProject(owner: string, projectId: string) {
  if (!/^[\w-]{8,80}$/.test(projectId)) return null;
  const rows = await getDb().select().from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.owner, owner))).limit(1);
  return rows[0] ? { row: rows[0], data: JSON.parse(rows[0].data) as PromptProject } : null;
}
async function saveJob(owner: string, projectId: string, jobId: string, changes: Partial<PromptBatchJob>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const saved = await ownedProject(owner, projectId);
    if (!saved || saved.data.promptJob?.id !== jobId) return null;
    const job = { ...saved.data.promptJob, ...changes, updatedAt: Date.now() };
    const data = { ...saved.data, promptJob: job };
    const result = await getDb().update(projects)
      .set({ data: JSON.stringify(data), updatedAt: Math.max(Date.now(), saved.row.updatedAt + 1) })
      .where(and(eq(projects.id, projectId), eq(projects.owner, owner), eq(projects.updatedAt, saved.row.updatedAt)))
      .returning({ id: projects.id });
    if (result.length) return job;
  }
  return null;
}
async function markFailed(owner: string, projectId: string, jobId: string, reason: string) {
  return saveJob(owner, projectId, jobId, { status: 'failed', error: reason.slice(0, 500) });
}

export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return fail('Sign in required', 401);
  let body: PromptRequest;
  try { body = await req.json() as PromptRequest; } catch { return fail('Invalid JSON'); }
  const projectId = String(body.projectId || '');
  const ids = body.characterIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_PROMPTS ||
      ids.some(x => typeof x !== 'string' || !/^[\w-]{1,120}$/.test(x)) ||
      new Set(ids).size !== ids.length)
    return fail('Select 1–' + MAX_PROMPTS + ' distinct character IDs.');
  const model = String(body.model || '');
  if (!/^gpt-[a-z0-9.-]{1,80}$/.test(model)) return fail('Select a valid OpenAI GPT text model');
  const saved = await ownedProject(user.userId, projectId);
  if (!saved) return fail('Save the collection before starting background prompts.', 404);
  // A Full Automation text model is chosen in Research & Analysis and stored
  // with the collection. Do not allow another tab/client to override it for
  // a paid Prompt Batch once the workflow is active.
  const automation = (saved.data as typeof saved.data & {
    fullAutomation?: { enabled?: boolean; stage?: string; textModel?: string; promptModel?: string };
    researchModel?: string;
  }).fullAutomation;
  if (automation?.enabled && automation.stage !== 'completed') {
    const selected = automation.promptModel || automation.textModel ||
      (saved.data as typeof saved.data & { researchModel?: string }).researchModel;
    if (selected && model !== selected)
      return fail('Full Automation Prompt model must match the frozen AI Prompts model: ' + selected, 409);
  }
  if (isActivePromptBatch(saved.data.promptJob))
    return Response.json({ error: 'This collection already has an active prompt batch. Resume it rather than submitting a duplicate.', job: safeJob(saved.data.promptJob!) }, { status: 409 });
  const byId = new Map(saved.data.characters.map(c => [c.id, c]));
  const selected = ids.map(x => byId.get(x));
  if (selected.some(c => !c || !c.name.trim())) return fail('Some selected characters are missing or have no names.', 422);
  if (selected.some(c => c?.prompt?.trim()) && body.regenerate !== true)
    return fail('Some prompts already exist. Confirm regeneration before submitting a batch.', 409);
  const key = await userCredential(user.userId, 'openai') || sharedProviderSecret(user.userId, 'OPENAI_API_KEY');
  if (!key) return fail('Connect an OpenAI API key in Settings before generating prompts.', 503);
  const generation = buildPromptBatchInput(saved.data, selected as NonNullable<typeof selected[number]>[], model);
  if (generation.jsonl.length > 3_000_000) return fail('Prompt batch is too large. Select fewer characters.', 413);
  const now = Date.now();
  const job: PromptBatchJob = {
    id: crypto.randomUUID(), status: 'submitting', model,
    createdAt: now, updatedAt: now, total: selected.length,
    imported: 0, failed: 0, processedGroups: 0, totalGroups: generation.groups.length,
    groups: generation.groups, regenerate: body.regenerate === true,
    ...{mode:'standard' as const,progressiveJsonl:generation.jsonl,
      progressiveBatches:generation.groups.map(g=>({key:g.key,status:'planned' as const}))},
    items: selected.map(c => ({ id: c!.id, originalFingerprint: promptFingerprint(c!.prompt || ''), status: 'pending' })),
  };
  // Claim the collection atomically before spending credits. Closing the
  // browser after Batch acceptance will not cancel server-side processing.
  const claimed = await getDb().update(projects)
    .set({ data: JSON.stringify({ ...saved.data, promptJob: job }),
      updatedAt: Math.max(now, saved.row.updatedAt + 1) })
    .where(and(eq(projects.id, projectId), eq(projects.owner, user.userId), eq(projects.updatedAt, saved.row.updatedAt)))
    .returning({ id: projects.id });
  if (!claimed.length) return fail('Collection changed in another tab. Refresh and retry.', 409);
  if (job.mode==='standard') {
    // Progressive mode was explicitly selected and the collection claimed
    // BEFORE any paid submission. Each group is one independent OpenAI Batch.
    // The first three are launched now; further groups start when the previous
    // groups finish, via the persisted scheduler. None is ever re-submitted.
    try {
      const submitted=await progressPromptBatches(user.userId,projectId,job.id,key, generation.jsonl);
      return Response.json({job:safeJob(submitted||job)},{status:202});
    } catch(error) {
      return fail('Progressive prompt submission needs inspection: ' +
        (error instanceof Error?error.message:String(error)).slice(0,250),503);
    }
  }
  let remoteBatchId: string | null = null;
  try {
    const form = new FormData();
    form.set('purpose', 'batch');
    form.set('file', new Blob([generation.jsonl], { type: 'application/jsonl' }), 'paletteiq-prompt-batch.jsonl');
    const uploaded = await (await openai(key, 'files', { method: 'POST', body: form })).json() as { id?: string };
    if (!uploaded.id) throw new Error('OpenAI did not return an input file ID.');
    const remote = await (await openai(key, 'batches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input_file_id: uploaded.id, endpoint: '/v1/responses',
        completion_window: '24h', metadata: { app: 'paletteiq', action: 'prompt_generation' } }),
    })).json() as RemoteBatch;
    if (!remote.id) throw new Error('OpenAI did not return a Batch ID.');
    remoteBatchId = remote.id;
    const persisted = await saveJob(user.userId, projectId, job.id, {
      batchId: remote.id, status: remote.status || 'validating',
    });
    if (!persisted) throw new Error('OpenAI accepted the Batch, but saving the remote tracking ID failed.');
    return Response.json({ job: safeJob(persisted) }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (remoteBatchId) {
      try {
        await openai(key, 'batches/' + encodeURIComponent(remoteBatchId) + '/cancel', { method: 'POST' });
      } catch {
        await markFailed(user.userId, projectId, job.id,
          'OpenAI accepted the Batch but PaletteIQ could not save its ID. Cancellation is unconfirmed. Check OpenAI Batch activity before retrying.');
        return fail('OpenAI Batch status needs manual verification before another paid submission.', 503);
      }
    }
    await markFailed(user.userId, projectId, job.id, message);
    return fail(message.slice(0, 350), 502);
  }
}

const PROGRESSIVE_ACTIVE_LIMIT=3;
const progressiveLocks=new Set<string>();
async function updateProgressiveJob(owner:string, projectId:string, jobId:string,
  transform:(job:PromptBatchJob)=>PromptBatchJob):Promise<PromptBatchJob|null> {
  for(let attempt=0;attempt<8;attempt++){
    const saved=await ownedProject(owner,projectId);
    if(!saved||saved.data.promptJob?.id!==jobId) return null;
    const changed={...transform(saved.data.promptJob),updatedAt:Date.now()};
    const result=await getDb().update(projects)
      .set({data:JSON.stringify({...saved.data,promptJob:changed}),
        updatedAt:Math.max(Date.now(),saved.row.updatedAt+1)})
      .where(and(eq(projects.id,projectId),eq(projects.owner,owner),eq(projects.updatedAt,saved.row.updatedAt)))
      .returning({id:projects.id});
    if(result.length) return changed;
  }
  throw Error('Concurrent prompt Batch status update. No retry of paid submissions was attempted.');
}
async function progressiveGroupUpdate(owner:string,id:string,jobId:string,groupKey:string,
  update:Partial<NonNullable<PromptBatchJob['progressiveBatches']>[number]>) {
  return updateProgressiveJob(owner,id,jobId,job=>({
    ...job,progressiveBatches:(job.progressiveBatches||[]).map(group=>
      group.key===groupKey && !['completed','failed','uncertain'].includes(group.status)
        ? {...group,...update}:group),
  }));
}
async function submitProgressiveGroup(owner:string,id:string,jobId:string,key:string,groupKey:string,line:string) {
  let claimed=false;
  const job=await updateProgressiveJob(owner,id,jobId,current=>{
    const group=current.progressiveBatches?.find(g=>g.key===groupKey);
    claimed=group?.status==='planned';
    return claimed?{...current,progressiveBatches:current.progressiveBatches?.map(g=>g.key===groupKey?
      {...g,status:'submitting' as const,startedAt:Date.now()}:g)}:current;
  });
  if(!claimed||!job) return;
  try{
    if(job.mode==='standard'){
      const request=JSON.parse(line) as {body?:Record<string,unknown>};
      if(!request.body)throw Error('Original standard prompt request body missing');
      const remote=await (await openai(key,'responses',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...request.body,background:true,store:true}),
      })).json() as {id?:string;status?:string};
      if(!remote.id||!/^resp_[\\w-]+$/.test(remote.id))
        throw Error('Standard prompt response accepted without a tracking ID');
      await progressiveGroupUpdate(owner,id,jobId,groupKey,{
        responseId:remote.id,status:remote.status==='in_progress'?'in_progress':'queued'});
    }else{
      // Preserve original Batch behavior for jobs created before the migration.
      const form=new FormData();
      form.set('purpose','batch');
      form.set('file',new Blob([line+'\\n'],{type:'application/jsonl'}),'paletteiq-progressive-'+groupKey+'.jsonl');
      const upload=await (await openai(key,'files',{method:'POST',body:form})).json() as {id?:string};
      if(!upload.id) throw Error('No OpenAI input file ID');
      const remote=await (await openai(key,'batches',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({input_file_id:upload.id,endpoint:'/v1/responses',
          completion_window:'24h',metadata:{app:'paletteiq',action:'progressive_prompts',group:groupKey}}),
      })).json() as RemoteBatch;
      if(!remote.id) throw Error('No OpenAI Batch receipt ID');
      await progressiveGroupUpdate(owner,id,jobId,groupKey,{batchId:remote.id,status:'queued'});
    }
  }catch(error){
    // Even with no saved batch ID a provider-side acceptance is possible.
    // Never submit the same group again automatically.
    await progressiveGroupUpdate(owner,id,jobId,groupKey,{
      status:'uncertain',error:'Submission may have reached OpenAI. Inspect Batch activity before retrying: '+
        (error instanceof Error?error.message:String(error)).slice(0,180),
    }).catch(()=>{});
  }
}
async function progressPromptBatches(owner:string,id:string,jobId:string,key:string,jsonl?:string) {
  const lock=owner+':'+id+':progressive-prompts';
  if(progressiveLocks.has(lock)) return (await ownedProject(owner,id))?.data.promptJob||null;
  progressiveLocks.add(lock);
  try {
    const stored=await ownedProject(owner,id);
    const job=stored?.data.promptJob;
    if(!job||job.id!==jobId||job.mode!=='progressive') return null;
    const groups=job.progressiveBatches||[];
    const active=groups.filter(g=>['submitting','queued','in_progress'].includes(g.status)).length;
    const capacity=Math.max(0,PROGRESSIVE_ACTIVE_LIMIT-active);
    if(!capacity) return job;
    const planned=groups.filter(g=>g.status==='planned').slice(0,capacity);
    if(!planned.length)return job;
    // All delayed group requests reuse the exact JSONL approved when the user
    // started the job. Never rebuild from a potentially edited collection.
    const immutableInput=job.progressiveJsonl||jsonl;
    if(!immutableInput) throw Error('Original progressive request data missing; no paid job submitted');
    const lines=immutableInput.trim().split('\n');
    const groupLines=new Map(job.groups.map((group,index)=>[group.key,lines[index]]));
    await Promise.all(planned.map(g=>groupLines.get(g.key)?
      submitProgressiveGroup(owner,id,jobId,key,g.key,groupLines.get(g.key)!):Promise.resolve()));
    const refreshed=(await ownedProject(owner,id))?.data.promptJob||job;
    if(refreshed.status==='submitting' && refreshed.progressiveBatches?.some(g=>!!(g.batchId||g.responseId)))
      return await saveJob(owner,id,jobId,{status:'in_progress'})||refreshed;
    return refreshed;
  }finally{progressiveLocks.delete(lock);}
}
async function synchronizeProgressive(owner:string,id:string,job:PromptBatchJob) {
  const key=await userCredential(owner,'openai')||sharedProviderSecret(owner,'OPENAI_API_KEY');
  if(!key) return fail('OpenAI key missing for progressive prompt recovery',503);
  // Read each original receipt only. Polling may run in multiple windows;
  // versioned imports ensure a group cannot import twice.
  const settled=await Promise.all((job.progressiveBatches||[])
    .filter(g=>(g.batchId||g.responseId)&&['queued','in_progress'].includes(g.status))
    .map(async group=>{
      try{
        const response=group.responseId
          ? await (await openai(key,'responses/'+encodeURIComponent(group.responseId))).json() as {
              status?:string;output?:Array<{content?:Array<{text?:string}>}>;error?:{message?:string};
            }
          : null;
        const remote=group.batchId
          ? await (await openai(key,'batches/'+encodeURIComponent(group.batchId))).json() as RemoteBatch
          : {status:response?.status||'in_progress'} as RemoteBatch;
        if(!TERMINAL.has(remote.status) && remote.status!=='incomplete'){
          await progressiveGroupUpdate(owner,id,job.id,group.key,{status:'in_progress'});
          return;
        }
        if(group.batchId && remote.status==='completed'&&!remote.output_file_id&&!remote.error_file_id) return;
        const parts:string[]=[];
        for(const fileId of [remote.output_file_id,remote.error_file_id].filter((x):x is string=>!!x)){
          const text=await (await openai(key,'files/'+encodeURIComponent(fileId)+'/content')).text();
          if(text.length>3_000_000)throw Error('Group result file too large');
          parts.push(text);
        }
        const groupSpec=job.groups.filter(g=>g.key===group.key);
        // Standard Responses return the same JSON payload directly; only the
        // older Batch transport requires JSONL output-file parsing.
        const parsed=group.responseId
          ? (() => {
              const raw=response?.output?.flatMap(o=>o.content||[]).map(c=>c.text||'').join('')||'';
              const prompts=new Map<string,string>();
              const errors=new Map<string,string>();
              try{
                const decoded=JSON.parse(raw) as {prompts?:Array<{id?:string;prompt?:string}>};
                const allowed=new Set(groupSpec.flatMap(g=>g.ids));
                for(const item of decoded.prompts||[])
                  if(item.id&&allowed.has(item.id)&&typeof item.prompt==='string'&&item.prompt.trim())
                    prompts.set(item.id,item.prompt.trim());
              }catch{errors.set(group.key,'Invalid JSON from standard Responses API');}
              return {prompts,errors};
            })()
          : parsePromptBatchOutput(parts.join('\\n'),groupSpec);
        for(let attempt=0;attempt<6;attempt++){
          const current=await ownedProject(owner,id);
          if(!current||current.data.promptJob?.id!==job.id)return;
          if(['completed','failed'].includes(current.data.promptJob.progressiveBatches?.find(g=>g.key===group.key)?.status||''))return;
          const chars=current.data.characters.map(c=>({...c}));
          const byId=new Map(chars.map(c=>[c.id,c]));
          const items=current.data.promptJob.items.map(item=>{
            if(!groupSpec[0]?.ids.includes(item.id)||item.status!=='pending')return item;
            const character=byId.get(item.id);
            if(!character||promptFingerprint(character.prompt||'')!==item.originalFingerprint)
              return {...item,status:'skipped' as const,error:'Manually edited or deleted; original prompt preserved.'};
            const prompt=parsed.prompts.get(item.id);
            if(!prompt)return {...item,status:'error' as const,error:parsed.errors.get(item.id)||'No valid prompt'};
            character.prompt=prompt;
            if(character.status!=='done')character.status='ready';
            return {...item,status:'done' as const};
          });
          const nextGroups=current.data.promptJob.progressiveBatches?.map(g=>g.key===group.key?
            {...g,status:(remote.status==='completed'?'completed':'failed') as 'completed'|'failed',
              ...(remote.status!=='completed'?{error:remote.status}:{})}:g);
          const newJob={...current.data.promptJob,progressiveBatches:nextGroups,items,
            imported:items.filter(i=>i.status==='done').length,
            failed:items.filter(i=>['error','skipped'].includes(i.status)).length,
            processedGroups:nextGroups?.filter(g=>['completed','failed','uncertain'].includes(g.status)).length||0,
            updatedAt:Date.now()};
          const committed=await getDb().update(projects).set({
            data:JSON.stringify({...current.data,characters:chars,promptJob:newJob}),
            updatedAt:Math.max(Date.now(),current.row.updatedAt+1),
          }).where(and(eq(projects.id,id),eq(projects.owner,owner),eq(projects.updatedAt,current.row.updatedAt)))
            .returning({id:projects.id});
          if(committed.length)return;
        }
      }catch(error){
        // Import/network failures do not resubmit the paid group.
        await progressiveGroupUpdate(owner,id,job.id,group.key,{
          error:'Prompt result status needs inspection: '+
            (error instanceof Error?error.message:String(error)).slice(0,180),
        }).catch(()=>{});
      }
    }));
  void settled;
  const latest=await ownedProject(owner,id);
  let updated=latest?.data.promptJob;
  if(!updated||updated.id!==job.id)return fail('Progressive job tracking changed',409);
  // Interruption with no Batch ID is ambiguous, not an invitation to retry.
  for(const group of updated.progressiveBatches||[]){
    if(group.status==='submitting'&&!group.batchId&&!group.responseId &&
      Date.now()-(group.startedAt||updated.createdAt)>120000)
      await progressiveGroupUpdate(owner,id,job.id,group.key,{status:'uncertain',
        error:'No saved Batch ID after interrupted submission. Check OpenAI usage.'});
  }
  updated=(await ownedProject(owner,id))?.data.promptJob;
  if(!updated)return fail('Progressive job missing',409);
  const groups=updated.progressiveBatches||[];
  if(groups.some(g=>g.status==='uncertain')){
    // Continue importing all ALREADY accepted groups before pausing the
    // workflow. Never send planned groups once any receipt is uncertain.
    const running=groups.some(g=>['submitting','queued','in_progress'].includes(g.status));
    if(running){
      const fresh=await ownedProject(owner,id);
      return Response.json({job:safeJob(fresh?.data.promptJob||updated),project:fresh?.data});
    }
    const failed=await saveJob(owner,id,job.id,{status:'failed',
      error:'A progressive group has uncertain paid submission status. Check OpenAI Batch activity before retrying.'});
    const fresh=await ownedProject(owner,id);
    return Response.json({job:safeJob(failed||updated),project:fresh?.data});
  }
  if(groups.every(g=>['completed','failed'].includes(g.status))){
    const finished=await saveJob(owner,id,job.id,{
      status:updated.failed||groups.some(g=>g.status==='failed')?'completed_with_errors':'completed',
      processedGroups:groups.length,
    });
    const fresh=await ownedProject(owner,id);
    return Response.json({job:safeJob(finished||updated),project:fresh?.data});
  }
  await progressPromptBatches(owner,id,job.id,key);
  const fresh=await ownedProject(owner,id);
  return Response.json({job:safeJob(fresh?.data.promptJob||updated),project:fresh?.data});
}

async function synchronize(owner: string, projectId: string) {
  const saved = await ownedProject(owner, projectId);
  if (!saved) return fail('Collection not found', 404);
  const job = saved.data.promptJob;
  if (!job) return Response.json({ job: null });
  if (!isActivePromptBatch(job)) return Response.json({ job: safeJob(job) });
  if (job.mode==='progressive'||job.mode==='standard') return synchronizeProgressive(owner,projectId,job);
  if (!job.batchId) {
    if (job.status === 'submitting' && Date.now() - job.createdAt > 120_000) {
      const failed = await markFailed(owner, projectId, job.id,
        'Submission was interrupted before storing the Batch ID. Check OpenAI usage before retrying; do not automatically resubmit.');
      return Response.json({ job: safeJob(failed || job) });
    }
    return Response.json({ job: safeJob(job) });
  }
  const key = await userCredential(owner, 'openai') || sharedProviderSecret(owner, 'OPENAI_API_KEY');
  if (!key) return fail('OpenAI API key unavailable for background prompt recovery.', 503);
  const remote = await (await openai(key, 'batches/' + encodeURIComponent(job.batchId))).json() as RemoteBatch;
  const processedGroups = (remote.request_counts?.completed || 0) + (remote.request_counts?.failed || 0);
  if (!TERMINAL.has(remote.status)) {
    const updated = await saveJob(owner, projectId, job.id, {
      status: remote.status, processedGroups: Math.max(job.processedGroups, processedGroups),
    });
    return Response.json({ job: safeJob(updated || { ...job, status: remote.status, processedGroups }) });
  }
  // A finished remote batch may not publish its result files immediately.
  if (remote.status === 'completed' && !remote.output_file_id && !remote.error_file_id)
    return Response.json({ job: safeJob({ ...job, status: 'importing', processedGroups }) });
  const files = [remote.output_file_id, remote.error_file_id].filter((x): x is string => !!x);
  const outputParts: string[] = [];
  for (const fileId of files) {
    const file = await openai(key, 'files/' + encodeURIComponent(fileId) + '/content');
    if (Number(file.headers.get('content-length') || 0) > 10_000_000)
      return fail('Prompt batch result exceeds the import limit; contact support before retrying.', 413);
    const body = await file.text();
    if (body.length > 10_000_000) return fail('Prompt batch result too large; check OpenAI Batch results.', 413);
    outputParts.push(body);
  }
  const result = parsePromptBatchOutput(outputParts.join('\n'), job.groups);
  const latest = await ownedProject(owner, projectId);
  if (!latest || latest.data.promptJob?.id !== job.id)
    return fail('Prompt batch changed while importing. Reopen the collection.', 409);
  const characters = new Map(latest.data.characters.map(c => [c.id, c]));
  const items = latest.data.promptJob.items.map(item => {
    if (item.status !== 'pending') return item;
    const character = characters.get(item.id);
    if (!character) return { ...item, status: 'skipped' as const, error: 'Character was deleted before prompt import.' };
    if (promptFingerprint(character.prompt || '') !== item.originalFingerprint)
      return { ...item, status: 'skipped' as const, error: 'This prompt was edited while the Batch was running; the newer manual prompt was preserved.' };
    const prompt = result.prompts.get(item.id);
    if (!prompt) return { ...item, status: 'error' as const,
      error: result.errors.get(item.id) || remote.errors?.data?.[0]?.message || 'OpenAI did not return a valid prompt.' };
    character.prompt = prompt;
    if (character.status !== 'done') character.status = 'ready';
    return { ...item, status: 'done' as const };
  });
  const imported = items.filter(x => x.status === 'done').length;
  const failed = items.filter(x => x.status === 'error' || x.status === 'skipped').length;
  const nextJob: PromptBatchJob = {
    ...latest.data.promptJob, items, imported, failed,
    processedGroups: job.totalGroups, updatedAt: Date.now(),
    status: remote.status === 'completed' ? (failed ? 'completed_with_errors' : 'completed') : remote.status,
    ...(remote.status !== 'completed' ? { error: 'OpenAI Batch ended with status ' + remote.status } : {}),
  };
  const updated = { ...latest.data, characters: latest.data.characters, promptJob: nextJob };
  // Import prompts and mark the job complete in ONE version-guarded write, so
  // another tab cannot silently overwrite a manually changed prompt.
  const commit = await getDb().update(projects)
    .set({ data: JSON.stringify(updated), updatedAt: Math.max(Date.now(), latest.row.updatedAt + 1) })
    .where(and(eq(projects.id, projectId), eq(projects.owner, owner), eq(projects.updatedAt, latest.row.updatedAt)))
    .returning({ id: projects.id });
  if (!commit.length) return Response.json({ job: safeJob(job), retryImport: true });
  return Response.json({ job: safeJob(nextJob), project: updated });
}

export async function GET(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return fail('Sign in required', 401);
  const projectId = new URL(req.url).searchParams.get('projectId') || '';
  try { return await synchronize(user.userId, projectId); }
  catch (error) {
    return fail('Prompt batch status check failed: ' + (error instanceof Error ? error.message : String(error)).slice(0, 300), 502);
  }
}
