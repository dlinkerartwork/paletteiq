import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { userCredential } from '@/lib/credentials';

type Layout = {
  slots?: Array<{ x: number; y: number; width: number; height: number; rotation?: number }>;
  texts?: Array<{ text: string; x: number; y: number; width: number; height: number }>;
  background?: string;
};
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
const sanitizeBox = (item: Record<string, unknown>) => ({
  x: clamp(Number(item.x), 0, 95), y: clamp(Number(item.y), 0, 95),
  width: clamp(Number(item.width), 3, 100), height: clamp(Number(item.height), 3, 100)
});

export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Sign in required' }, { status: 401 });
  let body: { projectId?: string; imageUrl?: string; count?: number };
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.projectId || !/^[\w-]{8,80}$/.test(body.projectId)) return Response.json({ error: 'Invalid collection' }, { status: 400 });
  const stored = await getDb().select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.owner, user.userId))).limit(1);
  if (!stored.length) return Response.json({ error: 'Collection not found' }, { status: 404 });
  const collection = JSON.parse(stored[0].data) as { images?: string[]; selectedImageUrls?: string[] };
  const reference = String(body.imageUrl || '');
  const isUpload = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(reference) && reference.length <= 5_500_000;
  const isListingImage = (collection.images || []).includes(reference) && (() => {
    try { const url = new URL(reference); return url.protocol === 'https:' && (url.hostname === 'etsystatic.com' || url.hostname.endsWith('.etsystatic.com')); } catch { return false; }
  })();
  if (!isUpload && !isListingImage) return Response.json({ error: 'Choose a saved Etsy listing image or upload an image up to 4 MB.' }, { status: 400 });
  const key = await userCredential(user.userId, 'openai') || (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
  if (!key) return Response.json({ error: 'Configure your OpenAI API key in Settings to analyze reference layouts.' }, { status: 503 });
  const count = Math.round(clamp(Number(body.count) || 8, 1, 24));
  const prompt = 'Analyze only the ABSTRACT composition of this product thumbnail to guide an ORIGINAL Etsy listing mockup. Do not reproduce any reference artwork, shop branding, watermarks, or distinctive text. Suggest up to ' + count + ' rectangles where our own clipart characters can be placed. Return JSON only: {"slots":[{"x":15,"y":20,"width":25,"height":30,"rotation":0}],"texts":[{"text":"CUSTOMIZE YOUR TITLE","x":10,"y":5,"width":80,"height":12}],"background":"#f5ede3"}. Units are percentages of image width and height from top-left (0–100). Text must be generic editable placeholder copy, never transcribe source text. Avoid overlapping major elements; include a balanced readable title area. Return 1–' + count + ' slots and 0–3 generic text placeholders.';
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4.1-mini', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: reference }] }], text: { format: { type: 'json_object' } } }),
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) return Response.json({ error: 'OpenAI layout analysis failed (HTTP ' + response.status + ').' }, { status: 502 });
    const result = await response.json() as { output?: Array<{ content?: Array<{ text?: string }> }> };
    const raw = result.output?.flatMap(block => block.content || []).map(item => item.text || '').join('') || '{}';
    const parsed = JSON.parse(raw) as Layout;
    const slots = Array.isArray(parsed.slots) ? parsed.slots.filter(s => s && typeof s === 'object').slice(0, count).map(s => ({
      ...sanitizeBox(s as unknown as Record<string, unknown>), rotation: clamp(Number(s.rotation) || 0, -90, 90)
    })) : [];
    const texts = Array.isArray(parsed.texts) ? parsed.texts.filter(t => t && typeof t === 'object').slice(0, 3).map(t => ({
      ...sanitizeBox(t as unknown as Record<string, unknown>), text: String(t.text || 'CUSTOMIZE TITLE').slice(0, 100)
    })) : [];
    const background = typeof parsed.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.background) ? parsed.background : '#f7f1e9';
    return Response.json({ layout: { slots, texts, background } });
  } catch (error) {
    return Response.json({ error: 'Could not analyze layout: ' + (error instanceof Error ? error.message : String(error)).slice(0, 200) }, { status: 502 });
  }
}
