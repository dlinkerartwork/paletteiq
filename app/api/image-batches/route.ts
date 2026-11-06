import { env } from 'cloudflare:workers';
import { and, asc, count, desc, eq, notInArray } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { imageBatches, projects, studioSettings } from '@/db/schema';
import { userCredential } from '@/lib/credentials';
import { eligibleForBulk, retryableFailedImage, isActiveBatchStatus } from '@/lib/production-rules';
import { originalImagePrompt } from '@/lib/originality';
import { reviewImageSimilarity, type SimilarityReview } from '@/lib/similarity-review';
import { nativeAssetBucket } from '@/lib/native-bridge';
import { acquireProductionLocks } from '@/lib/production-locks';

const MODELS = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];
const syncingJobIds = new Set<string>();
type BatchItem = { id: string; status: 'pending' | 'done' | 'error'; imageUrl?: string; error?: string; similarityReview?: SimilarityReview };
type OpenAIBatch = { id: string; status: string; output_file_id?: string | null; error_file_id?: string | null; request_counts?: { total: number; completed: number; failed: number } };
const fail = (message: string, code = 400) => Response.json({ error: message }, { status: code });
const openai = async (key: string, path: string, init: RequestInit = {}) => {
  const res = await fetch(`https://api.openai.com/v1/${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, ...init.headers } });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 240)}`);
  return res;
};
const safeJob = (job: typeof imageBatches.$inferSelect) => ({
  id: job.id, status: job.status, model: job.model, createdAt: job.createdAt,
  characterIds: (JSON.parse(job.items) as BatchItem[]).map(i => i.id),
  total: job.total, completed: job.completed, failed: job.failed,
  imported: (JSON.parse(job.items) as BatchItem[]).filter(i => i.status !== 'pending').length,
  assets: (JSON.parse(job.items) as BatchItem[]).filter(i => i.status !== 'pending'),
});

// A batch can be submitted once, and OpenAI continues processing even if the tab closes.
export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return fail('Sign in required', 401);
  const data = await req.json() as { projectId?: string; characterIds?: string[]; model?: string; quality?: string; regenerate?: boolean };
  if (!data.projectId || !Array.isArray(data.characterIds) || !data.characterIds.length || data.characterIds.length > 120 || !MODELS.includes(data.model || '') || !['low','medium','high'].includes(data.quality || '')) return fail('Select 1–120 characters, a Batch model, and quality.');
  if (new Set(data.characterIds).size !== data.characterIds.length) return fail('Duplicate characters are not allowed.');
  const release = acquireProductionLocks(user.userId, data.projectId, data.characterIds);
  if (!release) return fail('A generation request for one of these characters is already being submitted.', 409);
  try {
  const db = getDb();
  const saved = await db.select().from(projects).where(and(eq(projects.id, data.projectId), eq(projects.owner, user.userId))).limit(1);
  if (!saved.length) return fail('Save the collection before submitting a batch.', 404);
  const project = JSON.parse(saved[0].data) as { characters?: Array<{ id: string; prompt: string; status?: string; imageUrl?: string }> };
  const selected = data.characterIds.map(id => project.characters?.find(c => c.id === id));
  if (data.regenerate && data.characterIds.length > 1 && selected.some(c => !c || !retryableFailedImage(c))) return fail('Bulk retry accepts only failed characters without saved images.');
  if (selected.some(c => !c?.prompt || (!data.regenerate && !eligibleForBulk(c)))) return fail('Bulk Batch accepts only never-generated prompts. Use explicit Retry Failed for unsuccessful images.');
  const previous = await db.select().from(imageBatches).where(and(eq(imageBatches.owner, user.userId), eq(imageBatches.projectId, data.projectId)));
  const activeIds = new Set(previous.filter(b => isActiveBatchStatus(b.status)).flatMap(b => (JSON.parse(b.items) as BatchItem[]).filter(i => i.status === 'pending').map(i => i.id)));
  if (data.characterIds.some(id => activeIds.has(id))) return fail('Some characters already have a pending Batch job.');
  const secret = (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
  const key = await userCredential(user.userId, 'openai') || secret;
  if (!key) return fail('Configure an OpenAI API key in Settings first.', 503);
  const settings = await db.select().from(studioSettings).where(eq(studioSettings.owner, user.userId)).limit(1);
  const prefs = settings[0] ? JSON.parse(settings[0].preferences) as { output?: string; background?: string } : {};
  const format = prefs.output === 'jpg' ? 'jpeg' : 'png';
  const background = prefs.background === 'opaque' || format === 'jpeg' ? 'opaque' : 'transparent';
  const lines = selected.map(c => JSON.stringify({ custom_id: c!.id, method: 'POST', url: '/v1/images/generations', body: { model: data.model, prompt: originalImagePrompt(c!.prompt, c!.id), quality: data.quality, size: '1024x1024', background, output_format: format, n: 1 } })).join('\n') + '\n';
  let createdBatchId: string | null = null;
  try {
    const form = new FormData();
    form.set('purpose', 'batch');
    form.set('file', new Blob([lines], { type: 'application/jsonl' }), 'paletteiq-batch.jsonl');
    const uploaded = await (await openai(key, 'files', { method: 'POST', body: form })).json() as { id: string };
    const job = await (await openai(key, 'batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input_file_id: uploaded.id, endpoint: '/v1/images/generations', completion_window: '24h', metadata: { application: 'paletteiq', project: data.projectId } }) })).json() as OpenAIBatch;
    createdBatchId = job.id;
    const now = Date.now();
    const record = { id: crypto.randomUUID(), owner: user.userId, projectId: data.projectId, openaiBatchId: job.id, model: data.model!, format, status: job.status, total: selected.length, completed: 0, failed: 0, items: JSON.stringify(data.characterIds.map(id => ({ id, status: 'pending' }))), outputFileId: null, errorFileId: null, createdAt: now, updatedAt: now };
    await db.insert(imageBatches).values(record);
    createdBatchId = null;
    return Response.json({ job: safeJob(record) });
  } catch (error) {
    if (createdBatchId) {
      try { await openai(key, `batches/${encodeURIComponent(createdBatchId)}/cancel`, { method: 'POST' }); }
      catch { return fail('OpenAI accepted a Batch, but local saving failed and cancellation could not be confirmed. Check OpenAI Batch activity before retrying to avoid duplicate charges.', 503); }
    }
    return fail(error instanceof Error ? error.message : 'Batch submission failed', 502);
  }
  } finally { release(); }
}

async function* jsonlLines(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1);
        if (line.trim()) yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield buffer;
  } finally { await reader.cancel().catch(() => {}); }
}

