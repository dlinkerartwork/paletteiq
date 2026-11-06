import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { nativeAssetBucket } from '@/lib/native-bridge';
import { batchAssetKey } from '@/lib/batch-assets';
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Invalid image', { status: 400 });
  const bucket = nativeAssetBucket() ?? env.BUCKET;
  if (!bucket) return new Response('Storage unavailable', { status: 503 });
  const extension = new URL(req.url).searchParams.get('format') === 'jpg' ? 'jpg' : 'png';
  const batchId = new URL(req.url).searchParams.get('batch');
  if (batchId && !/^[0-9a-f-]{36}$/.test(batchId)) return new Response('Invalid Batch asset', { status: 400 });
  const key = batchId ? batchAssetKey(user.userId, id, extension, batchId) : `generated/${user.userId}/${id}.${extension}`;
  const obj = await bucket.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  const download = new URL(req.url).searchParams.get('download') === '1';
  return new Response(obj.body, { headers: { 'Content-Type': extension === 'jpg' ? 'image/jpeg' : 'image/png', 'Cache-Control': 'private, max-age=3600', ...(download ? { 'Content-Disposition': `attachment; filename="paletteiq-${id}.${extension}"` } : {}) } });
}
