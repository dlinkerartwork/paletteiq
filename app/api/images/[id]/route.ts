import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Invalid image', { status: 400 });
  if (!env.BUCKET) return new Response('Storage unavailable', { status: 503 });
  const extension = new URL(req.url).searchParams.get('format') === 'jpg' ? 'jpg' : 'png';
  const obj = await env.BUCKET.get(`generated/${user.userId}/${id}.${extension}`);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, { headers: { 'Content-Type': extension === 'jpg' ? 'image/jpeg' : 'image/png', 'Cache-Control': 'private, max-age=3600' } });
}
