import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { projects, studioSettings } from '@/db/schema';
import { nativeAssetBucket } from '@/lib/native-bridge';
import { batchAssetKey } from '@/lib/batch-assets';

type Task = { owner: string; projectId: string; characterId: string; originalUrl: string; createdAt: number; factor: 2 | 4; requireTransparency: boolean; qc: boolean; sourceWidth: number; sourceHeight: number; sourceAlpha: boolean; complete?: { url: string; width: number; height: number } };
const active = new Map<string, Task>();
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const storage = () => nativeAssetBucket() ?? env.BUCKET;
const token = () => (env as unknown as Record<string, string | undefined>).REPLICATE_API_TOKEN;
const isPng = (bytes: Uint8Array) => bytes.length > 33 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
const dimension = (bytes: Uint8Array) => {
  if (!isPng(bytes)) throw Error('Only PNG sources and PNG output supported in the initial Replicate integration.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), alpha: bytes[25] === 4 || bytes[25] === 6 || bytes.includes(116) && false };
};
const sourceKey = (owner: string, reference: string) => {
  const url = new URL(reference, 'https://app.local');
  const id = url.pathname.match(/^\/api\/images\/([0-9a-f-]{36})$/)?.[1];
  if (!id || url.searchParams.get('format') === 'jpg') throw Error('Replicate testing currently requires a stored PNG image.');
  const batch = url.searchParams.get('batch');
  if (batch && !/^[0-9a-f-]{36}$/.test(batch)) throw Error('Invalid Batch asset');
  return batch ? batchAssetKey(owner, id, 'png', batch) : `generated/${owner}/${id}.png`;
};
const auth = async () => {
  const user = await getChatGPTUser();
  if (!user) throw Error('Sign in required');
  return user.userId;
};
const requestReplicate = async (url: string, init: RequestInit = {}) => {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token()}`, ...(init.headers || {}) } });
  const data = await response.json() as { id?: string; status?: string; error?: string; detail?: string; output?: string | string[] };
  if (!response.ok) throw Error(data.detail || data.error || `Replicate HTTP ${response.status}`);
  return data;
};
const encoded = (bytes: Uint8Array) => {
  let result = '';
  for (let i = 0; i < bytes.length; i += 16384) result += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(result);
};
const expire = () => { for (const [id, task] of active) if (Date.now() - task.createdAt > 60 * 60 * 1000) active.delete(id); };
export async function POST(req: Request) {
  try {
    const owner = await auth();
    const body = await req.json() as { projectId?: string; characterId?: string };
    if (!body.projectId || !body.characterId) return bad('Select a generated image');
    if (!token()) return bad('REPLICATE_API_TOKEN is not configured on the PaletteIQ server. Add it to the local runtime environment first.', 503);
    const db = getDb();
    const rows = await db.select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.owner, owner))).limit(1);
    const char = rows.length ? (JSON.parse(rows[0].data) as { characters: Array<{ id: string; imageUrl?: string }> }).characters?.find(c => c.id === body.characterId) : undefined;
    if (!char?.imageUrl) return bad('Generated image not found', 404);
    const settings = await db.select().from(studioSettings).where(eq(studioSettings.owner, owner)).limit(1);
    const prefs = settings.length ? JSON.parse(settings[0].preferences) as Record<string, unknown> : {};
    if (prefs.upscaleProvider !== 'replicate') return bad('Choose Replicate in Upscale settings and save first');
    const factor = prefs.upscaleFactor === 2 ? 2 : 4;
    const obj = await storage()?.get(sourceKey(owner, char.imageUrl));
    if (!obj) return bad('Original image unavailable', 404);
    const bytes = new Uint8Array(await obj.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) return bad('PNG is larger than the 8 MB data upload limit', 413);
    const source = dimension(bytes);
    if (source.width < 1 || source.height < 1 || source.width > 2048 || source.height > 2048) return bad('Input size must be 1–2048 pixels per side');
    const prediction = await requestReplicate('https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { image: `data:image/png;base64,${encoded(bytes)}`, scale: factor, face_enhance: false } })
    });
    if (!prediction.id || !/^[a-z0-9]{10,80}$/.test(prediction.id)) return bad('Replicate did not return a valid prediction ID', 502);
    expire();
    active.set(prediction.id, { owner, projectId: body.projectId, characterId: body.characterId, originalUrl: char.imageUrl, createdAt: Date.now(), factor, requireTransparency: prefs.upscaleRequireTransparency !== false, qc: prefs.upscaleQc !== false, sourceWidth: source.width, sourceHeight: source.height, sourceAlpha: source.alpha });
    return Response.json({ id: prediction.id, status: prediction.status || 'starting' });
  } catch (e) { return bad(e instanceof Error ? e.message : String(e), 500); }
}
export async function GET(req: Request) {
  try {
    const owner = await auth();
    const id = new URL(req.url).searchParams.get('id') || '';
    expire();
    const task = active.get(id);
    if (!task || task.owner !== owner) return bad('Upscale task expired or not found', 404);
    if (task.complete) return Response.json({ status: 'succeeded', ...task.complete });
    const result = await requestReplicate(`https://api.replicate.com/v1/predictions/${encodeURIComponent(id)}`);
    if (result.status === 'failed' || result.status === 'canceled') return bad(result.error || 'Replicate upscale failed', 502);
    if (result.status !== 'succeeded') return Response.json({ status: result.status || 'processing' });
    const output = Array.isArray(result.output) ? result.output[0] : result.output;
    if (!output || !/^https:\/\/(?:[a-z0-9-]+\.)*replicate\.delivery\//i.test(output)) return bad('Invalid Replicate output URL', 502);
    const response = await fetch(output);
    if (!response.ok) return bad(`Replicate output HTTP ${response.status}`, 502);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 25 * 1024 * 1024) return bad('Upscaled output exceeds 25 MB', 413);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 25 * 1024 * 1024) return bad('Upscaled output exceeds 25 MB', 413);
    const resultPng = dimension(bytes);
    if (task.qc && (resultPng.width !== task.sourceWidth * task.factor || resultPng.height !== task.sourceHeight * task.factor)) return bad(`QC rejected output: expected ${task.sourceWidth * task.factor}×${task.sourceHeight * task.factor}, received ${resultPng.width}×${resultPng.height}`, 422);
    if (task.requireTransparency && task.sourceAlpha && !resultPng.alpha) return bad('QC rejected output: source had an alpha channel, but upscale output is opaque. The original is safe.', 422);
    const db = getDb();
    const rows = await db.select().from(projects).where(and(eq(projects.id, task.projectId), eq(projects.owner, owner))).limit(1);
    if (!rows.length) return bad('Collection not found', 404);
    const data = JSON.parse(rows[0].data) as { characters: Array<{ id: string; imageUrl?: string; upscaledImageUrl?: string; upscaledAt?: number }> };
    const character = data.characters.find(c => c.id === task.characterId);
    if (!character || character.imageUrl !== task.originalUrl) return bad('Original image changed during upscale', 409);
    const newId = crypto.randomUUID();
    const key = `generated/${owner}/${newId}.png`;
    const bucket = storage();
    if (!bucket) return bad('Storage unavailable', 503);
    await bucket.put(key, bytes);
    const url = `/api/images/${newId}?format=png`;
    character.upscaledImageUrl = url; character.upscaledAt = Date.now();
    await db.update(projects).set({ data: JSON.stringify(data), updatedAt: Date.now() }).where(and(eq(projects.id, task.projectId), eq(projects.owner, owner)));
    task.complete = { url, width: resultPng.width, height: resultPng.height };
    return Response.json({ status: 'succeeded', ...task.complete });
  } catch (e) { return bad(e instanceof Error ? e.message : String(e), 500); }
}
