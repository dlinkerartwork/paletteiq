import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { userCredential } from '@/lib/credentials';
import { nativeAssetBucket } from '@/lib/native-bridge';
import { fitClipartAroundTypography } from '@/lib/thumbnail-fit';

type Box = { x: number; y: number; width: number; height: number };
type Slot = Box & { characterId: string; rotation: number };
type Artwork = { id: string; name: string; imageUrl?: string };
const fail = (message: string, status = 400) => Response.json({ error: message }, { status });
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, Number.isFinite(x) ? x : a));
const bounds = (s: Slot): Box => {
  const angle = Math.abs(s.rotation) * Math.PI / 180;
  const w = s.width * Math.cos(angle) + s.height * Math.sin(angle);
  const h = s.width * Math.sin(angle) + s.height * Math.cos(angle);
  return { x: s.x + (s.width - w) / 2, y: s.y + (s.height - h) / 2, width: w, height: h };
};
const collides = (a: Box, b: Box, margin = 3) =>
  a.x < b.x + b.width + margin && a.x + a.width + margin > b.x &&
  a.y < b.y + b.height + margin && a.y + a.height + margin > b.y;

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return fail('Sign in required', 401);
  const body = await request.json().catch(() => null) as {
    projectId?: string; slideKey?: string; slideName?: string; headline?: string;
    subtitle?: string; textZone?: Box; characters?: Array<{ id: string; name: string }>; suggestedSlots?: Array<{ characterId: string; x: number; y: number; width: number; height: number }>;
    referenceStyle?: string; hierarchy?: 'soft' | 'medium' | 'dramatic'; coverStyle?: string;
    referenceCompositionGuide?: string;
    referenceImageUrl?: string;
    backgroundImageUrl?: string;
  } | null;
  if (!body?.projectId || !/^[\w-]{8,80}$/.test(body.projectId)) return fail('Invalid collection');
  if (!Array.isArray(body.characters) || !body.characters.length || body.characters.length > 36) return fail('Select 1–36 collection clipart assets');
  const records = await getDb().select().from(projects)
    .where(and(eq(projects.id, body.projectId), eq(projects.owner, user.userId))).limit(1);
  if (!records.length) return fail('Collection not found', 404);
  const collection = JSON.parse(records[0].data) as {
    theme?: string; subtheme?: string; images?: string[]; characters?: Artwork[];
  };
  const originals = new Map((collection.characters || []).filter(c => !!c.imageUrl).map(c => [c.id, c.name]));
  const selected = body.characters.filter(c => originals.has(c.id)).slice(0, 36)
    .map(c => ({ id: c.id, name: originals.get(c.id) }));
  if (!selected.length) return fail('No original collection clipart files found', 422);
  let titleArea = body.textZone || { x: 20, y: 29, width: 60, height: 40 };
  if (![titleArea.x,titleArea.y,titleArea.width,titleArea.height].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100) ||
    titleArea.width < 12 || titleArea.height < 12 || titleArea.x + titleArea.width > 100 || titleArea.y + titleArea.height > 100) return fail('Invalid typography zone');
  // Background-first Vision: read only a previously saved image belonging to this
  // authenticated owner's collection. Never fetch arbitrary URLs from the client.
  let backgroundDataUrl: string | undefined;
  if (body.backgroundImageUrl) {
    let parsedUrl: URL;
    try { parsedUrl = new URL(body.backgroundImageUrl, 'http://paletteiq.local'); }
    catch { return fail('Invalid background image URL', 422); }
    if (parsedUrl.pathname !== '/api/thumbnail-background' || parsedUrl.searchParams.get('projectId') !== body.projectId)
      return fail('Background does not belong to this collection', 403);
    const assetId = parsedUrl.searchParams.get('assetId') || '';
    const format = parsedUrl.searchParams.get('format') || '';
    if (!/^[0-9a-f-]{36}$/.test(assetId) || !['png','jpg'].includes(format)) return fail('Invalid background identifier', 422);
    const storage = nativeAssetBucket() ?? env.BUCKET;
    const object = await storage?.get('generated/' + user.userId + '/' + assetId + '.' + format);
    if (!object) return fail('Generated background not found', 404);
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.length > 20_000_000) return fail('Background exceeds vision size limit', 413);
    // The image was already validated by thumbnail-ai-image when stored.
    // Encode the owner's stored image for vision without exposing arbitrary fetch access.
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    backgroundDataUrl = 'data:image/' + (format === 'png' ? 'png' : 'jpeg') + ';base64,' + btoa(binary);
  }
  // This separate Vision request may inspect the design reference. It is NEVER
  // passed to the image generator and must belong to the owner's collection,
  // or be an explicitly uploaded PNG/JPG/WebP data image.
  let referenceDataUrl: string | undefined;
  if (body.referenceImageUrl) {
    const reference = body.referenceImageUrl;
    const uploaded = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(reference) &&
      reference.length <= 5_500_000;
    const listed = (collection.images || []).includes(reference) && (() => {
      try {
        const u = new URL(reference);
        return u.protocol === 'https:' &&
          (u.hostname === 'etsystatic.com' || u.hostname.endsWith('.etsystatic.com'));
      } catch { return false; }
    })();
    if (!uploaded && !listed) return fail('Reference image must be selected from this collection or uploaded for this session.', 403);
    referenceDataUrl = reference;
  }
  const key = await userCredential(user.userId, 'openai') || (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
  if (!key) return fail('Configure OpenAI key in Settings', 503);
  const prompt = [
    'You are an expert premium Etsy listing art director. Return ONLY JSON; do not generate an image.',
    backgroundDataUrl ? 'BACKGROUND-FIRST VISION: inspect the GENERATED BACKGROUND, locate actual title/subtitle lettering and decorative shapes, and place originals in its visual quiet regions. Protect visible lettering even if it differs from textZone.' : 'No background yet. Design an elegant initial layout.',
    referenceDataUrl ? 'REFERENCE IMAGE IS ALSO ATTACHED: use its background color hierarchy, typographic structure, and relative object position/size rhythm, but NEVER copy or regenerate pictured objects. Resolve conflicts in favor of readable text in the actual GENERATED BACKGROUND.' : 'If reference analysis failed, use the saved background image and safe regions for your art direction.',
    'Design a visually compelling premium Etsy product cover, not a generic vintage certificate. Choose asymmetry, bold visual rhythm, layered depth, expressive yet legible type space and a dominant illustration focal point. Adapt composition specifically to the slide intent; avoid excessive borders, tiny equal-sized clipart and bland symmetry.',
    'You must place ONLY provided ORIGINAL CLIPART ASSET IDs. The thumbnail compositor will use exact original PNG files. Never create, rename or invent characters.',
    'Return JSON: {"artDirection":"short coherent descriptive direction","detectedTitleZone":{"x":20,"y":29,"width":60,"height":25},"detectedSubtitleZone":{"x":25,"y":57,"width":50,"height":12},"slots":[{"characterId":"EXACT_ID","x":0,"y":0,"width":15,"height":18,"rotation":0}]}',
    'Report separate tight bounding rectangles for ALL visible title and subtitle lettering; the client will apply extra collision padding and proportional resizing. Never treat decorative brush rings as lettering. Do not cover typography even partially.',
    'All coordinates are 0–100 percentages of the full square canvas, top-left origin. Width and height describe the clipart bounding box.',
    'Keep every character fully within 2% to 98% of canvas, considering rotation. NEVER overlap the title/lettering-safe zone (5% clearance). For cover/hero/editorial slides, overlap BETWEEN original clipart assets is intentionally allowed, up to about 30% of the smaller rotated bounding box for attractive layered depth. Catalogue grid slides remain non-overlapping. Rotation -10 through +10 degrees.',
    'NON-GRID HERO / BOUTIQUE / CLOSEUP: pick one large focal original object around 22–32% canvas width, two secondary originals around 15–22%, smaller accents around 8–14%. Make largest at least 1.7x the smallest in width. Do not shrink every asset to the margins; balance large pieces around the title-safe zone. Catalogue grid slides may use consistent small sizes.',
    'Clipart hierarchy preference:', body.hierarchy || 'dramatic',
    'Cover design style:', String(body.coverStyle || 'editorial').slice(0,50),
    'Do not place any collection asset inside the reserved typography zone; the typography/artwork layer occupies it. Treat this as a compositional anchor rather than an excuse to make the clipart microscopic.',
    'Design direction describes positioning of existing PNGs ONLY. Do not propose new illustrations or redraw the background.',
    'Be faithful to the slide headline and selected collection objects. If the headline is narrow, never choose thematically unrelated items.',
    'Slide:',JSON.stringify({key:body.slideKey,name:body.slideName,headline:body.headline,subtitle:body.subtitle}),
    'Theme:',JSON.stringify({theme:collection.theme,subtheme:collection.subtheme}),
    'Safe typography zone:',JSON.stringify(titleArea),
    'REFERENCE-DRIVEN LAYOUT: make the size rhythm and position of original objects match the reference composition, while keeping all lettering readable. Position/scale originals after analyzing the real AI background.',
    'Reference composition guide (graphic layout only; never illustrate reference objects):',
    String(body.referenceCompositionGuide || '').replace(/[<>\r\n]/g,' ').slice(0,450),
    'Reference original-asset placement hints (prefer these while avoiding typography):',JSON.stringify((body.suggestedSlots || []).slice(0,36)).slice(0,2600),
    'Authorized ORIGINAL assets:',JSON.stringify(selected)
  ].join('\n');
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:'gpt-4.1-mini',
        input: backgroundDataUrl || referenceDataUrl ? [{
          role:'user', content: [
            {type:'input_text',text:prompt},
            ...(backgroundDataUrl ? [{type:'input_image' as const,image_url:backgroundDataUrl}] : []),
            ...(referenceDataUrl ? [{type:'input_image' as const,image_url:referenceDataUrl}] : [])
          ]
        }] : prompt,
        text:{format:{type:'json_object'}}
      }),
      signal:AbortSignal.timeout(60000)
    });
    if (!response.ok) return fail('AI art direction unavailable (HTTP ' + response.status + ')', 502);
    const answer = await response.json() as { output?: Array<{ content?: Array<{text?:string}> }> };
    const raw = answer.output?.flatMap(x => x.content || []).map(x => x.text || '').join('') || '{}';
    const parsed = JSON.parse(raw) as { artDirection?: string; slots?: Slot[]; detectedTitleZone?: Box; detectedSubtitleZone?: Box };
    // Keep title and subtitle as separate protected zones. A giant union could
    // incorrectly block most perimeter artwork and shrink hero illustrations.
    const visionZone = (zone: Box | undefined): Box | undefined => {
      if (!zone || ![zone.x,zone.y,zone.width,zone.height].every(v => typeof v === 'number' && Number.isFinite(v))) return undefined;
      if (zone.x < 0 || zone.y < 0 || zone.width < 5 || zone.height < 4 ||
        zone.x+zone.width > 100 || zone.y+zone.height > 100) return undefined;
      return zone;
    };
    const detectedTitle = backgroundDataUrl ? visionZone(parsed.detectedTitleZone) : undefined;
    const detectedSubtitle = backgroundDataUrl ? visionZone(parsed.detectedSubtitleZone) : undefined;
    const allowed = new Set(selected.map(c => c.id));
    const placed: Slot[] = [];
    const used = new Set<string>();
    for (const item of (Array.isArray(parsed.slots) ? parsed.slots : []).slice(0, selected.length)) {
      if (!item || !allowed.has(item.characterId) || used.has(item.characterId)) continue;
      const slot: Slot = {
        characterId: item.characterId,
        x: clamp(Number(item.x), 2, 97), y: clamp(Number(item.y), 2, 97),
        width: clamp(Number(item.width), 5, 35), height: clamp(Number(item.height), 5, 35),
        rotation: clamp(Number(item.rotation), -10, 10)
      };
      const box = bounds(slot);
      if (box.x < 2 || box.y < 2 || box.x + box.width > 98 || box.y + box.height > 98) continue;
      // Keep candidates that intersect lettering: the deterministic geometry fitter
      // will translate or resize them instead of deleting valuable collection assets.
      const isCatalogue = ['showcase','preview','storybook','category-0','category-1'].includes(String(body.slideKey || '')) || String(body.slideKey || '').startsWith('category-');
      if (isCatalogue && placed.some(p => collides(box,bounds(p),2))) continue;
      if (!isCatalogue && placed.some(p => {
        const other = bounds(p);
        const iw = Math.max(0, Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x));
        const ih = Math.max(0, Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y));
        const smaller = Math.min(box.width * box.height, other.width * other.height);
        return smaller <= 0 || (iw * ih) / smaller > .30;
      })) continue;
      placed.push(slot); used.add(slot.characterId);
    }
    const catalogue = ['showcase','preview','storybook','category-0','category-1'].includes(String(body.slideKey || '')) ||
      String(body.slideKey || '').startsWith('category-');
    const fitted = fitClipartAroundTypography(
      placed, [titleArea, ...(detectedTitle ? [detectedTitle] : [])],
      detectedSubtitle ? [detectedSubtitle] : [],
      { grid:catalogue, titlePadding:5, subtitlePadding:3, maxArtworkOverlap:.3,
        minScale:body.hierarchy === 'soft' ? .75 : body.hierarchy === 'medium' ? .65 : .55 }
    );
    if (!fitted.length) return fail('No safe clipart positions fit outside the visible typography. Use curated fallback.', 422);
    if (!catalogue && fitted.length >= 3) {
      const widths = fitted.map(slot => slot.width);
      if (Math.max(...widths) / Math.max(1, Math.min(...widths)) < (body.hierarchy === 'soft' ? 1.18 : body.hierarchy === 'medium' ? 1.38 : 1.65))
        return fail('AI composition has no clear hero/secondary/accent size hierarchy; use curated fallback layout', 422);
    }
    return Response.json({
      slots:fitted, textZone:titleArea, detectedTitleZone:detectedTitle, detectedSubtitleZone:detectedSubtitle,
      artDirection:String(parsed.artDirection || '').replace(/[<>]/g,'').slice(0,650),
      assetSource:'original'
    });
  } catch (error) { return fail('AI layout planning failed: ' + (error instanceof Error ? error.message : String(error)).slice(0,180),502); }
}
