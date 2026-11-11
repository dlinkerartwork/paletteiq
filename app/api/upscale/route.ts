import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { projects, studioSettings } from '@/db/schema';
import { nativeAssetBucket } from '@/lib/native-bridge';
import { batchAssetKey } from '@/lib/batch-assets';
import { decryptCredential } from '@/lib/credentials';
import { normalizeUpscaleServerUrl } from '@/lib/upscale-server-url';

type RemoteJob = { id: string; sourceUrl: string; originalUrl?: string; factor: 2 | 4 | 6 | 8; requireTransparency: boolean; qc: boolean; submittedAt: number };
type Character = { id: string; imageUrl?: string; upscaledImageUrl?: string; upscaledAt?: number; upscaleJob?: RemoteJob };
type ProjectData = { characters: Character[] };
type RemoteStatus = { status: 'queued' | 'processing' | 'cancelling' | 'cancelled' | 'completed' | 'failed'; error?: string | null; qc?: unknown; elapsed_seconds?: number; started_at?: number | null };

const bad = (error: string, status = 400) => Response.json({ error }, { status });
const variables = () => env as unknown as Record<string, string | undefined>;
const storage = () => nativeAssetBucket() ?? env.BUCKET;
const isPng = (bytes: Uint8Array) => bytes.length > 33 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
const dimension = (bytes: Uint8Array) => {
  if (!isPng(bytes)) throw Error('Only PNG sources and PNG results are supported by Remote Upscale.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), alpha: bytes[25] === 4 || bytes[25] === 6 };
};

async function remoteConfig(owner: string) {
  const rows = await getDb().select({ upscaleCredential: studioSettings.upscaleCredential, preferences: studioSettings.preferences }).from(studioSettings).where(eq(studioSettings.owner, owner)).limit(1);
  const preferences = rows[0]?.preferences ? JSON.parse(rows[0].preferences) as { upscaleServerUrl?: string } : {};
  const customUrl = preferences.upscaleServerUrl || '';
  const url = customUrl || variables().PALETTEIQ_UPSCALE_SERVER_URL?.trim();
  if (customUrl && !normalizeUpscaleServerUrl(customUrl)) throw Error('Invalid saved GPU Server URL. Update it in Settings.');
  const key = rows[0]?.upscaleCredential ? await decryptCredential(rows[0].upscaleCredential, owner) : variables().PALETTEIQ_UPSCALE_SERVER_KEY?.trim();
  if (!url || !key || key.length < 32) throw Error('Remote Upscale is not configured on the PaletteIQ backend.');
  const parsed = new URL(url);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' && parsed.pathname !== '') throw Error('Invalid Remote Upscale server URL');
  const local = /^(?:127\.0\.0\.1|localhost|10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(?:\d{1,3}\.)\d{1,3})$/.test(parsed.hostname);
  const desktop = variables().PALETTEIQ_DESKTOP === '1';
  // setup-local.ps1 marks intentionally local, login-free development with
  // PALETTEIQ_LOCAL_NO_AUTH=1. Keep the allowance limited to private targets.
  const allowPrivateHttp = desktop || variables().PALETTEIQ_ALLOW_PRIVATE_HTTP_UPSCALE === '1' || variables().PALETTEIQ_LOCAL_NO_AUTH === '1';
  if (parsed.protocol !== 'https:' && !(allowPrivateHttp && parsed.protocol === 'http:' && local)) throw Error('Remote Upscale requires HTTPS unless private HTTP is explicitly enabled on the backend for a LAN address.');
  const accessId = variables().PALETTEIQ_GPU_ACCESS_CLIENT_ID?.trim();
  const accessSecret = variables().PALETTEIQ_GPU_ACCESS_CLIENT_SECRET?.trim();
  if (Boolean(accessId) !== Boolean(accessSecret)) throw Error('Both GPU tunnel Access credentials must be configured together.');
  return { base: parsed.origin, key, accessId, accessSecret };
}

async function remote(owner: string, path: string, init: RequestInit = {}) {
  const { base, key, accessId, accessSecret } = await remoteConfig(owner);
  const result = await fetch(base + path, { ...init, headers: { 'X-API-Key': key, ...(accessId && accessSecret ? { 'CF-Access-Client-Id': accessId, 'CF-Access-Client-Secret': accessSecret } : {}), ...(init.headers || {}) }, cache: 'no-store', signal: AbortSignal.timeout(120_000) });
  if (!result.ok) throw Error(`Remote Upscale HTTP ${result.status}: ${(await result.text()).slice(0, 160)}`);
  return result;
}

function sourceKey(owner: string, reference: string) {
  const url = new URL(reference, 'https://paletteiq.invalid');
  const id = url.pathname.match(/^\/api\/images\/([0-9a-f-]{36})$/)?.[1];
  if (!id || url.searchParams.get('format') === 'jpg') throw Error('Remote Upscale requires a stored PNG image.');
  const batch = url.searchParams.get('batch');
  if (batch && !/^[0-9a-f-]{36}$/.test(batch)) throw Error('Invalid batch image reference');
  return batch ? batchAssetKey(owner, id, 'png', batch) : `generated/${owner}/${id}.png`;
}

async function ownedProject(owner: string, projectId: string) {
  const rows = await getDb().select().from(projects).where(and(eq(projects.id, projectId), eq(projects.owner, owner))).limit(1);
  if (!rows.length) throw Error('Collection not found');
  return { row: rows[0], data: JSON.parse(rows[0].data) as ProjectData };
}

export async function POST(req: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return bad('Sign in required', 401);
    const body = await req.json() as { projectId?: string; characterId?: string; action?: 'cancel'; factor?: number };
    if (!body.projectId || !body.characterId) return bad('Select a generated image');
    const { row, data } = await ownedProject(user.userId, body.projectId);
    const character = data.characters.find(c => c.id === body.characterId);
    if (!character?.imageUrl) return bad('Generated image not found', 404);
    if (body.action === 'cancel') {
      if (!character.upscaleJob) return bad('No pending upscale job', 409);
      const staleId = character.upscaleJob.id;
      let status: string;
      let missing = false;
      try {
        const cancelled = await (await remote(user.userId, `/v1/jobs/${staleId}/cancel`, { method: 'POST' })).json() as RemoteStatus;
        status = cancelled.status;
      } catch (error) {
        const description = error instanceof Error ? error.message : String(error);
        // Clean up only a confirmed missing job, not an offline server, auth
        // failure, timeout, or unsupported cancel endpoint.
        if (!/Remote Upscale HTTP 404:.*(?:job.*not found|job.*does not exist|unknown job)/i.test(description)) throw error;
        missing = true;
        status = 'orphaned';
      }
      if (missing || status === 'cancelled') {
        const latest = await ownedProject(user.userId, body.projectId);
        const target = latest.data.characters.find(c => c.id === body.characterId);
        if (!target || target.upscaleJob?.id !== staleId) return bad('Job changed while cancelling; please refresh', 409);
        delete target.upscaleJob;
        await getDb().update(projects).set({ data: JSON.stringify(latest.data), updatedAt: Date.now() }).where(and(eq(projects.id, latest.row.id), eq(projects.owner, user.userId)));
      }
      return Response.json({ id: staleId, status, cleared: missing || status === 'cancelled' });
    }
    const sourceUrl = character.upscaledImageUrl || character.imageUrl;
    if (character.upscaleJob) {
      if ((character.upscaleJob.sourceUrl !== sourceUrl || (character.upscaleJob.originalUrl && character.upscaleJob.originalUrl !== character.imageUrl))) return bad('Original image changed; previous job requires review', 409);
      const previous = await (await remote(user.userId, `/v1/jobs/${character.upscaleJob.id}`)).json() as RemoteStatus;
      if (!['failed', 'cancelled'].includes(previous.status)) return Response.json({ id: character.upscaleJob.id, status: previous.status });
    }
    const saved = await getDb().select().from(studioSettings).where(eq(studioSettings.owner, user.userId)).limit(1);
    const prefs = saved[0] ? JSON.parse(saved[0].preferences) as Record<string, unknown> : {};
    const factor = body.factor ?? prefs.upscaleFactor ?? 4;
    if (![2,4,6,8].includes(factor as number)) return bad('Choose 2×, 4×, 6× or 8×');
    const model = typeof prefs.upscaleModel === 'string' ? prefs.upscaleModel : 'realesrgan-x4plus';
    if (!['realesrgan-x4plus','realesrgan-x4plus-anime','realesrnet-x4plus','realesr-animevideov3','real-hat-gan-sharper-x4'].includes(model)) return bad('Invalid remote model');
    const strength = typeof prefs.upscaleCleanupStrength === 'string' ? prefs.upscaleCleanupStrength : 'low';
    if (!['low','medium','high'].includes(strength)) return bad('Invalid cleanup strength');
    const obj = await storage()?.get(sourceKey(user.userId, sourceUrl));
    if (!obj) return bad('Source PNG not found', 404);
    const bytes = new Uint8Array(await obj.arrayBuffer());
    if (bytes.length > 30 * 1024 * 1024) return bad('Source PNG exceeds 30 MB', 413);
    dimension(bytes);
    const form = new FormData();
    form.set('file', new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }), 'clipart.png');
    form.set('model', model);
    form.set('scale', String(factor));
    form.set('edge_cleanup', String(prefs.upscaleCleanup === true));
    form.set('cleanup_strength', strength);
    const submitted = await (await remote(user.userId, '/v1/jobs', { method: 'POST', body: form })).json() as { id?: string };
    if (!submitted.id || !/^[0-9a-f]{32}$/.test(submitted.id)) return bad('Remote server returned an invalid job ID', 502);
    // Re-read latest collection to avoid overwriting unrelated edits made while uploading.
    const latest = await ownedProject(user.userId, body.projectId);
    const target = latest.data.characters.find(c => c.id === body.characterId);
    if (!target || (target.upscaledImageUrl || target.imageUrl) !== sourceUrl || target.imageUrl !== character.imageUrl || target.upscaleJob?.id !== character.upscaleJob?.id) return bad('Original image changed or another upscale started; remote job requires manual review', 409);
    target.upscaleJob = { id: submitted.id, sourceUrl, originalUrl: character.imageUrl, factor: factor as RemoteJob['factor'], requireTransparency: prefs.upscaleRequireTransparency !== false, qc: prefs.upscaleQc !== false, submittedAt: Date.now() };
    await getDb().update(projects).set({ data: JSON.stringify(latest.data), updatedAt: Date.now() }).where(and(eq(projects.id, row.id), eq(projects.owner, user.userId)));
    return Response.json({ id: submitted.id, status: 'queued' });
  } catch (e) { return bad(e instanceof Error ? e.message : String(e), 502); }
}

