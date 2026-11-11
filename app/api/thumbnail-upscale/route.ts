import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { projects, studioSettings } from '@/db/schema';
import { nativeAssetBucket } from '@/lib/native-bridge';
import { batchAssetKey } from '@/lib/batch-assets';
import { decryptCredential } from '@/lib/credentials';
import { normalizeUpscaleServerUrl } from '@/lib/upscale-server-url';

type ThumbnailJob = { id: string; sourceUrl: string; factor: 2 | 4; submittedAt: number };
type Thumbnail = { id: string; aiImageUrl?: string; renderedImageUrl?: string; upscaledImageUrl?: string; upscaleJob?: ThumbnailJob };
type ProjectData = { characters: Array<{ id: string }>; thumbnails?: Thumbnail[] };
type RemoteStatus = { status: 'queued' | 'processing' | 'cancelled' | 'completed' | 'failed'; error?: string | null; elapsed_seconds?: number; qc?: unknown };
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


function thumbnailSourceKey(owner: string, projectId: string, urlText: string) {
  const url = new URL(urlText, 'https://paletteiq.invalid');
  if (url.origin !== 'https://paletteiq.invalid' || url.pathname !== '/api/thumbnail-background' ||
      url.searchParams.get('projectId') !== projectId || url.searchParams.get('format') !== 'png') throw Error('Thumbnail upscale requires an uploaded temporary PNG.');
  const id = url.searchParams.get('assetId') || '';
  if (!/^[0-9a-f-]{36}$/.test(id)) throw Error('Invalid temporary PNG asset');
  return 'generated/' + owner + '/' + id + '.png';
}
export async function POST(req: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return bad('Sign in required', 401);
    const body = await req.json() as { projectId?: string; thumbnailId?: string; sourceUrl?: string };
    if (!body.projectId || !body.thumbnailId || !body.sourceUrl) return bad('Select a thumbnail PNG');
    const { data } = await ownedProject(user.userId, body.projectId);
    const thumb = data.thumbnails?.find(t => t.id === body.thumbnailId);
    if (!thumb) return bad('Thumbnail not found', 404);
    if (thumb.upscaleJob) return Response.json({ id: thumb.upscaleJob.id, status: 'queued', alreadyQueued: true });
    if (thumb.upscaledImageUrl) return bad('Thumbnail already upscaled', 409);
    const source = await storage()?.get(thumbnailSourceKey(user.userId, body.projectId, body.sourceUrl));
    if (!source) return bad('Temporary source PNG not found', 404);
    const bytes = new Uint8Array(await source.arrayBuffer());
    if (bytes.length > 30 * 1024 * 1024) return bad('Thumbnail PNG exceeds 30 MB', 413);
    dimension(bytes);
    const settings = await getDb().select().from(studioSettings).where(eq(studioSettings.owner, user.userId)).limit(1);
    const prefs = settings[0] ? JSON.parse(settings[0].preferences) as Record<string, unknown> : {};
    const factor: 2 | 4 = prefs.upscaleFactor === 2 ? 2 : 4;
    const model = typeof prefs.upscaleModel === 'string' ? prefs.upscaleModel : 'realesrgan-x4plus';
    if (!['realesrgan-x4plus','realesrgan-x4plus-anime','realesrnet-x4plus','realesr-animevideov3','real-hat-gan-sharper-x4'].includes(model)) return bad('Invalid upscale model');
    if (model === 'real-hat-gan-sharper-x4' && factor !== 4) return bad('HAT only supports 4×');
    const form = new FormData();
    form.set('file', new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' }), 'thumbnail.png');
    form.set('model', model); form.set('scale', String(factor));
    form.set('edge_cleanup', String(prefs.upscaleCleanup === true));
    form.set('cleanup_strength', ['low','medium','high'].includes(String(prefs.upscaleCleanupStrength)) ? String(prefs.upscaleCleanupStrength) : 'low');
    const response = await (await remote(user.userId, '/v1/jobs', { method: 'POST', body: form })).json() as { id?: string };
    if (!response.id || !/^[0-9a-f]{32}$/.test(response.id)) return bad('Invalid GPU job ID', 502);
    const latest = await ownedProject(user.userId, body.projectId);
    const target = latest.data.thumbnails?.find(t => t.id === body.thumbnailId);
    if (!target || target.upscaleJob || target.upscaledImageUrl) return bad('Thumbnail changed while submitting; check GPU server for job ' + response.id, 409);
    target.upscaleJob = { id: response.id, sourceUrl: body.sourceUrl, factor, submittedAt: Date.now() };
    await getDb().update(projects).set({ data: JSON.stringify(latest.data), updatedAt: Date.now() }).where(and(eq(projects.id, latest.row.id), eq(projects.owner, user.userId)));
    return Response.json({ id: response.id, status: 'queued' });
  } catch (e) { return bad(e instanceof Error ? e.message : String(e), 502); }
}
export async function GET(req: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return bad('Sign in required', 401);
    const url = new URL(req.url);
    const projectId = url.searchParams.get('projectId') || '';
    const thumbnailId = url.searchParams.get('thumbnailId') || '';
    const { data } = await ownedProject(user.userId, projectId);
    const thumb = data.thumbnails?.find(t => t.id === thumbnailId);
    if (!thumb) return bad('Thumbnail not found', 404);
    const task = thumb.upscaleJob;
    if (!task) return Response.json({ status: thumb.upscaledImageUrl ? 'succeeded' : 'idle', url: thumb.upscaledImageUrl });
    const status = await (await remote(user.userId, '/v1/jobs/' + task.id)).json() as RemoteStatus;
    if (status.status === 'failed') return Response.json({ status: 'failed', error: status.error, id: task.id });
    if (status.status === 'cancelled') return Response.json({ status: 'cancelled', id: task.id });
    if (status.status !== 'completed') return Response.json({ status: status.status, id: task.id, elapsedSeconds: status.elapsed_seconds });
    const res = await remote(user.userId, '/v1/jobs/' + task.id + '/result');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > 100 * 1024 * 1024) return bad('Upscaled image exceeds 100 MB', 413);
    const output = dimension(bytes);
    const original = await storage()?.get(thumbnailSourceKey(user.userId, projectId, task.sourceUrl));
    if (!original) return bad('Original temporary PNG unavailable for QC', 404);
    const source = dimension(new Uint8Array(await original.arrayBuffer()));
    if (output.width !== source.width * task.factor || output.height !== source.height * task.factor) return bad('GPU result dimensions do not match requested scale', 422);
    const latest = await ownedProject(user.userId, projectId);
    const target = latest.data.thumbnails?.find(t => t.id === thumbnailId);
    if (!target || target.upscaleJob?.id !== task.id) return bad('Thumbnail upscale job changed', 409);
    const assetId = crypto.randomUUID();
    await storage()?.put('generated/' + user.userId + '/' + assetId + '.png', bytes);
    target.upscaledImageUrl = '/api/thumbnail-background?projectId=' + encodeURIComponent(projectId) + '&assetId=' + assetId + '&format=png';
    delete target.upscaleJob;
    await getDb().update(projects).set({ data: JSON.stringify(latest.data), updatedAt: Date.now() }).where(and(eq(projects.id, latest.row.id), eq(projects.owner, user.userId)));
    return Response.json({ status: 'succeeded', url: target.upscaledImageUrl, width: output.width, height: output.height });
  } catch (e) { return bad('Thumbnail upscale sync failed: ' + (e instanceof Error ? e.message : String(e)), 502); }
}
