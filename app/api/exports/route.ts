import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { zipStream, type ZipEntry } from '@/lib/zip-stream';

const enc = new TextEncoder();
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'collection';
const file = (content: string) => async () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(enc.encode(content)); controller.close(); } });
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Sign in required' }, { status: 401 });
  if (!env.BUCKET) return Response.json({ error: 'Image storage unavailable' }, { status: 503 });
  const bucket = env.BUCKET;
  const body = await request.json() as { projectId?: string; ids?: string[]; scope?: 'selected' | 'all' | 'package' };
  if (typeof body.projectId !== 'string' || !['selected','all','package'].includes(body.scope || '')) return Response.json({ error: 'Invalid export request' }, { status: 400 });
  const rows = await getDb().select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.owner, user.userId))).limit(1);
  if (!rows.length) return Response.json({ error: 'Collection not found' }, { status: 404 });
  const project = JSON.parse(rows[0].data) as { name: string; listing?: unknown; characters: Array<{ id: string; name: string; imageUrl?: string }> };
  if (body.scope === 'package' && !(project.listing && typeof project.listing === 'object' && typeof (project.listing as { title?: string }).title === 'string' && (project.listing as { title: string }).title.trim())) return Response.json({ error: 'Create and save an Etsy listing draft before exporting the final package.' }, { status: 400 });
  const selectedIds = new Set(Array.isArray(body.ids) ? body.ids.filter(v => typeof v === 'string') : []);
  const chosen = project.characters.filter(c => c.imageUrl && (body.scope !== 'selected' || selectedIds.has(c.id)));
  if (!chosen.length) return Response.json({ error: 'No generated images selected' }, { status: 400 });
  if (chosen.length > 1000) return Response.json({ error: 'Too many images in one ZIP' }, { status: 400 });
  const entries: ZipEntry[] = [];
  for (const [index, character] of chosen.entries()) {
    const path = new URL(character.imageUrl!, 'https://app.local');
    const match = path.pathname.match(/^\/api\/images\/([0-9a-f-]{36})$/);
    if (!match) return Response.json({ error: 'Invalid stored image reference' }, { status: 400 });
    const extension = path.searchParams.get('format') === 'jpg' ? 'jpg' : 'png';
    const key = `generated/${user.userId}/${match[1]}.${extension}`;
    if (!await bucket.head(key)) return Response.json({ error: `Image file missing for ${character.name}` }, { status: 409 });
    entries.push({ name: `images/${String(index + 1).padStart(3, '0')}-${slug(character.name).slice(0, 35)}-${character.id.slice(0, 8)}.${extension}`, stream: async () => (await bucket.get(key))?.body || null });
  }
  if (body.scope === 'package') {
    entries.push({ name: 'etsy-listing-draft.json', stream: file(JSON.stringify(project.listing || {}, null, 2)) });
    const listing = (project.listing || {}) as { title?: string; description?: string; tags?: string[]; primaryKeyword?: string };
    entries.push({ name: 'etsy-listing-draft.txt', stream: file(`TITLE\n${listing.title || ''}\n\nDESCRIPTION\n${listing.description || ''}\n\nTAGS\n${(listing.tags || []).join(', ')}\n\nPRIMARY KEYWORD\n${listing.primaryKeyword || ''}\n`) });
    entries.push({ name: 'collection-manifest.json', stream: file(JSON.stringify({ collection: project.name, images: chosen.map(c => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })) }, null, 2)) });
  }
  const name = `${slug(project.name)}-${body.scope === 'package' ? 'etsy-package' : 'images'}.zip`;
  return new Response(zipStream(entries), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' } });
}
