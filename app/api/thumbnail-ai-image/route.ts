import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { userCredential, userGeminiKeys } from '@/lib/credentials';
import { nativeAssetBucket } from '@/lib/native-bridge';

type LayoutItem = { type: 'image' | 'text'; x: number; y: number; width: number; height: number; text?: string };
type RequestBody = { projectId?: string; provider?: string; model?: string; quality?: string; width?: number; height?: number; layout?: LayoutItem[] };
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const bucket = () => nativeAssetBucket() ?? env.BUCKET;

export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  let input: RequestBody;
  try { input = await req.json() as RequestBody; } catch { return bad('Invalid JSON'); }
  if (typeof input.projectId !== 'string' || !/^[\w-]{8,80}$/.test(input.projectId)) return bad('Invalid collection');
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
  if (width !== height) return bad('AI thumbnail generation currently requires a square canvas');
  const storage = bucket();
  if (!storage) return bad('Image storage is unavailable', 503);
  const collection = JSON.parse(rows[0].data) as { name?: string; theme?: string; subtheme?: string; style?: string; characters?: Array<{ name?: string }> };
  const characters = (collection.characters || []).map(item => String(item.name || '').slice(0, 100)).filter(Boolean).slice(0, 30);
  const layout = Array.isArray(input.layout) ? input.layout.slice(0, 48).filter(item => item && (item.type === 'image' || item.type === 'text')).map(item => ({
    type: item.type, x: Math.max(-20, Math.min(120, Number(item.x) || 0)), y: Math.max(-20, Math.min(120, Number(item.y) || 0)),
    width: Math.max(1, Math.min(120, Number(item.width) || 10)), height: Math.max(1, Math.min(120, Number(item.height) || 10)),
    text: item.type === 'text' ? String(item.text || '').slice(0, 120) : undefined
  })) : [];
  const prompt = [
    'Create one ORIGINAL high-quality square promotional thumbnail for an Etsy digital clipart collection.',
    'Theme and identity:', JSON.stringify({ title: collection.name, theme: collection.theme, subtheme: collection.subtheme, style: collection.style }),
    'Suggested characters (generate original illustrations, do not copy any third-party reference):', JSON.stringify(characters),
    'Approximate composition (percentage coordinates; abstract layout only):', JSON.stringify(layout),
    'Use an organic, irregular, playful asymmetric arrangement with characters of varied scale distributed to fill the canvas, including some edge-cropped ornaments. Preserve a clear central or intentionally placed text zone.',
    'Use a theme-specific elegant readable main title, show the exact count ' + (collection.characters?.length || 0) + ' PNG Clipart and legible text 300 DPI. Never use third-party shop names, brands, logos, or watermarks.',
    'This is a promotional graphic, not a source for individually editable characters. Make visual elements cohesive and typography premium, polished and readable.',
    'Target square canvas dimensions: ' + width + 'x' + height + ' pixels. Provider may generate a nearby supported size; the editor will resize the result precisely.'
  ].join('\\n');
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
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], ...(model.startsWith('gemini-3') ? { imageConfig: { aspectRatio: '1:1', imageSize: width > 2048 ? '4K' : width > 1024 ? '2K' : '1K' } } : {}) } }),
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
