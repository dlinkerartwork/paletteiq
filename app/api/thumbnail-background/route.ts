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
  const uploadId = form?.get('uploadId');
  const action = form?.get('action');
  if (typeof uploadId === 'string' && /^[0-9a-f-]{36}$/.test(uploadId) && (action === 'chunk' || action === 'complete')) {
    const storage = bucket();
    if (!storage) return bad('Image storage is not configured.', 503);
    const count = Number(form?.get('count'));
    if (!Number.isInteger(count) || count < 1 || count > 30) return bad('Invalid thumbnail upload parts');
    const prefix = 'thumbnail-upload/' + user.userId + '/' + projectId + '/' + uploadId + '/';
    if (action === 'chunk') {
      const index = Number(form?.get('index'));
      if (!(file instanceof File) || !Number.isInteger(index) || index < 0 || index >= count || file.size < 1 || file.size > 1_200_000) return bad('Invalid thumbnail upload chunk', 413);
      await storage.put(prefix + index, new Uint8Array(await file.arrayBuffer()));
      return Response.json({ ok: true });
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (let i = 0; i < count; i++) {
      const part = await storage.get(prefix + i);
      if (!part) return bad('Upload chunk ' + (i + 1) + ' is missing. Retry Save designs.', 409);
      const bytes = new Uint8Array(await part.arrayBuffer());
      total += bytes.length;
      if (total > 20_000_000) return bad('Rendered thumbnail PNG is larger than 20 MB.', 413);
      chunks.push(bytes);
    }
    const assembled = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { assembled.set(chunk, offset); offset += chunk.length; }
    if (!(assembled.length >= 8 && assembled[0] === 137 && assembled[1] === 80 && assembled[2] === 78 && assembled[3] === 71)) return bad('Invalid rendered thumbnail PNG');
    const assetId = crypto.randomUUID();
    await storage.put('generated/' + user.userId + '/' + assetId + '.png', assembled);
    await Promise.all(chunks.map((_, i) => storage.delete(prefix + i)));
    return Response.json({ url: '/api/thumbnail-background?projectId=' + encodeURIComponent(projectId) + '&assetId=' + assetId + '&format=png' });
  }
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
