import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { projects, studioSettings } from '@/db/schema';
import { zipStream, type ZipEntry } from '@/lib/zip-stream';
import { normalizeListing, selectSeoExportDraft, formatSeoExportText } from '@/lib/etsy-listing';
import { nativeAssetBucket } from '@/lib/native-bridge';
import { batchAssetKey } from '@/lib/batch-assets';
import { createImageFileNamer, DEFAULT_IMAGE_NAMING } from '@/lib/image-file-naming';

const enc = new TextEncoder();
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'collection';
const file = (content: string) => async () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(enc.encode(content)); controller.close(); } });
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Sign in required' }, { status: 401 });
  const bucket = nativeAssetBucket() ?? env.BUCKET;
  if (!bucket) return Response.json({ error: 'Image storage unavailable' }, { status: 503 });
  const body = await request.json() as { projectId?: string; ids?: string[]; scope?: 'selected' | 'all' | 'package' };
  if (typeof body.projectId !== 'string' || !['selected','all','package'].includes(body.scope || '')) return Response.json({ error: 'Invalid export request' }, { status: 400 });
  const rows = await getDb().select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.owner, user.userId))).limit(1);
  if (!rows.length) return Response.json({ error: 'Collection not found' }, { status: 404 });
  const project = JSON.parse(rows[0].data) as { name: string; theme?: string; subtheme?: string; microtheme?: string; listing?: unknown; seoReview?: unknown; characters: Array<{ id: string; name: string; imageUrl?: string }> };
  if (body.scope === 'package' && !(project.listing && typeof project.listing === 'object' && typeof (project.listing as { title?: string }).title === 'string' && (project.listing as { title: string }).title.trim())) return Response.json({ error: 'Create and save an Etsy listing draft before exporting the final package.' }, { status: 400 });
  const selectedIds = new Set(Array.isArray(body.ids) ? body.ids.filter(v => typeof v === 'string') : []);
  const chosen = project.characters.filter(c => c.imageUrl && (body.scope !== 'selected' || selectedIds.has(c.id)));
  if (!chosen.length) return Response.json({ error: 'No generated images selected' }, { status: 400 });
  if (chosen.length > 1000) return Response.json({ error: 'Too many images in one ZIP' }, { status: 400 });
  const settings = await getDb().select({ preferences: studioSettings.preferences }).from(studioSettings).where(eq(studioSettings.owner, user.userId)).limit(1);
  let pattern = DEFAULT_IMAGE_NAMING;
  let seoDraftFields: unknown = undefined;
  try { if (settings[0]) { const prefs = JSON.parse(settings[0].preferences) as { seoFileNaming?: string; seoDraftFields?: unknown }; pattern = prefs.seoFileNaming || DEFAULT_IMAGE_NAMING; seoDraftFields = prefs.seoDraftFields; } }
  catch { /* Older settings fall back to the original naming convention. */ }
  const imageFileName = createImageFileNamer(pattern, { theme: project.theme || project.name, subtheme: project.subtheme, microtheme: project.microtheme, collection: project.name });
  const entries: ZipEntry[] = [];
  for (const [index, character] of chosen.entries()) {
    const path = new URL(character.imageUrl!, 'https://app.local');
    const match = path.pathname.match(/^\/api\/images\/([0-9a-f-]{36})$/);
    if (!match) return Response.json({ error: 'Invalid stored image reference' }, { status: 400 });
    const extension = path.searchParams.get('format') === 'jpg' ? 'jpg' : 'png';
    const batchId = path.searchParams.get('batch');
    if (batchId && !/^[0-9a-f-]{36}$/.test(batchId)) return Response.json({ error: 'Invalid Batch image reference' }, { status: 400 });
    const key = batchId ? batchAssetKey(user.userId, match[1], extension, batchId) : `generated/${user.userId}/${match[1]}.${extension}`;
    if (!await bucket.head(key)) return Response.json({ error: `Image file missing for ${character.name}` }, { status: 409 });
    entries.push({ name: `images/${imageFileName(character.name, index, extension)}`, stream: async () => (await bucket.get(key))?.body || null });
  }
  if (body.scope === 'package') {
    const listing = normalizeListing(project.listing);
    entries.push({ name: 'etsy-listing-draft.json', stream: file(JSON.stringify(selectSeoExportDraft(listing, seoDraftFields), null, 2)) });
    entries.push({ name: 'etsy-listing-draft.txt', stream: file(formatSeoExportText(listing, seoDraftFields)) });
    entries.push({ name: 'collection-manifest.json', stream: file(JSON.stringify({ collection: project.name, images: chosen.map(c => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })) }, null, 2)) });
  }
  const name = `${slug(project.name)}-${body.scope === 'package' ? 'etsy-package' : 'images'}.zip`;
  return new Response(zipStream(entries), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' } });
}
