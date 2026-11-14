import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { userCredential } from '@/lib/credentials';
import { nativeAssetBucket } from '@/lib/native-bridge';
import { zipStream, type ZipEntry } from '@/lib/zip-stream';
import {
  LISTING_IMAGE_SPECS, LISTING_HEIGHT, LISTING_WIDTH, listingFilename, listingTitle,
  originalAssets, type ListingImageRecord, type ListingPlacement, type ListingAsset, type ListingImageStatus
} from '@/lib/etsy-listing-image-plan';

const bad = (message: string, status = 400) => Response.json({ error: message }, { status });
const bucket = () => nativeAssetBucket() ?? env.BUCKET;
const validId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{8,80}$/.test(id);
const validNumber = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 15;
type StoredProject = {
  id: string; name: string; theme?: string; subtheme?: string; palette?: string;
  characters?: ListingAsset[]; listingImages?: ListingImageRecord[];
};
const sanitizedText = (s: string, limit: number) => s.replace(/[<>\r\n]/g, ' ').trim().slice(0, limit);
const normalizedImages = (project: StoredProject) => Array.isArray(project.listingImages)
  ? project.listingImages.filter(item => validNumber(item.number)) : [];

async function findProject(projectId: string, owner: string) {
  const rows = await getDb().select().from(projects).where(and(eq(projects.id, projectId), eq(projects.owner, owner))).limit(1);
  return rows[0] || null;
}
function savedAssetKey(urlString: string, projectId: string, owner: string): string | null {
  let url: URL;
  try { url = new URL(urlString, 'https://app.local'); } catch { return null; }
  const id = url.searchParams.get('assetId');
  const format = url.searchParams.get('format');
  if (url.origin !== 'https://app.local' || url.pathname !== '/api/thumbnail-background' ||
      url.searchParams.get('projectId') !== projectId || !id ||
      !/^[0-9a-f-]{36}$/.test(id) || !['jpg', 'png'].includes(format || '')) return null;
  return 'generated/' + owner + '/' + id + '.' + format;
}
function preparedRecord(value: ListingImageRecord, project: StoredProject, previous?: ListingImageRecord): ListingImageRecord {
  const allowed = new Set(originalAssets(project.characters || []).map(item => item.id));
  const placements: ListingPlacement[] = Array.isArray(value.placements) ? value.placements.slice(0, 300).filter(p =>
    p && allowed.has(p.assetId) &&
    [p.x, p.y, p.width, p.height, p.rotation ?? 0].every(v => typeof v === 'number' && Number.isFinite(v)) &&
    p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100 &&
    p.width > 0 && p.width <= 100 && p.height > 0 && p.height <= 100 &&
    Math.abs(p.rotation ?? 0) <= 30
  ) : previous?.placements || [];
  const status: ListingImageStatus = value.status === 'approved' || value.status === 'needs_revision' ? value.status : 'draft';
  // An explicit empty render URL clears stale approved JPGs during regeneration.
  // Preserve this reliability fix while restoring the PR18 generation prompts.
  const renderedImageUrl = value.renderedImageUrl !== undefined ? value.renderedImageUrl : previous?.renderedImageUrl;
  const backgroundUrl = value.backgroundUrl !== undefined ? value.backgroundUrl : previous?.backgroundUrl;
  if (renderedImageUrl && !savedAssetKey(renderedImageUrl, project.id, 'owner-placeholder')) throw Error('Invalid composed image reference');
  if (backgroundUrl && !savedAssetKey(backgroundUrl, project.id, 'owner-placeholder')) throw Error('Invalid AI background reference');
  if (status === 'approved' && (!renderedImageUrl || !placements.length)) throw Error('Render an image with original collection artwork before approval');
  return { number: value.number, status, backgroundUrl, renderedImageUrl, placements, notes: sanitizedText(value.notes || '', 800), updatedAt: Date.now() };
}
async function updateImage(project: StoredProject, number: number, patch: ListingImageRecord, owner: string) {
  const existing = normalizedImages(project);
  const previous = existing.find(x => x.number === number);
  const normalized = preparedRecord({ ...patch, number }, project, previous);
  if (normalized.renderedImageUrl && !savedAssetKey(normalized.renderedImageUrl, project.id, owner)) throw Error('Invalid image URL');
  // Only update this one image, preserving every other collection field and all thumbnail designs.
  project.listingImages = [...existing.filter(x => x.number !== number), normalized].sort((a,b) => a.number - b.number);
  await getDb().update(projects).set({ data: JSON.stringify(project), updatedAt: Date.now() })
    .where(and(eq(projects.id, project.id), eq(projects.owner, owner)));
  return project.listingImages;
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  if (!validId(projectId)) return bad('Invalid collection');
  const stored = await findProject(projectId, user.userId);
  if (!stored) return bad('Collection not found', 404);
  const project = JSON.parse(stored.data) as StoredProject;
  const images = normalizedImages(project);
  if (url.searchParams.get('export') !== '1') return Response.json({ images });
  const selected = LISTING_IMAGE_SPECS.map(spec => images.find(item => item.number === spec.number));
  if (selected.some(item => !item || item.status !== 'approved' || !item.renderedImageUrl))
    return bad('Approve all 15 rendered listing images before exporting.', 409);
  const storage = bucket();
  if (!storage) return bad('Image storage is unavailable', 503);
  const entries: ZipEntry[] = [];
  for (const spec of LISTING_IMAGE_SPECS) {
    const item = selected[spec.number - 1]!;
    const key = savedAssetKey(item.renderedImageUrl!, projectId, user.userId);
    if (!key || !key.endsWith('.jpg') || !(await storage.head(key)))
      return bad('Missing saved JPG for image ' + spec.number + '. Re-render this listing image.', 409);
    entries.push({ name: listingFilename(spec.number), stream: async () => (await storage.get(key))?.body || null });
  }
  const name = sanitizedText(project.name || 'collection', 55).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'collection';
  return new Response(zipStream(entries), {
    headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="' + name + '-etsy-listing-images.zip"', 'Cache-Control': 'private, no-store' }
  });
}

