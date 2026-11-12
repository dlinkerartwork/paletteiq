import { env } from 'cloudflare:workers';
import { thumbnailImagePrompt } from '@/lib/thumbnail-image-prompt';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { userCredential, userGeminiKeys } from '@/lib/credentials';
import { nativeAssetBucket } from '@/lib/native-bridge';

type LayoutItem = { type: 'image' | 'text'; x: number; y: number; width: number; height: number; text?: string };
type RequestBody = { projectId?: string; provider?: string; model?: string; quality?: string; width?: number; height?: number; layout?: LayoutItem[]; includeTitle?: boolean; mode?: 'full-thumbnail' | 'background-only'; backgroundStyle?: 'watercolor' | 'paper' | 'gradient' | 'botanical' | 'vintage'; backgroundIntensity?: 'soft' | 'balanced' | 'vibrant' };
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const bucket = () => nativeAssetBucket() ?? env.BUCKET;

export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  let input: RequestBody;
  try { input = await req.json() as RequestBody; } catch { return bad('Invalid JSON'); }
  if (typeof input.projectId !== 'string' || !/^[\w-]{8,80}$/.test(input.projectId)) return bad('Invalid collection');
  if (input.includeTitle !== undefined && typeof input.includeTitle !== 'boolean') return bad('includeTitle must be a boolean');
  const mode = input.mode || 'full-thumbnail';
  if (!['full-thumbnail', 'background-only'].includes(mode)) return bad('Invalid image generation mode');
  if (mode === 'background-only' && input.provider !== 'openai') return bad('Background-only generation uses OpenAI');
  const backgroundStyle = input.backgroundStyle || 'watercolor';
  const backgroundIntensity = input.backgroundIntensity || 'balanced';
  if (!['watercolor', 'paper', 'gradient', 'botanical', 'vintage'].includes(backgroundStyle)) return bad('Invalid background style');
  if (!['soft', 'balanced', 'vibrant'].includes(backgroundIntensity)) return bad('Invalid background intensity');
  const rows = await getDb().select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.owner, user.userId))).limit(1);
  if (!rows.length) return bad('Collection not found', 404);
  const provider = input.provider;
  const model = String(input.model || '');
  if (provider !== 'openai' && provider !== 'gemini') return bad('Choose OpenAI or Gemini');
  if (provider === 'openai' && !/^gpt-image-[a-z0-9.-]{1,80}$/.test(model)) return bad('Invalid OpenAI image model');
  if (provider === 'gemini' && !/^gemini-[a-z0-9.-]{1,80}$/.test(model)) return bad('Invalid Gemini image model');
  if (provider === 'gemini' && !model.includes('image')) return bad('Select a Gemini image-generation model');
  if (!['low', 'medium', 'high'].includes(String(input.quality))) return bad('Invalid image quality');
  const width = Number(input.width || 2000), height = Number(input.height || 2000);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 256 || height < 256 || width > 4096 || height > 4096) return bad('Canvas dimensions must be 256–4096 pixels');
  const storage = bucket();
  if (!storage) return bad('Image storage is unavailable', 503);
  const collection = JSON.parse(rows[0].data) as { name?: string; theme?: string; subtheme?: string; style?: string; characters?: Array<{ name?: string }> };
  const layout = Array.isArray(input.layout) ? input.layout.slice(0, 48).filter(item => item && (item.type === 'image' || item.type === 'text')).map(item => ({
    type: item.type, x: Math.max(-20, Math.min(120, Number(item.x) || 0)), y: Math.max(-20, Math.min(120, Number(item.y) || 0)),
    width: Math.max(1, Math.min(120, Number(item.width) || 10)), height: Math.max(1, Math.min(120, Number(item.height) || 10)),
    text: item.type === 'text' ? String(item.text || '').slice(0, 120) : undefined
  })) : [];
  const styleGuidance: Record<string, string> = {
    watercolor: 'Distinct layered watercolor pigment washes sweeping diagonally across the canvas, visible wet-on-wet edges, pigment blooms and delicate splatter-like granulation. The composition has artistic motion and meaningful color variation.',
    paper: 'Beautiful artisanal paper surface with clearly perceptible handmade fibers, subtle embossed textures, torn paper collage shapes and softly tinted overlapping paper layers.',
    gradient: 'Rich multidirectional pastel gradient with softly radiating colored light, warm-to-cool color transitions, translucent overlapping color fields and elegant depth.',
    botanical: 'Abstract botanical-inspired filigree silhouettes and soft organic leafy shadow patterns around the outer corners. Keep these decorative background shapes abstract, not individual clipart illustrations.',
    vintage: 'Vintage decorative printing texture, softly weathered colored parchment, faded ornamental corner flourishes, halftone pigment details and gentle aged-paper tonal variation.'
  };
  const intensityGuidance: Record<string, string> = {
    soft: 'Understated but undeniably visible artwork: at least three distinct pastel color regions, recognizable textural details, and a noticeable vignette. Avoid near-white blank surfaces.',
    balanced: 'Clearly visible decorative design with medium contrast, multiple complementary colored areas and varied textures. Decoration should be recognizable at small Etsy search thumbnail size.',
    vibrant: 'Expressive colorful decorative backdrop with stronger saturation, layered visual depth and lively abstract detailing. Keep a quiet central text zone despite the energetic edges.'
  };
  const prompt = mode === 'background-only'
    ? [
        'Create a VISIBLY DECORATED, PREMIUM, ORIGINAL SQUARE BACKGROUND ARTWORK for an Etsy digital clipart bundle listing.',
        'CRITICAL: The entire canvas must have obvious visual design. A plain white, flat ivory, uniform near-white, blank or empty background is NOT acceptable.',
        'Mandatory decorative direction:', styleGuidance[backgroundStyle],
        'Required color/contrast:', intensityGuidance[backgroundIntensity],
        'Use a theme-appropriate harmonized palette with clear colored washes and textures across the canvas. Keep central areas readable without becoming plain white. Make the result attractive even when viewed without any foreground content.',
        'Do NOT depict characters, animals, people, isolated clipart, logos, lettering, numbers, product mockups or any standalone subject from the collection. This is a decorative background layer only.',
        'The actual original collection clipart and editable typography will be composited above this image, so leave deliberate calm areas for them. Do not create their substitutes.',
        'Collection visual context:', JSON.stringify({ theme: collection.theme, subtheme: collection.subtheme, style: collection.style }).slice(0,900),
        'Reserved overlay areas (percentage boxes):', JSON.stringify(layout).slice(0,3500),
        'Absolutely no text, no watermarks, no frames or hard borders. Professional commercial design background, edge-to-edge square composition.'
      ].join('\\n')
    : thumbnailImagePrompt(collection, layout, width, height, input.includeTitle !== false);
  let imageBase64 = '';
  let imageMime = 'image/png';
  if (provider === 'openai') {
    const key = await userCredential(user.userId, 'openai') || (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
    if (!key) return bad('Configure the OpenAI API key in Settings', 503);
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size: '1024x1024', quality: input.quality, output_format: 'png', n: 1 }),
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) return bad('OpenAI image generation failed (HTTP ' + response.status + '): ' + (await response.text()).slice(0, 400), 502);
    const result = await response.json() as { data?: Array<{ b64_json?: string }> };
    imageBase64 = result.data?.[0]?.b64_json || '';
  } else {
    const keys = await userGeminiKeys(user.userId);
    if (!keys.length) return bad('Configure a Gemini API key in Settings', 503);
    let failure = 'Gemini image generation unavailable';
    for (const key of keys) {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
        method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], ...(model.startsWith('gemini-3') ? { imageConfig: { aspectRatio: Math.abs(width / height - 1) < 0.1 ? '1:1' : width > height ? '3:2' : '2:3', imageSize: Math.max(width, height) > 2048 ? '4K' : Math.max(width, height) > 1024 ? '2K' : '1K' } } : {}) } }),
        signal: AbortSignal.timeout(120000)
      });
      if (!response.ok) {
        failure = 'Gemini image generation failed (HTTP ' + response.status + '): ' + (await response.text()).slice(0, 350);
        if ([401,403,429,500,502,503,504].includes(response.status)) continue;
        break;
      }
      const result = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
      const part = result.candidates?.flatMap(c => c.content?.parts || []).find(p => p.inlineData?.data && ['image/png', 'image/jpeg'].includes(p.inlineData.mimeType || ''));
      imageBase64 = part?.inlineData?.data || '';
      imageMime = part?.inlineData?.mimeType || 'image/png';
      if (imageBase64) break;
      failure = 'Gemini returned no PNG image. Choose a supported image generation model.';
    }
    if (!imageBase64) return bad(failure, 502);
  }
  if (!imageBase64) return bad('AI provider returned no image', 502);
  const bytes = Uint8Array.from(atob(imageBase64), ch => ch.charCodeAt(0));
  const isPng = bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const isJpg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!(isPng || isJpg) || (imageMime === 'image/png' && !isPng) || (imageMime === 'image/jpeg' && !isJpg)) return bad('Provider did not return a valid image', 502);
  const format = isPng ? 'png' : 'jpg';
  if (bytes.length > 20_000_000) return bad('Generated image is too large', 413);
  const assetId = crypto.randomUUID();
  await storage.put('generated/' + user.userId + '/' + assetId + '.' + format, bytes);
  return Response.json({ imageUrl: '/api/thumbnail-background?projectId=' + encodeURIComponent(input.projectId) + '&assetId=' + assetId + '&format=' + format, prompt });
}