export async function GET(req: Request) {
  let syncStage = 'read request';
  try {
    const user = await getChatGPTUser();
    if (!user) return bad('Sign in required', 401);
    const url = new URL(req.url);
    if (url.searchParams.get('check') === '1') {
      const health = await (await remote(user.userId, '/v1/health')).json() as { status: string; queue_depth?: number; engine_ready?: boolean };
      return Response.json({ connected: health.status === 'ok', queueDepth: health.queue_depth, engineReady: health.engine_ready });
    }
    const projectId = url.searchParams.get('projectId') || '';
    const characterId = url.searchParams.get('characterId') || '';
    if (!projectId || !characterId) return bad('projectId and characterId are required');
    const { data } = await ownedProject(user.userId, projectId);
    const character = data.characters.find(c => c.id === characterId);
    if (!character) return bad('Character not found', 404);
    const task = character.upscaleJob;
    if (!task) return Response.json({ status: character.upscaledImageUrl ? 'succeeded' : 'idle', url: character.upscaledImageUrl });
    if (((character.upscaledImageUrl || character.imageUrl) !== task.sourceUrl || (task.originalUrl && task.originalUrl !== character.imageUrl))) return bad('Original image changed during upscale; previous job was not applied', 409);
    syncStage = 'read remote job status';
    const result = await (await remote(user.userId, `/v1/jobs/${task.id}`)).json() as RemoteStatus;
    if (result.status === 'failed') return Response.json({ status: 'failed', error: result.error || 'Remote upscale failed', id: task.id });
    if (result.status === 'cancelled') {
      const latest = await ownedProject(user.userId, projectId);
      const target = latest.data.characters.find(c => c.id === characterId);
      if (target?.upscaleJob?.id === task.id) {
        delete target.upscaleJob;
        await getDb().update(projects).set({ data: JSON.stringify(latest.data), updatedAt: Date.now() }).where(and(eq(projects.id, latest.row.id), eq(projects.owner, user.userId)));
      }
      return Response.json({ status: 'cancelled', id: task.id, elapsedSeconds: result.elapsed_seconds });
    }
    if (result.status !== 'completed') return Response.json({ status: result.status, id: task.id, elapsedSeconds: result.elapsed_seconds, startedAt: result.started_at });
    syncStage = 'download completed upscale PNG';
    const response = await remote(user.userId, `/v1/jobs/${task.id}/result`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 100 * 1024 * 1024) return bad('Upscale result exceeds 100 MB', 413);
    const bytes = new Uint8Array(await response.arrayBuffer());
    syncStage = 'validate output PNG';
    if (bytes.length > 100 * 1024 * 1024) return bad('Upscale result exceeds 100 MB', 413);
    const output = dimension(bytes);
    syncStage = 'read source PNG for QC';
    const sourceObject = await storage()?.get(sourceKey(user.userId, task.sourceUrl));
    if (!sourceObject) return bad('Source image unavailable for QC', 404);
    const source = dimension(new Uint8Array(await sourceObject.arrayBuffer()));
    if (task.qc && (output.width !== source.width * task.factor || output.height !== source.height * task.factor)) return bad('QC rejected incorrect output dimensions', 422);
    if (task.requireTransparency && source.alpha && !output.alpha) return bad('QC rejected missing PNG alpha channel', 422);
    syncStage = 'read latest collection state';
    const latest = await ownedProject(user.userId, projectId);
    const target = latest.data.characters.find(c => c.id === characterId);
    if (!target || (target.upscaledImageUrl || target.imageUrl) !== task.sourceUrl || (task.originalUrl && target.imageUrl !== task.originalUrl) || target.upscaleJob?.id !== task.id) return bad('Collection changed before upscale completed', 409);
    const assetId = crypto.randomUUID();
    const bucket = storage();
    if (!bucket) return bad('Storage unavailable', 503);
    syncStage = 'save upscale PNG in desktop storage';
    await bucket.put(`generated/${user.userId}/${assetId}.png`, bytes);
    target.upscaledImageUrl = `/api/images/${assetId}?format=png`;
    target.upscaledAt = Date.now();
    delete target.upscaleJob;
    syncStage = 'save imported result in collection database';
    await getDb().update(projects).set({ data: JSON.stringify(latest.data), updatedAt: Date.now() }).where(and(eq(projects.id, latest.row.id), eq(projects.owner, user.userId)));
    return Response.json({ status: 'succeeded', url: target.upscaledImageUrl, width: output.width, height: output.height, qc: result.qc });
  } catch (e) { const detail = e instanceof Error ? e.message : String(e); console.error(`[upscale-sync] stage=${syncStage}: ${detail}`); return bad(`Upscale import failed at ${syncStage}: ${detail}`, 502); }
}
