import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { nativeAssetBucket } from '@/lib/native-bridge';

const bucket = () => nativeAssetBucket() ?? env.BUCKET;
const bad = (error: string, status = 400) => Response.json({ error }, { status });

async function belongsToOwner(projectId: string, owner: string): Promise<boolean> {
  if (!/^[\w-]{8,80}$/.test(projectId)) return false;
  const rows = await getDb().select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.owner, owner))).limit(1);
  return rows.length > 0;
}
export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  const form = await req.formData().catch(() => null);
  const projectId = form?.get('projectId');
  const file = form?.get('file');
  if (typeof projectId !== 'string' || !await belongsToOwner(projectId, user.userId)) return bad('Save the collection before uploading a background.', 404);
  if (!(file instanceof File)) return bad('Choose a PNG or JPG background image');
  if (file.size < 1 || file.size > 20_000_000) return bad('Background image must be 20 MB or smaller', 413);
  if (!['image/png', 'image/jpeg'].includes(file.type)) return bad('Choose a PNG or JPG image');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpg) return bad('Invalid PNG/JPG image');
  const extension = png ? 'png' : 'jpg';
  const assetId = crypto.randomUUID();
  const storage = bucket();
  if (!storage) return bad('Image storage is not configured.', 503);
  await storage.put('generated/' + user.userId + '/' + assetId + '.' + extension, bytes);
  return Response.json({ url: '/api/thumbnail-background?projectId=' + encodeURIComponent(projectId) + '&assetId=' + assetId + '&format=' + extension });
}
export async function GET(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId') || '';
  const assetId = url.searchParams.get('assetId') || '';
  const format = url.searchParams.get('format') || '';
  if (!/^[0-9a-f-]{36}$/.test(assetId) || !['png','jpg'].includes(format)) return bad('Invalid image identifier');
  if (!await belongsToOwner(projectId, user.userId)) return bad('Collection not found', 404);
  const result = await bucket()?.get('generated/' + user.userId + '/' + assetId + '.' + format);
  if (!result) return bad('Background not found', 404);
  return new Response(await result.arrayBuffer(), { headers: { 'Content-Type': format === 'png' ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}
