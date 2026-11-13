import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { userCredential } from '@/lib/credentials';

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
  } | null;
  if (!body?.projectId || !/^[\w-]{8,80}$/.test(body.projectId)) return fail('Invalid collection');
  if (!Array.isArray(body.characters) || !body.characters.length || body.characters.length > 36) return fail('Select 1–36 collection clipart assets');
  const records = await getDb().select().from(projects)
    .where(and(eq(projects.id, body.projectId), eq(projects.owner, user.userId))).limit(1);
  if (!records.length) return fail('Collection not found', 404);
  const collection = JSON.parse(records[0].data) as { theme?: string; subtheme?: string; characters?: Artwork[] };
  const originals = new Map((collection.characters || []).filter(c => !!c.imageUrl).map(c => [c.id, c.name]));
  const selected = body.characters.filter(c => originals.has(c.id)).slice(0, 36)
    .map(c => ({ id: c.id, name: originals.get(c.id) }));
  if (!selected.length) return fail('No original collection clipart files found', 422);
  const titleArea = body.textZone || { x: 20, y: 29, width: 60, height: 40 };
  if (![titleArea.x,titleArea.y,titleArea.width,titleArea.height].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100) ||
    titleArea.width < 12 || titleArea.height < 12 || titleArea.x + titleArea.width > 100 || titleArea.y + titleArea.height > 100) return fail('Invalid typography zone');
  const key = await userCredential(user.userId, 'openai') || (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
  if (!key) return fail('Configure OpenAI key in Settings', 503);
  const prompt = [
    'You are an expert premium Etsy listing art director. Return ONLY JSON; do not generate an image.',
    'Design a visually compelling premium Etsy product cover, not a generic vintage certificate. Choose asymmetry, bold visual rhythm, layered depth, expressive yet legible type space and a dominant illustration focal point. Adapt composition specifically to the slide intent; avoid excessive borders, tiny equal-sized clipart and bland symmetry.',
    'You must place ONLY provided ORIGINAL CLIPART ASSET IDs. The thumbnail compositor will use exact original PNG files. Never create, rename or invent characters.',
    'Return JSON: {"artDirection":"short coherent descriptive direction","slots":[{"characterId":"EXACT_ID","x":0,"y":0,"width":15,"height":18,"rotation":0}]}',
    'All coordinates are 0–100 percentages of the full square canvas, top-left origin. Width and height describe the clipart bounding box.',
    'Keep every character fully within 2% to 98% of canvas, considering rotation. NEVER overlap the title/lettering-safe zone (5% clearance). For cover/hero/editorial slides, overlap BETWEEN original clipart assets is intentionally allowed, up to about 30% of the smaller rotated bounding box for attractive layered depth. Catalogue grid slides remain non-overlapping. Rotation -10 through +10 degrees.',
    'NON-GRID HERO / BOUTIQUE / CLOSEUP: pick one large focal original object around 22–32% canvas width, two secondary originals around 15–22%, smaller accents around 8–14%. Make largest at least 1.7x the smallest in width. Do not shrink every asset to the margins; balance large pieces around the title-safe zone. Catalogue grid slides may use consistent small sizes.',
    'Clipart hierarchy preference:', body.hierarchy || 'dramatic',
    'Cover design style:', String(body.coverStyle || 'editorial').slice(0,50),
    'Do not place any collection asset inside the reserved typography zone; the typography/artwork layer occupies it. Treat this as a compositional anchor rather than an excuse to make the clipart microscopic.',
    'The design direction should specify polished background, premium lettering and restrained decorative badges; use the collection theme, not generic saturated abstract art.',
    'Be faithful to the slide headline and selected collection objects. If the headline is narrow, never choose thematically unrelated items.',
    'Slide:',JSON.stringify({key:body.slideKey,name:body.slideName,headline:body.headline,subtitle:body.subtitle}),
    'Theme:',JSON.stringify({theme:collection.theme,subtheme:collection.subtheme}),
    'Safe typography zone:',JSON.stringify(titleArea),
    'Optional reference layout hints, not binding; ignore any hint colliding with title:',JSON.stringify((body.suggestedSlots || []).slice(0,36)).slice(0,2600),
    'Authorized ORIGINAL assets:',JSON.stringify(selected)
  ].join('\n');
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model:'gpt-4.1-mini', input:prompt, text:{format:{type:'json_object'}} }),
      signal:AbortSignal.timeout(60000)
    });
    if (!response.ok) return fail('AI art direction unavailable (HTTP ' + response.status + ')', 502);
    const answer = await response.json() as { output?: Array<{ content?: Array<{text?:string}> }> };
    const raw = answer.output?.flatMap(x => x.content || []).map(x => x.text || '').join('') || '{}';
    const parsed = JSON.parse(raw) as { artDirection?: string; slots?: Slot[] };
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
      if (collides(box,titleArea,5)) continue;
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
    if (!placed.length) return fail('AI did not return any safe original-asset positions', 422);
    if (!['showcase','preview','storybook','category-0','category-1'].includes(String(body.slideKey || '')) && placed.length >= 3) {
      const widths = placed.map(slot => slot.width);
      if (Math.max(...widths) / Math.max(1, Math.min(...widths)) < (body.hierarchy === 'soft' ? 1.18 : body.hierarchy === 'medium' ? 1.38 : 1.65))
        return fail('AI composition has no clear hero/secondary/accent size hierarchy; use curated fallback layout', 422);
    }
    return Response.json({
      slots:placed, textZone:titleArea,
      artDirection:String(parsed.artDirection || '').replace(/[<>]/g,'').slice(0,650),
      assetSource:'original'
    });
  } catch (error) { return fail('AI layout planning failed: ' + (error instanceof Error ? error.message : String(error)).slice(0,180),502); }
}