async function syncJob(job: typeof imageBatches.$inferSelect, key: string, owner: string) {
  if (syncingJobIds.has(job.id)) return job;
  syncingJobIds.add(job.id);
  try {
  const db = getDb();
  const savedProject = await db.select().from(projects).where(and(eq(projects.id, job.projectId), eq(projects.owner, owner))).limit(1);
  const reviewSources = savedProject.length ? JSON.parse(savedProject[0].data) as { selectedImageUrls?: string[]; images?: string[] } : {};
  const references = reviewSources.selectedImageUrls ?? reviewSources.images ?? [];
  const batch = await (await openai(key, `batches/${encodeURIComponent(job.openaiBatchId)}`)).json() as OpenAIBatch;
  const items = JSON.parse(job.items) as BatchItem[];
  const byId = new Map(items.map(i => [i.id, i]));
  const changedIds = new Set<string>();
  const isTerminal = ['completed', 'expired', 'cancelled', 'failed'].includes(batch.status);
  const bucket = nativeAssetBucket() ?? env.BUCKET;
  if (isTerminal && bucket) {
    let handled = 0;
    let interrupted = false;
    for (const fileId of [batch.output_file_id, batch.error_file_id].filter((x): x is string => !!x)) {
      const result = await openai(key, `files/${encodeURIComponent(fileId)}/content`);
      if (!result.body) continue;
      for await (const line of jsonlLines(result.body)) {
        let record: { custom_id?: string; response?: { body?: { data?: Array<{ b64_json?: string }>; error?: { message?: string } } }; error?: { message?: string } };
        try { record = JSON.parse(line); } catch { continue; }
        const item = record.custom_id ? byId.get(record.custom_id) : undefined;
        if (!item || item.status !== 'pending') continue;
        const b64 = record.response?.body?.data?.[0]?.b64_json as string | undefined;
        if (b64) {
          const extension = job.format === 'jpeg' ? 'jpg' : 'png';
          await bucket.put(`generated/${owner}/${record.custom_id}.${extension}`, Uint8Array.from(atob(b64), c => c.charCodeAt(0)), { httpMetadata: { contentType: extension === 'jpg' ? 'image/jpeg' : 'image/png' } });
          item.status = 'done'; item.imageUrl = `/api/images/${record.custom_id}?format=${extension}&v=${Date.now()}`;
          item.similarityReview = await reviewImageSimilarity(key, b64, extension === 'jpg' ? 'image/jpeg' : 'image/png', references);
        } else { item.status = 'error'; item.error = String(record.error?.message || record.response?.body?.error?.message || 'Batch item failed').slice(0, 260); }
        changedIds.add(item.id);
        handled++;
        if (handled >= 5) { interrupted = true; break; }
      }
      if (handled >= 5) break;
    }
    if (!interrupted) for (const item of items) if (item.status === 'pending') { item.status = 'error'; item.error = 'No output returned by OpenAI for this item.'; changedIds.add(item.id); }
  }
  const newCompleted = items.filter(i => i.status === 'done').length;
  const newFailed = items.filter(i => i.status === 'error').length;
  const importedAll = isTerminal && items.every(i => i.status !== 'pending');
  const status = importedAll ? (newFailed ? 'completed_with_errors' : 'completed') : isTerminal ? 'importing' : batch.status;
  const requestCompleted = batch.request_counts?.completed || 0;
  const requestFailed = batch.request_counts?.failed || 0;
  // Persist asset references in the collection BEFORE advancing job bookkeeping.
  // If this write fails, the job remains retriable rather than incorrectly marked complete.
  if (changedIds.size) {
    const saved = await db.select().from(projects).where(and(eq(projects.id, job.projectId), eq(projects.owner, owner))).limit(1);
    if (saved.length) {
      const project = JSON.parse(saved[0].data) as { characters?: Array<{ id: string; imageUrl?: string; status?: string; error?: string; similarityReview?: SimilarityReview }> };
      project.characters = project.characters?.map(c => { const item = changedIds.has(c.id) ? byId.get(c.id) : undefined; return item?.status === 'done' ? { ...c, imageUrl: item.imageUrl, status: 'done', error: '', similarityReview: item.similarityReview } : item?.status === 'error' ? { ...c, status: 'error', error: item.error } : c; });
      await db.update(projects).set({ data: JSON.stringify(project), updatedAt: Date.now() }).where(and(eq(projects.id, job.projectId), eq(projects.owner, owner)));
    } else throw new Error('Batch import paused: original collection missing; job remains recoverable.');
  }
  await db.update(imageBatches).set({ status, completed: Math.max(requestCompleted, newCompleted), failed: Math.max(requestFailed, newFailed), items: JSON.stringify(items), outputFileId: batch.output_file_id ?? null, errorFileId: batch.error_file_id ?? null, updatedAt: Date.now() }).where(and(eq(imageBatches.id, job.id), eq(imageBatches.owner, owner)));
  return { ...job, status, completed: Math.max(requestCompleted, newCompleted), failed: Math.max(requestFailed, newFailed), items: JSON.stringify(items) };
  } finally { syncingJobIds.delete(job.id); }
}

