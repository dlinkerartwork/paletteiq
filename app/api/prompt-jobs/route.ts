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
  projectId?: string; characterIds?: string[]; model?: string; regenerate?: boolean;
};
const safeJob = (job: PromptBatchJob) => ({
  id: job.id, status: job.status, total: job.total, imported: job.imported,
  failed: job.failed, processedGroups: job.processedGroups,
  totalGroups: job.totalGroups, model: job.model, createdAt: job.createdAt,
  updatedAt: job.updatedAt, error: job.error,
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

async function synchronize(owner: string, projectId: string) {
  const saved = await ownedProject(owner, projectId);
  if (!saved) return fail('Collection not found', 404);
  const job = saved.data.promptJob;
  if (!job) return Response.json({ job: null });
  if (!isActivePromptBatch(job)) return Response.json({ job: safeJob(job) });
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
