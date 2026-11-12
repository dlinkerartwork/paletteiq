import { env } from 'cloudflare:workers';
import { thumbnailImagePrompt } from '@/lib/thumbnail-image-prompt';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { userCredential, userGeminiKeys } from '@/lib/credentials';
import { nativeAssetBucket } from '@/lib/native-bridge';

type LayoutItem = { type: 'image' | 'text'; x: number; y: number; width: number; height: number; text?: string };
type RequestBody = { projectId?: string; provider?: string; model?: string; quality?: string; width?: number; height?: number; layout?: LayoutItem[]; includeTitle?: boolean; mode?: 'full-thumbnail' | 'background-only' | 'background-with-typography'; headline?: string; subtitle?: string; slideName?: string; artDirection?: string; textZone?: { x: number; y: number; width: number; height: number }; backgroundStyle?: 'watercolor' | 'paper' | 'gradient' | 'botanical' | 'vintage'; backgroundIntensity?: 'soft' | 'balanced' | 'vibrant' };
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
  if (!['full-thumbnail', 'background-only', 'background-with-typography'].includes(mode)) return bad('Invalid image generation mode');
  if (mode !== 'full-thumbnail' && input.provider !== 'openai') return bad('Background generation uses OpenAI');
  if (mode === 'background-with-typography' && (!input.headline || input.headline.length > 100 || (input.subtitle || '').length > 140)) return bad('Invalid typography text');
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
  const width = Number(input.width || 1024), height = Number(input.height || 1024);
  if (mode !== 'full-thumbnail' && (width !== 1024 || height !== 1024)) return bad('Thumbnail design backgrounds must be 1024 × 1024 pixels');
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
  const titleZone = input.textZone && [input.textZone.x, input.textZone.y, input.textZone.width, input.textZone.height].every(n => Number.isFinite(n) && n >= 0 && n <= 100) ? input.textZone : { x: 8, y: 5, width: 84, height: 23 };
  const safeText = (text: string) => text.replace(/[<>\r\n]/g, ' ').trim().slice(0, 140);
  const isFoodTheme = /food|sushi|sashimi|japanese|chinese|asian|korean|ramen|cuisine|dish|dessert|bakery|meal|culinary/i.test([collection.name,collection.theme,collection.subtheme,input.headline].join(' '));
  const designDirection = isFoodTheme
    ? 'Premium gourmet cookbook editorial design: warm ivory and natural cream paper, minimal refined fine gold or muted terracotta hairline rules, delicate circular medallion or centered elegant editorial panel, very subtle ink wash or handmade paper texture. Colors muted sage, deep forest green and warm clay. Absolutely avoid high-saturation abstract blotches, bright rainbow gradients or noisy decorative splashes.'
    : 'Premium independent boutique editorial design, restrained sophisticated palette appropriate to the collection theme, carefully balanced subtle paper texture, delicate ornament and tasteful negative space. No loud abstract paint blobs.';
  const combinedPrompt = [
    'Generate one premium, professionally art-directed SQUARE ETSY CLIPART BUNDLE BACKGROUND that INCLUDES artistic typography, tasteful ornamental badges and beautiful decorative framing.',
    'STRICT SEPARATION: Draw NO collection-related objects whatsoever. NO illustrated dishes, foods, drinks, tea sets, sushi, flowers, plants, animals, characters, product assets, miniature illustrations, silhouettes, collage cutouts, or stock clipart. Avoid even objects that merely resemble collection images. The only figurative content permitted is typography and abstract badge/frame ornament.',
    'The AI must never invent, reconstruct, imitate, redraw, or depict any asset or visual object from the collection. All real objects are added later exclusively by PaletteIQ from original files.',
    'The compositor will place EXACT original collection PNG assets in the specified outer image slots after this background is generated.',
    'EXACT MAIN TITLE. Spell every letter carefully; do not paraphrase or add invented words:', JSON.stringify(safeText(input.headline || '')),
    'EXACT SUBTITLE:', JSON.stringify(safeText(input.subtitle || '')),
    'Place ALL lettering, title art and badges STRICTLY within the following typography safe zone in percentage coordinates:', JSON.stringify(titleZone),
    'All space occupied by lettering or badges MUST be inside that zone. Do not put stray text, pseudo-lettering or extra claims anywhere else.',
    'Professional graphic treatment: large expressive artistic title with strong hierarchy, smaller supporting line, thin gold frame, elegant editorial medallion or label, finely rendered decorative flourishes, beautifully spaced high-contrast typography.',
    'Avoid any unverified DPI, commercial-use or resolution claims. Add no count unless it appears in the exact provided subtitle.',
    'Everywhere outside the typography zone must remain decorative-only: paper texture, flat abstract color accents, thin graphic patterns and nonfigurative frames. No pictorial illustrations or recognizable objects anywhere.',
    'ART DIRECTOR COMPOSITION NOTES:', String(input.artDirection || '').replace(/[<>\r\n]/g, ' ').slice(0,650),
    'Theme-aware design direction:', designDirection,
    'User material (non-figurative textures only):', backgroundStyle === 'watercolor' ? 'subtle warm watercolor paper only, not dramatic color splashes' : styleGuidance[backgroundStyle],
    'Decorative intensity:', intensityGuidance[backgroundIntensity],
    'Collection theme:', JSON.stringify({theme:collection.theme,subtheme:collection.subtheme}).slice(0,500),
    'Reserved original clipart positions. Do not draw any characters or lettering inside these outside-title regions:', JSON.stringify(layout).slice(0,3000),
    'The final art should look like a premium Etsy listing COVER with the visual refinement of a professional editorial illustrator and brand designer.'
  ].join('\n');
  const prompt = mode === 'background-with-typography' ? combinedPrompt : mode === 'background-only'
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
      ].join('\n')
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
  if (mode === 'background-with-typography') {
    // Fail closed: do not accept an AI image containing character-like artwork.
    // Validation does not compare pixel identity and remains a best-effort visual check.
    const key = await userCredential(user.userId, 'openai') || (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
    if (!key) return bad('OpenAI is required for background illustration validation', 503);
    let review: Response;
    try {
      review = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          input: [{role:'user',content:[
            {type:'input_text',text:'Review this Etsy THUMBNAIL BACKGROUND ONLY. Reply with JSON {"containsObjects":true|false}. Mark true if you see ANY recognizable illustrated food, dish, plant, animal, person, standalone product, character or clipart-like object, even decorative miniatures or silhouettes. Ignore abstract frames, patterns, text, emblems and empty badge shapes. Be strict about food and collection artwork. Do not assess typography accuracy.'},
            {type:'input_image',image_url:'data:' + (isPng ? 'image/png' : 'image/jpeg') + ';base64,' + imageBase64}
          ]}],text:{format:{type:'json_object'}}
        }), signal: AbortSignal.timeout(60000)
      });
    } catch { return bad('Could not verify background is free of generated clipart; image rejected', 502); }
    if (!review.ok) return bad('Background object validation failed (HTTP ' + review.status + '); image rejected', 502);
    try {
      const validation = await review.json() as {output?:Array<{content?:Array<{text?:string}>}>};
      const raw = validation.output?.flatMap(x=>x.content||[]).map(x=>x.text||'').join('') || '{}';
      const decision = JSON.parse(raw) as {containsObjects?:boolean};
      if (decision.containsObjects !== false) return bad('AI background contains or may contain generated clipart-like objects. Image rejected; retry generation.', 422);
    } catch { return bad('Background validation returned an unreadable response; image rejected', 502); }
  }
  const assetId = crypto.randomUUID();
  await storage.put('generated/' + user.userId + '/' + assetId + '.' + format, bytes);
  return Response.json({ imageUrl: '/api/thumbnail-background?projectId=' + encodeURIComponent(input.projectId) + '&assetId=' + assetId + '&format=' + format, prompt });
}