export async function GET(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return fail('Sign in required', 401);
  const url = new URL(req.url);
  if (url.searchParams.get('syncAll') === '1') {
    // Resume a bounded number of outstanding OpenAI batches after desktop
    // restart, even when the user is not on the Image Production page.
    const db = getDb();
    const activeCandidates = await db.select().from(imageBatches).where(and(eq(imageBatches.owner, user.userId), notInArray(imageBatches.status, ['completed', 'completed_with_errors', 'failed', 'cancelled', 'expired']))).orderBy(asc(imageBatches.updatedAt)).limit(30);
    // Fair polling across collections, while serializing updates within each collection.
    const seenProjects = new Set<string>();
    const active = activeCandidates.filter(row => {
      if (seenProjects.has(row.projectId) || seenProjects.size >= 2) return false;
      seenProjects.add(row.projectId);
      return true;
    });
    const key = await userCredential(user.userId, 'openai') || (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
    if (!key || !active.length) return Response.json({ updatedProjectIds: [], pendingJobs: active.length, credentialMissing: !key && active.length > 0 });
    const updatedProjectIds: string[] = [];
    const warnings: string[] = [];
    for (const row of active) {
      try { await syncJob(row, key, user.userId); updatedProjectIds.push(row.projectId); }
      catch (error) { warnings.push(error instanceof Error ? error.message : 'Batch recovery failed'); }
    }
    return Response.json({ updatedProjectIds: [...new Set(updatedProjectIds)], pendingJobs: active.length, warnings });
  }
  if (url.searchParams.get('activity') === '1') {
    const pageSize = Number(url.searchParams.get('limit') || '25');
    const offset = Number(url.searchParams.get('offset') || '0');
    if (![10, 25, 50, 100].includes(pageSize) || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) return fail('Invalid activity pagination');
    const db = getDb();
    const owner = eq(imageBatches.owner, user.userId);
    const [totals, recent, ownedProjects] = await Promise.all([
      db.select({ value: count() }).from(imageBatches).where(owner),
      db.select().from(imageBatches).where(owner).orderBy(desc(imageBatches.createdAt), desc(imageBatches.id)).limit(pageSize).offset(offset),
      db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.owner, user.userId)),
    ]);
    const labels = new Map(ownedProjects.map(project => [project.id, project.name]));
    return Response.json({ total: totals[0]?.value ?? 0, activities: recent.map(job => ({ collection: labels.get(job.projectId) ?? 'Deleted collection', job: safeJob(job) })) });
  }
  const projectId = url.searchParams.get('projectId');
  if (!projectId) return fail('Missing project ID');
  const db = getDb();
  const saved = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.owner, user.userId))).limit(1);
  if (!saved.length) return fail('Unknown project', 404);
  const rows = await db.select().from(imageBatches).where(and(eq(imageBatches.owner, user.userId), eq(imageBatches.projectId, projectId))).orderBy(desc(imageBatches.createdAt)).limit(200);
  const key = await userCredential(user.userId, 'openai') || (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
  const sync = new URL(req.url).searchParams.get('sync') === '1';
  const syncTarget = rows.find(row => isActiveBatchStatus(row.status))?.id;
  const jobs = await Promise.all(rows.map(async row => {
    if (!sync || !key || row.id !== syncTarget) return safeJob(row);
    try { return safeJob(await syncJob(row, key, user.userId)); }
    catch (error) { return { ...safeJob(row), warning: error instanceof Error ? error.message : 'Unable to sync' }; }
  }));
  return Response.json({ jobs });
}
