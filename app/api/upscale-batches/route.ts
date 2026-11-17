import { and, eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getAccountSession } from '@/lib/palette-accounts';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import {
  gpuConfig, gpuFetch, ownedUpscaleProject, upscaleBucket, upscaleSourceKey,
  type GpuBatchSnapshot, type StoredUpscaleBatch, type UpscaleBatchProject,
} from '@/lib/upscale-batch-transport';

const bad = (message: string, code = 400) => Response.json({ error: message }, { status: code });
const allowedModels = new Set(['realesrgan-x4plus','realesrgan-x4plus-anime','realesrnet-x4plus','realesr-animevideov3','real-hat-gan-sharper-x4']);
const isUuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
const safeIds = (input: unknown) => Array.isArray(input) && input.length >= 1 && input.length <= 200 &&
  input.every(isUuid) && new Set(input).size === input.length;
type Input = { projectId?: string; characterIds?: string[]; characterId?: string; factor?: number };
type User = NonNullable<Awaited<ReturnType<typeof getChatGPTUser>>>;
async function request(req: Request): Promise<Input> {
  try { return await req.json() as Input; } catch { throw Error('Invalid JSON request'); }
}
function failure(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  const status = /Collection not found|not owned/i.test(message) ? 404 :
    /HTTP 409|changed|already|active/i.test(message) ? 409 : 502;
  return bad(message.slice(0, 360), status);
}
async function persistBatch(owner: string, projectId: string, job: StoredUpscaleBatch) {
  for (let retry = 0; retry < 3; retry++) {
    const latest = await ownedUpscaleProject(owner, projectId);
    const current = latest.data.upscaleBatch;
    if (current && current.id !== job.id && current.status !== 'completed') throw Error('Another upscale batch is already active for this collection');
    const changed = await getDb().update(projects)
      .set({ data: JSON.stringify({ ...latest.data, upscaleBatch: job }), updatedAt: Math.max(Date.now(), latest.row.updatedAt + 1) })
      .where(and(eq(projects.id, projectId), eq(projects.owner, owner), eq(projects.updatedAt, latest.row.updatedAt)))
      .returning({ id: projects.id });
    if (changed.length) return;
  }
  throw Error('Collection changed while saving batch. Refresh and retry without creating a duplicate');
}
async function loadBatch(owner: string, projectId: string) {
  const latest = await ownedUpscaleProject(owner, projectId);
  if (!latest.data.upscaleBatch) throw Error('No upscale Batch for this collection');
  return latest.data.upscaleBatch;
}
async function importAcceptedJobs(owner: string, projectId: string, snapshot: GpuBatchSnapshot) {
  if (snapshot.status === 'staging' || !snapshot.files?.length) return [];
  for (let retry = 0; retry < 3; retry++) {
    const latest = await ownedUpscaleProject(owner, projectId);
    const batch = latest.data.upscaleBatch;
    if (!batch || batch.remoteId !== snapshot.id) throw Error('Upscale batch changed while synchronizing');
    const fileMap = new Map(snapshot.files.map(file => [file.client_file_id, file]));
    let modified = false;
    const found: Array<{ characterId: string; job: NonNullable<UpscaleBatchProject['characters'][number]['upscaleJob']> }> = [];
    for (const item of batch.items) {
      const file = fileMap.get(item.characterId);
      if (!file?.job_id || !/^[0-9a-f]{32}$/.test(file.job_id)) continue;
      const target = latest.data.characters.find(char => char.id === item.characterId);
      if (!target || target.imageUrl !== item.originalUrl ||
          (target.upscaledImageUrl || target.imageUrl) !== item.sourceUrl) continue;
      const newJob = {
        id: file.job_id, sourceUrl: item.sourceUrl, originalUrl: item.originalUrl,
        factor: batch.factor, requireTransparency: batch.requireTransparency,
        qc: batch.qc, submittedAt: batch.createdAt,
      };
      // A completed result may already have been imported and the job cleared.
      if (target.upscaleJob?.id === file.job_id) {
        found.push({ characterId: item.characterId, job: newJob });
        continue;
      }
      if (target.upscaleJob) continue;
      if (file.status === 'completed' && target.upscaledImageUrl !== item.sourceUrl &&
          target.upscaledImageUrl !== undefined) continue;
      target.upscaleJob = newJob; found.push({ characterId: item.characterId, job: newJob }); modified = true;
    }
    const finished = snapshot.files.length === batch.items.length &&
      snapshot.files.every(file => ['completed','failed','cancelled'].includes(file.status || ''));
    const status = finished ? 'completed' : 'committed';
    if (batch.status !== status) { latest.data.upscaleBatch = { ...batch, status }; modified = true; }
    if (!modified) return found;
    const saved = await getDb().update(projects)
      .set({ data: JSON.stringify(latest.data), updatedAt: Math.max(Date.now(), latest.row.updatedAt + 1) })
      .where(and(eq(projects.id, projectId), eq(projects.owner, owner), eq(projects.updatedAt, latest.row.updatedAt)))
      .returning({ id: projects.id });
    if (saved.length) return found;
  }
  throw Error('Collection was edited during batch import; check again');
}
export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  try {
    const body = await request(req);
    if (!body.projectId || !safeIds(body.characterIds)) return bad('Select 1–200 distinct generated image IDs');
    const selectedIds = body.characterIds as string[];
    const factor = body.factor ?? 4;
    if (![2,4,6,8].includes(factor)) return bad('Choose 2×, 4×, 6× or 8×');
    const { data } = await ownedUpscaleProject(user.userId, body.projectId);
    const active = data.upscaleBatch;
    const current = selectedIds.map(id => data.characters.find(c => c.id === id));
    const matching = active && active.items.length === current.length &&
      active.items.every(item => selectedIds.includes(item.characterId)) && active.factor === factor;
    if (active && active.status !== 'completed' && !matching)
      return bad('This collection has an unfinished upscale Batch. Resume its uploads instead of creating another.', 409);
    if (current.some(c => !c?.imageUrl || (c.upscaleJob && !matching)))
      return bad('One or more selected images are missing, or already being upscaled.', 422);
    const config = await gpuConfig(user.userId);
    const prefs = config.prefs;
    const session = await getAccountSession();
    const model = typeof prefs.upscaleModel === 'string' ? prefs.upscaleModel : 'realesrgan-x4plus';
    const cleanupStrength = typeof prefs.upscaleCleanupStrength === 'string' ? prefs.upscaleCleanupStrength : 'low';
    if (!allowedModels.has(model) || !['low','medium','high'].includes(cleanupStrength)) return bad('Invalid GPU model or cleanup settings');
    const job: StoredUpscaleBatch = active && active.status !== 'completed'
      ? active : {
        id: crypto.randomUUID(), status: 'staging',
        items: current.map(c => ({ characterId: c!.id, sourceUrl: c!.upscaledImageUrl || c!.imageUrl!,
          originalUrl: c!.imageUrl! })),
        model, factor: factor as 2|4|6|8, cleanup: prefs.upscaleCleanup === true,
        cleanupStrength, requireTransparency: prefs.upscaleRequireTransparency !== false,
        qc: prefs.upscaleQc !== false, createdAt: Date.now(), notificationEmail: user.email,
      };
    if (!active || active.status === 'completed') await persistBatch(user.userId, body.projectId, job);
    // Stable client batch ID: network retries cannot create duplicate GPU work.
    const response = await gpuFetch(user.userId, '/v1/batches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_batch_id: job.id, expected_files: job.items.length, model: job.model,
        scale: job.factor, edge_cleanup: job.cleanup, cleanup_strength: job.cleanupStrength,
        notification_email: job.notificationEmail,
        store_name: session?.storeName || 'PaletteIQ Etsy Store',
      }),
    });
    const accepted = await response.json() as { id: string; status: string; notification_configured?: boolean };
    if (!/^[0-9a-f]{32}$/.test(accepted.id)) return bad('GPU Server returned an invalid batch ID', 502);
    const remote = { ...job, remoteId: accepted.id };
    await persistBatch(user.userId, body.projectId, remote);
    return Response.json({ batch: remote, batchId: accepted.id, status: accepted.status, items: job.items,
      notificationEmail: job.notificationEmail,
      notificationConfigured: accepted.notification_configured === true }, { status: 202 });
  } catch (e) { return failure(e); }
}
export async function PUT(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  try {
    const body = await request(req);
    if (!body.projectId || !isUuid(body.characterId)) return bad('Choose a batch character');
    const batch = await loadBatch(user.userId, body.projectId);
    if (!batch.remoteId || batch.status !== 'staging') return bad('No batch awaiting file uploads', 409);
    const item = batch.items.find(c => c.characterId === body.characterId);
    if (!item) return bad('Image is not included in this batch', 404);
    const latest = await ownedUpscaleProject(user.userId, body.projectId);
    const char = latest.data.characters.find(c => c.id === item.characterId);
    if (!char || char.imageUrl !== item.originalUrl ||
        (char.upscaledImageUrl || char.imageUrl) !== item.sourceUrl) return bad('Source image changed; cannot upload this Batch', 409);
    const blob = await upscaleBucket()?.get(upscaleSourceKey(user.userId, item.sourceUrl));
    if (!blob) return bad('Stored PNG source not found', 404);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > 30 * 1024 * 1024) return bad('Source PNG exceeds 30 MB', 413);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
    const checksum = Array.from(digest, b => b.toString(16).padStart(2,'0')).join('');
    const form = new FormData();
    form.set('file', new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }), item.characterId + '.png');
    const uploaded = await gpuFetch(user.userId, '/v1/batches/' + batch.remoteId + '/files/' + item.characterId, {
      method: 'PUT', headers: { 'X-Content-SHA256': checksum }, body: form,
    });
    return Response.json(await uploaded.json());
  } catch (e) { return failure(e); }
}
export async function PATCH(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  try {
    const body = await request(req);
    if (!body.projectId) return bad('Collection ID required');
    const batch = await loadBatch(user.userId, body.projectId);
    if (!batch.remoteId) return bad('Remote batch not created', 409);
    const remote = await gpuFetch(user.userId, '/v1/batches/' + batch.remoteId + '/commit', { method: 'POST' });
    const snapshot = await remote.json() as GpuBatchSnapshot;
    if (snapshot.status !== 'committed') return bad('Remote Batch has not been committed', 409);
    const jobs = await importAcceptedJobs(user.userId, body.projectId, snapshot);
    return Response.json({ batch: { ...batch, status: 'committed' }, status: snapshot.status, jobs, notificationConfigured: snapshot.notification_configured });
  } catch (e) { return failure(e); }
}
export async function GET(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  try {
    const projectId = new URL(req.url).searchParams.get('projectId') || '';
    if (!projectId) return bad('Collection required');
    const batch = await loadBatch(user.userId, projectId);
    if (!batch.remoteId) return Response.json({ batch, status: 'staging', items: batch.items,
      receivedIds: [], jobs: [], notificationEmail: batch.notificationEmail });
    const remote = await gpuFetch(user.userId, '/v1/batches/' + batch.remoteId);
    const snapshot = await remote.json() as GpuBatchSnapshot;
    const jobs = await importAcceptedJobs(user.userId, projectId, snapshot);
    return Response.json({
      batch: { ...batch, status: snapshot.completed_files === batch.items.length ? 'completed' : batch.status },
      status: snapshot.status, batchId: snapshot.id, items: batch.items,
      receivedIds: snapshot.files?.map(file => file.client_file_id) || [],
      jobs, completedFiles: snapshot.completed_files || 0,
      totalFiles: snapshot.expected_files, notificationEmail: batch.notificationEmail,
      notificationConfigured: snapshot.notification_configured === true,
      notificationStatus: snapshot.notification_status || 'pending',
    });
  } catch (e) { return failure(e); }
}