type Input = {
  action?: 'generate' | 'save' | 'layout'; projectId?: string; number?: number;
  image?: ListingImageRecord; model?: string; quality?: string;
  backgroundUrl?: string; placements?: ListingPlacement[];
};
const blankScene: Record<number, string> = {
  8: 'Premium realistic overhead flat-lay photograph of ONE blank, white sticker sheet on an elegant desk. The sticker sheet should have a broad clean unprinted center occupying 36%-66% horizontally and 38%-86% vertically, with soft natural shadows. Absolutely no stickers, illustrations or printed designs on the sheet.',
  9: 'Premium realistic overhead flat-lay photograph of ONE plain, light-cream T-shirt laid perfectly flat, front side facing camera. Large smooth completely unprinted front chest around 40%-62% horizontal and 45%-75% vertical. No logos, graphics, embroidery or printed objects.',
  10: 'Premium realistic straight-on photograph of ONE blank ivory canvas tote bag, front panel facing the camera almost perfectly flat, with large empty unprinted center around 40%-62% horizontal and 46%-76% vertical. No logo, no decorations, no product illustrations.',
  11: 'Premium realistic overhead photograph of ONE kraft cardboard gift box with a large blank white rectangular paper label, flat to camera, in the lower middle; center label from around 40%-61% horizontal and 46%-74% vertical. All surfaces unprinted and free of illustrations.',
  12: 'Premium realistic overhead flat-lay scrapbook spread on handmade paper with a large clean blank cream craft page in the lower middle. Leave 34%-69% horizontal and 42%-80% vertical clear for exact transparent artwork to be overlaid. No drawings, stickers, animals, flowers or printed pictures in the mockup.'
};
function artPrompt(number: number, project: StoredProject, count: number): string {
  const spec = LISTING_IMAGE_SPECS[number - 1];
  const title = listingTitle(number, project.subtheme || project.theme || project.name);
  const subtitle = number === 6 || number === 13 ? count + ' original digital clipart illustrations'
    : number === 14 ? 'Digital product • No physical item included'
    : number === 2 || number === 3 || number === 5 ? count + ' original collection images'
    : number === 1 ? 'Digital Clipart Collection' : 'Creative ideas using original clipart';
  const palette = sanitizedText(project.palette || 'warm ivory, forest green, muted earthy accents', 180);
  const core = [
    'Create a premium conversion-focused Etsy digital clipart listing IMAGE BACKGROUND with exact ARTISTIC TYPOGRAPHY.',
    'Aspect: 3:2 landscape source, center-cropped to 4:3. All important lettering must be within the middle 82% of source width. Final composition is 3000 x 2250.',
    'Render the exact main title: ' + JSON.stringify(title) + '. Render the exact subtitle: ' + JSON.stringify(subtitle) + '. No other writing, numerals, file specifications, licensing or marketing claims.',
    'Typography: expressive premium artisanal brush-script plus clear editorial serif, refined and striking at Etsy mobile thumbnail size. Lettering must be correctly spelled and legible.',
    'Visual continuity: warm ivory artisanal paper, gentle watercolor washes, forest or botanical dark lettering, elegant soft touches; suggested color direction: ' + JSON.stringify(palette) + '.',
    'Reserve the top 23% of the image for the headline and subtitle. Place all essential text ONLY in the top 23%, with ample edge-safe spacing.',
    'The actual digital clipart collection is NOT provided to you; original PNG assets will be composited later by PaletteIQ. Do not invent or paint any clipart artwork, characters, food, floral illustrations, miniature icons, badges depicting objects, or product substitutes.',
    'Do not claim asset dimensions, DPI, license terms, digital file formats or asset counts other than the exact verified subtitle supplied.',
    'Consistent tasteful professional photography/graphic design, high-key natural lighting, spacious graphic hierarchy.'
  ];
  if (spec.kind === 'mockup') {
    return [
      ...core,
      'Below the title area, create the following REALISTIC BLANK PRODUCT MOCKUP ENVIRONMENT, which is NOT included in the clipart bundle:',
      blankScene[number],
      'The featured product MUST REMAIN COMPLETELY BLANK. Do not put any artwork or illustrative subjects on or around the product. Original PNG designs will be placed on the precise printable area afterward.',
      'Keep printable area front-facing and free of perspective distortion, hands, text, graphics, fingers, props covering the surface.'
    ].join('\n');
  }
  return [
    ...core,
    'Create ONLY a decorative NONFIGURATIVE graphic background and the requested exact title and subtitle. No photographs, product objects, illustrated figures, patterns depicting products, animals, plants, food, icons or silhouettes.',
    spec.kind === 'all' || spec.kind === 'all-grouped' || spec.kind === 'categories'
      ? 'Make the area below the top 23% mostly soft ivory with minimal low-contrast paper grain; many small original clipart assets will be arranged in a balanced gallery grid there.'
      : spec.kind === 'information' ? 'Keep lower two thirds very clean and light for clear informational overlays and the original artworks.' :
      'Keep the area beneath title open with gentle nonfigurative watercolor pigment edges, leaving generous room to showcase selected original clipart.',
    'Design direction: ' + spec.purpose
  ].join('\n');
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  const input = await request.json().catch(() => null) as Input | null;
  if (!input || !validId(input.projectId) || !validNumber(input.number)) return bad('Invalid collection or image');
  const stored = await findProject(input.projectId, user.userId);
  if (!stored) return bad('Collection not found', 404);
  const project = JSON.parse(stored.data) as StoredProject;
  if (input.action === 'save') {
    if (!input.image || input.image.number !== input.number) return bad('Invalid image record');
    try {
      const images = await updateImage(project, input.number, input.image, user.userId);
      return Response.json({ images });
    } catch (error) { return bad(error instanceof Error ? error.message : 'Could not save listing image'); }
  }
  if (input.action === 'layout') {
    const fallback = (Array.isArray(input.placements) ? input.placements : []).slice(0, 24);
    const valid = new Map(originalAssets(project.characters || []).map(asset => [asset.id, asset.name]));
    if (!fallback.length || fallback.some(p => !p || !valid.has(p.assetId) ||
      ![p.x,p.y,p.width,p.height].every(x => typeof x === 'number' && Number.isFinite(x)) ||
      p.x < 0 || p.y < 0 || p.width <= 0 || p.height <= 0 || p.x + p.width > 101 || p.y + p.height > 101))
      return bad('Invalid original collection placement plan');
    const key = savedAssetKey(input.backgroundUrl || '', input.projectId, user.userId);
    if (!key || !key.endsWith('.png')) return bad('Invalid AI background');
    const storedBackground = await bucket()?.get(key);
    if (!storedBackground) return bad('AI background not found', 404);
    const bytes = new Uint8Array(await storedBackground.arrayBuffer());
    if (bytes.length > 20_000_000) return bad('AI background exceeds Vision limit', 413);
    let binary = '';
    for (let i=0; i<bytes.length; i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
    const base64 = btoa(binary);
    const keyOpenAi = await userCredential(user.userId, 'openai') || (env as unknown as Record<string,string|undefined>).OPENAI_API_KEY;
    if (!keyOpenAi) return bad('Configure OpenAI API key for Vision positioning', 503);
    const isMockup = input.number >= 8 && input.number <= 12;
    const descriptor = fallback.map(p => ({ id:p.assetId, name:valid.get(p.assetId), x:p.x, y:p.y, width:p.width, height:p.height }));
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method:'POST', headers:{Authorization:'Bearer '+keyOpenAi,'Content-Type':'application/json'},
        body:JSON.stringify({
          model:'gpt-4.1-mini',
          input:[{role:'user',content:[
            {type:'input_text',text:[
              'You are an expert graphic designer positioning EXISTING ORIGINAL PNG LAYERS on an AI-generated empty listing design. NEVER draw or regenerate clipart.',
              'Inspect the supplied BACKGROUND IMAGE PIXELS to locate the already-rendered artistic typography and unobstructed blank printable space.',
              'Final export is 4:3 landscape (3000x2250), made by center-cropping the supplied 3:2 background, removing approximately 5.56% from both left and right edges. Return coordinate percentages relative to this FINAL 4:3 crop, NOT the uncropped source.',
              'The title and subtitle must remain unobstructed, usually in the upper 23% of the final canvas.',
              isMockup ? 'This is a realistic BLANK PRODUCT MOCKUP. All supplied original asset layers MUST fit on the blank flat printable area of the product and not float on table/background. Account for actual blank surface position in visible pixels. Do not cover straps, hands, folds, shadows or the product edge.' : 'Use intentional size hierarchy and negative space. For many gallery items keep original grid, adjust only to avoid title, maintain layout clarity.',
              'Return ONLY JSON: {"placements":[{"assetId":"source-id","x":30,"y":40,"width":18,"height":22,"rotation":0}],"unsafe":false,"notes":""}.',
              'Return each listed assetId EXACTLY ONCE and NO new IDs. Coordinate ranges 0–100. Retain approximate proportions of existing placement slots; never infer an object shape or invent an asset from its name.',
              'If a safe printable area does not exist, set unsafe=true and return current proposed placements unchanged. Values must be numbers.',
              'Current original-layer plan:',JSON.stringify(descriptor)
            ].join('\n')},
            {type:'input_image',image_url:'data:image/png;base64,'+base64}
          ]}],text:{format:{type:'json_object'}}
        }), signal:AbortSignal.timeout(60000)
      });
      if (!response.ok) return Response.json({placements:fallback, fallback:'Vision layout unavailable; original asset-safe placement retained.'});
      const answer = await response.json() as {output?:Array<{content?:Array<{text?:string}>}>};
      const raw = answer.output?.flatMap(a=>a.content||[]).map(c=>c.text||'').join('') || '{}';
      const parsed = JSON.parse(raw) as {placements?:ListingPlacement[]; unsafe?:boolean; notes?:string};
      const candidates = Array.isArray(parsed.placements) ? parsed.placements : [];
      const ids = new Set(fallback.map(p=>p.assetId));
      const seen = new Set<string>();
      const correct = !parsed.unsafe && candidates.length === fallback.length && candidates.every(p => {
        if (!p || !ids.has(p.assetId) || seen.has(p.assetId)) return false;
        seen.add(p.assetId);
        return [p.x,p.y,p.width,p.height,p.rotation ?? 0].every(n=>typeof n==='number' && Number.isFinite(n)) &&
          p.x>=0 && p.y>=23 && p.width>=2 && p.height>=2 &&
          p.x+p.width<=100 && p.y+p.height<=98 && Math.abs(p.rotation??0)<=15;
      });
      if (!correct) return Response.json({placements:fallback, fallback:'Vision could not verify a safe layout. Review and adjust the original asset positions.'});
      return Response.json({placements:candidates, note:sanitizedText(parsed.notes||'',180)});
    } catch {
      return Response.json({placements:fallback, fallback:'Vision layout timed out; safe original placement plan retained.'});
    }
  }
  if (input.action !== 'generate') return bad('Unknown listing image action');
  const storage = bucket();
  if (!storage) return bad('Image storage is unavailable', 503);
  const count = originalAssets(project.characters || []).length;
  if (!count) return bad('Generate at least one collection image before creating a listing.');
  const model = input.model || 'gpt-image-1-mini';
  if (!/^gpt-image-[a-z0-9.-]{1,80}$/.test(model)) return bad('Choose an OpenAI image model');
  const quality = input.quality || 'medium';
  if (!['low', 'medium', 'high'].includes(quality)) return bad('Invalid image quality');
  const key = await userCredential(user.userId, 'openai') || (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
  if (!key) return bad('Configure OpenAI API key in Settings', 503);
  const prompt = artPrompt(input.number, project, count);
  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size: '1536x1024', quality, output_format: 'png', n: 1 }),
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) return bad('AI background failed (HTTP ' + response.status + '): ' + (await response.text()).slice(0, 250), 502);
    const result = await response.json() as { data?: Array<{ b64_json?: string }> };
    const b64 = result.data?.[0]?.b64_json || '';
    if (!b64) return bad('AI did not return an image', 502);
    const bytes = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    if (bytes.length < 8 || bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71 || bytes.length > 20_000_000)
      return bad('AI did not return a valid PNG image', 502);
    // Product mockup objects are permitted only in mockup steps. Generated clipart artwork is not.
    const q = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        input: [{ role: 'user', content: [
          { type: 'input_text', text: 'Inspect this Etsy listing BACKGROUND, not a final listing. Return JSON ONLY: {"inventedClipart":boolean,"printedProductArtwork":boolean,"reason":string}. Any standalone cartoon/watercolor/illustrated clipart animal, food, flower, icon or miniature product art means inventedClipart=true. Abstract painterly textures and script/serif lettering are permitted. Mockup number is ' + input.number + '. For numbers 8-12, an empty realistic physical product/blank sticker sheet/blank garment/blank tote/blank label/blank scrapbook is allowed, but no illustrations or printed graphics on its printable area. For all other numbers only abstract artwork and typography are allowed. Be specific and conservative; do not reject brush strokes or paper texture as objects.' },
          { type: 'input_image', image_url: 'data:image/png;base64,' + b64 }
        ]}], text: { format: { type: 'json_object' } }
      }),
      signal: AbortSignal.timeout(60000)
    });
    if (!q.ok) return bad('AI art validation failed (HTTP ' + q.status + '); no image accepted', 502);
    const validation = await q.json() as { output?: Array<{ content?: Array<{ text?: string }> }> };
    const parsed = JSON.parse(validation.output?.flatMap(o => o.content || []).map(c => c.text || '').join('') || '{}') as {
      inventedClipart?: boolean; printedProductArtwork?: boolean; reason?: string;
    };
    if (parsed.inventedClipart !== false || parsed.printedProductArtwork !== false)
      return bad('AI background contains possible invented art: ' + sanitizedText(parsed.reason || 'Manual review required', 180), 422);
    const assetId = crypto.randomUUID();
    await storage.put('generated/' + user.userId + '/' + assetId + '.png', bytes);
    const backgroundUrl = '/api/thumbnail-background?projectId=' + encodeURIComponent(input.projectId) +
      '&assetId=' + assetId + '&format=png';
    return Response.json({ backgroundUrl, number: input.number, width: LISTING_WIDTH, height: LISTING_HEIGHT });
  } catch (error) {
    return bad('Could not generate listing background: ' + (error instanceof Error ? error.message : String(error)).slice(0,180), 502);
  }
}
