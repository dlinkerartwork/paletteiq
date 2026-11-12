import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { userCredential, userGeminiKeys } from '@/lib/credentials';

type Layout = {
  slots?: Array<{ x: number; y: number; width: number; height: number; rotation?: number }>;
  texts?: Array<{ text: string; x: number; y: number; width: number; height: number; curve?: number }>;
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
  let body: { projectId?: string; imageUrl?: string; count?: number; provider?: string; model?: string; referenceStyle?: 'creative' | 'similar' | 'palette' };
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!body.projectId || !/^[\w-]{8,80}$/.test(body.projectId)) return Response.json({ error: 'Invalid collection' }, { status: 400 });
  const stored = await getDb().select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.owner, user.userId))).limit(1);
  if (!stored.length) return Response.json({ error: 'Collection not found' }, { status: 404 });
  const collection = JSON.parse(stored[0].data) as { name?: string; theme?: string; subtheme?: string; style?: string; images?: string[]; selectedImageUrls?: string[]; characters?: Array<{ name?: string; imageUrl?: string }> };
  const reference = String(body.imageUrl || '');
  const isUpload = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(reference) && reference.length <= 5_500_000;
  const isListingImage = (collection.images || []).includes(reference) && (() => {
    try { const url = new URL(reference); return url.protocol === 'https:' && (url.hostname === 'etsystatic.com' || url.hostname.endsWith('.etsystatic.com')); } catch { return false; }
  })();
  if (!isUpload && !isListingImage) return Response.json({ error: 'Choose a saved Etsy listing image or upload an image up to 4 MB.' }, { status: 400 });
  const provider = body.provider || 'openai';
  if (provider !== 'openai' && provider !== 'gemini') return Response.json({ error: 'Invalid AI provider' }, { status: 400 });
  const model = body.model || (provider === 'openai' ? 'gpt-4.1-mini' : 'gemini-2.5-pro');
  if (typeof model !== 'string' || !(provider === 'openai' ? /^gpt-[a-z0-9.-]{1,80}$/ : /^gemini-[a-z0-9.-]{1,80}$/).test(model)) return Response.json({ error: 'Invalid AI model' }, { status: 400 });
  const key = provider === 'openai' ? await userCredential(user.userId, 'openai') || (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY : undefined;
  const geminiKeys = provider === 'gemini' ? await userGeminiKeys(user.userId) : [];
  if (provider === 'openai' && !key) return Response.json({ error: 'Configure your OpenAI API key in Settings.' }, { status: 503 });
  if (provider === 'gemini' && !geminiKeys.length) return Response.json({ error: 'Configure your Gemini API key in Settings.' }, { status: 503 });
  const count = Math.round(clamp(Number(body.count) || 8, 1, 24));
  const referenceStyle = body.referenceStyle || 'creative';
  if (!['creative', 'similar', 'palette'].includes(referenceStyle)) return Response.json({ error: 'Invalid reference interpretation' }, { status: 400 });
  const interpretation = referenceStyle === 'similar' ? 'Follow the general spatial hierarchy and density while using our original assets.' : referenceStyle === 'palette' ? 'Use only the color atmosphere and artistic mood. Create a distinct fresh composition.' : 'Creatively reinterpret abstract composition and hierarchy into a distinct original design.';
  const prompt = interpretation + ' Analyze only the ABSTRACT composition of this product thumbnail to guide an ORIGINAL Etsy listing mockup. Do not reproduce any reference artwork, shop branding, watermarks, or distinctive text. Suggest up to ' + count + ' rectangles where our own clipart characters can be placed. Return JSON only: {"slots":[{"x":15,"y":20,"width":25,"height":30,"rotation":0}],"texts":[{"text":"CUSTOMIZE YOUR TITLE","x":10,"y":5,"width":80,"height":12,"curve":0}],"background":"#f5ede3"}. Units are percentages of image width and height from top-left (0–100). Text must be generic editable placeholder copy, never transcribe source text. Respect the reference composition density and intentional negative space. A thumbnail may feature only a few selected characters arranged artistically with a strong focal point, balanced spacing and breathing room between characters. Suggest only the character slots the composition needs; the requested count is a maximum, not a target. Do not fill empty areas with extra characters or ornaments. Use a fuller composition only when appropriate to the reference. Avoid automatic edge cropping; keep characters fully visible unless the reference composition calls for cropping. Include a balanced readable title area without consuming all negative space. Count every distinct visible text block, subtitle, badge, caption and headline in the reference, preserving approximately the SAME NUMBER of independently editable text regions (up to 32); do NOT combine many separate text blocks into one. Use theme-specific original marketing copy instead of generic placeholders or wording copied from the reference. Theme: ' + JSON.stringify({ collection: collection.name, theme: collection.theme, subtheme: collection.subtheme, style: collection.style, totalCharacters: collection.characters?.length || 0 }).slice(0,1200) + '. Include a visible title using the theme, a short count label such as "' + (collection.characters?.length || 0) + ' PNG Clipart", as editable text blocks. Do not invent DPI, licensing, or file-format specifications. If the reference has fewer text blocks, add the required count line discreetly. If the reference text follows an arch or curved baseline, set curve from -100 to 100 (positive curves upward); otherwise use 0. Return 1–' + count + ' character slots and as many text placeholders as the reference visibly contains, capped at 32.';
  try {
    let parsed: Layout;
    if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: reference }] }], text: { format: { type: 'json_object' } } }),
        signal: AbortSignal.timeout(60_000)
      });
      if (!response.ok) return Response.json({ error: 'OpenAI layout analysis failed (HTTP ' + response.status + '). The selected model may not support image input.' }, { status: 502 });
      const result = await response.json() as { output?: Array<{ content?: Array<{ text?: string }> }> };
      const raw = result.output?.flatMap(block => block.content || []).map(item => item.text || '').join('') || '{}';
      parsed = JSON.parse(raw) as Layout;
    } else {
      let mime = 'image/jpeg';
      let imageBase64 = '';
      if (isUpload) {
        const match = reference.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
        if (!match) return Response.json({ error: 'Invalid uploaded image format' }, { status: 400 });
        mime = match[1]; imageBase64 = match[2];
      } else {
        const image = await fetch(reference, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
        if (!image.ok) return Response.json({ error: 'Could not load reference image' }, { status: 502 });
        mime = (image.headers.get('content-type') || '').split(';')[0];
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) return Response.json({ error: 'Unsupported reference image type' }, { status: 422 });
        const bytes = new Uint8Array(await image.arrayBuffer());
        if (bytes.length > 4_000_000) return Response.json({ error: 'Reference image exceeds 4 MB' }, { status: 413 });
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        imageBase64 = btoa(binary);
      }
      let responseText = '';
      let lastError = 'Gemini layout analysis unavailable';
      for (const geminiKey of geminiKeys) {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
          method: 'POST', headers: { 'x-goog-api-key': geminiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: imageBase64 } }] }], generationConfig: { responseMimeType: 'application/json' } }),
          signal: AbortSignal.timeout(60000)
        });
        if (!response.ok) {
          lastError = 'Gemini layout analysis failed (HTTP ' + response.status + '). The selected model may not support image input.';
          if ([401, 403, 429, 500, 502, 503, 504].includes(response.status)) continue;
          break;
        }
        const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        responseText = body.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
        break;
      }
      if (!responseText) return Response.json({ error: lastError }, { status: 502 });
      parsed = JSON.parse(responseText) as Layout;
    }
    const slots = Array.isArray(parsed.slots) ? parsed.slots.filter(s => s && typeof s === 'object').slice(0, count).map(s => ({
      ...sanitizeBox(s as unknown as Record<string, unknown>), rotation: clamp(Number(s.rotation) || 0, -90, 90)
    })) : [];
    const texts = Array.isArray(parsed.texts) ? parsed.texts.filter(t => t && typeof t === 'object').slice(0, 32).map(t => ({
      ...sanitizeBox(t as unknown as Record<string, unknown>), text: String(t.text || 'CUSTOMIZE TITLE').slice(0, 100), curve: clamp(Number(t.curve) || 0, -100, 100)
    })) : [];
    const background = typeof parsed.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.background) ? parsed.background : '#f7f1e9';
    return Response.json({ layout: { slots, texts, background } });
  } catch (error) {
    return Response.json({ error: 'Could not analyze layout: ' + (error instanceof Error ? error.message : String(error)).slice(0, 200) }, { status: 502 });
  }
}
