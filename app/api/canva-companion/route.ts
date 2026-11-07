import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { nativeAssetBucket } from '@/lib/native-bridge';
import { batchAssetKey } from '@/lib/batch-assets';

type CompanionTask = { owner: string; projectId: string; characterId: string; name: string; originalUrl: string; createdAt: number; status: 'pending' | 'completed' };
const sessions = new Map<string, CompanionTask>();
const MAX_AGE = 30 * 60 * 1000;
const bad = (message: string, status = 400) => Response.json({ error: message }, { status });
const bucket = () => nativeAssetBucket() ?? env.BUCKET;
const gc = () => { for (const [token, task] of sessions) if (Date.now() - task.createdAt > MAX_AGE) sessions.delete(token); };
const getTask = (token: string) => { gc(); return /^[a-f0-9]{64}$/.test(token) ? sessions.get(token) : undefined; };
const imageKey = (owner: string, reference: string) => {
  const url = new URL(reference, 'https://app.local');
  const match = url.pathname.match(/^\/api\/images\/([0-9a-f-]{36})$/);
  if (!match) throw new Error('Invalid stored image URL');
  const format = url.searchParams.get('format') === 'jpg' ? 'jpg' : 'png';
  const batch = url.searchParams.get('batch');
  if (batch && !/^[0-9a-f-]{36}$/.test(batch)) throw new Error('Invalid batch reference');
  return { key: batch ? batchAssetKey(owner, match[1], format, batch) : `generated/${owner}/${match[1]}.${format}`, format };
};

export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  const body = await req.json().catch(() => null) as { projectId?: string; characterIds?: string[] } | null;
  if (!body || typeof body.projectId !== 'string' || !Array.isArray(body.characterIds) || !body.characterIds.length || body.characterIds.length > 20) return bad('Select 1–20 generated images');
  const rows = await getDb().select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.owner, user.userId))).limit(1);
  if (!rows.length) return bad('Collection not found', 404);
  const data = JSON.parse(rows[0].data) as { characters?: Array<{ id: string; name: string; imageUrl?: string }> };
  const byId = new Map((data.characters || []).map(c => [c.id, c]));
  const ids = [...new Set(body.characterIds)];
  if (ids.length !== body.characterIds.length) return bad('Duplicate selection');
  for (const id of ids) if (!byId.get(id)?.imageUrl) return bad('All selected images must exist in this collection');
  gc();
  const created = ids.map(id => {
    const character = byId.get(id)!;
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    sessions.set(token, { owner: user.userId, projectId: body.projectId!, characterId: id, name: character.name, originalUrl: character.imageUrl!, createdAt: Date.now(), status: 'pending' });
    return { token, name: character.name };
  });
  return Response.json({ tasks: created, expiresInMinutes: 30 }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const task = getTask(url.searchParams.get('token') || '');
  if (!task) return bad('Pairing code missing or expired', 404);
  if (url.searchParams.get('file') !== '1') return Response.json({ name: task.name, status: task.status, projectId: task.projectId, expiresAt: task.createdAt + MAX_AGE }, { headers: { 'Cache-Control': 'no-store' } });
  if (task.status !== 'pending') return bad('Task already completed', 409);
  const source = imageKey(task.owner, task.originalUrl);
  const object = await bucket()?.get(source.key);
  if (!object?.body) return bad('Original image unavailable', 404);
  return new Response(object.body, { headers: { 'Content-Type': source.format === 'jpg' ? 'image/jpeg' : 'image/png', 'Content-Disposition': `attachment; filename="paletteiq-source.${source.format}"`, 'Cache-Control': 'no-store' } });
}

export async function PUT(req: Request) {
  const token = new URL(req.url).searchParams.get('token') || '';
  const task = getTask(token);
  if (!task) return bad('Pairing code missing or expired', 404);
  if (task.status !== 'pending') return bad('Task already completed', 409);
  const contentType = req.headers.get('content-type')?.split(';')[0];
  if (!['image/png','image/jpeg'].includes(contentType || '')) return bad('Upload PNG or JPEG only');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) return bad('Image must be 1 byte to 25 MB', 413);
  const png = bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v);
  const jpg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if ((contentType === 'image/png' && !png) || (contentType === 'image/jpeg' && !jpg)) return bad('File contents do not match image type');
  const db = getDb();
  const rows = await db.select().from(projects).where(and(eq(projects.id, task.projectId), eq(projects.owner, task.owner))).limit(1);
  if (!rows.length) return bad('Collection no longer exists', 404);
  const data = JSON.parse(rows[0].data) as { characters?: Array<{ id: string; imageUrl?: string; upscaledImageUrl?: string; upscaledAt?: number }> };
  const character = data.characters?.find(c => c.id === task.characterId);
  if (!character || character.imageUrl !== task.originalUrl) return bad('Original image changed. Create a new upscale task.', 409);
  const id = crypto.randomUUID();
  const format = png ? 'png' : 'jpg';
  const key = `generated/${task.owner}/${id}.${format}`;
  const storage = bucket();
  if (!storage) return bad('Local image storage unavailable', 503);
  await storage.put(key, bytes);
  character.upscaledImageUrl = `/api/images/${id}?format=${format}`;
  character.upscaledAt = Date.now();
  await db.update(projects).set({ data: JSON.stringify(data), updatedAt: Date.now() }).where(and(eq(projects.id, task.projectId), eq(projects.owner, task.owner)));
  task.status = 'completed';
  return Response.json({ ok: true, upscaledImageUrl: character.upscaledImageUrl, projectId: task.projectId, characterId: task.characterId });
}
