import { env } from 'cloudflare:workers';
import { thumbnailImagePrompt } from '@/lib/thumbnail-image-prompt';
import { buildThumbnailDesignBrief, type ThumbnailBriefSettings } from '@/lib/thumbnail-design-brief';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { userCredential, userGeminiKeys } from '@/lib/credentials';
import { nativeAssetBucket } from '@/lib/native-bridge';

type LayoutItem = { type: 'image' | 'text'; x: number; y: number; width: number; height: number; text?: string };
type RequestBody = { projectId?: string; provider?: string; model?: string; quality?: string; width?: number; height?: number; layout?: LayoutItem[]; includeTitle?: boolean; mode?: 'full-thumbnail' | 'background-only' | 'background-with-typography'; headline?: string; subtitle?: string; badge?: string; letteringStyle?: 'auto' | 'arched' | 'flowing' | 'stacked' | 'hand-painted'; slideName?: string; artDirection?: string; textZone?: { x: number; y: number; width: number; height: number }; backgroundStyle?: 'watercolor' | 'paper' | 'gradient' | 'botanical' | 'vintage'; backgroundIntensity?: 'soft' | 'balanced' | 'vibrant'; designBoldness?: 'soft' | 'balanced' | 'bold'; coverStyle?: 'editorial' | 'boutique' | 'storybook' | 'modern' | 'watercolor'; referenceDesign?: { graphicMotif?: string; letteringStyle?: string; paletteMood?: string }; designBriefSettings?: ThumbnailBriefSettings };
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
  if (mode === 'background-with-typography' && (!(input.headline?.trim() || input.subtitle?.trim() || input.badge?.trim()) || (input.headline || '').length > 100 || (input.subtitle || '').length > 140 || (input.badge || '').length > 60)) return bad('Specify at least one title, subtitle, or badge text (within length limits)');
  const letteringStyle = ['auto', 'arched', 'flowing', 'stacked', 'hand-painted'].includes(input.letteringStyle || '') ? input.letteringStyle || 'auto' : 'auto';
  const backgroundStyle = input.backgroundStyle || 'watercolor';
  const backgroundIntensity = input.backgroundIntensity || 'balanced';
  const designBoldness = input.designBoldness || 'balanced';
  const coverStyle = input.coverStyle || 'editorial';
  if (!['soft', 'balanced', 'bold'].includes(designBoldness)) return bad('Invalid design boldness');
  if (!['editorial', 'boutique', 'storybook', 'modern', 'watercolor'].includes(coverStyle)) return bad('Invalid cover style');
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
    type: item.type, x: Math.max(-100, Math.min(200, Number(item.x) || 0)), y: Math.max(-100, Math.min(200, Number(item.y) || 0)),
    width: Math.max(1, Math.min(200, Number(item.width) || 10)), height: Math.max(1, Math.min(200, Number(item.height) || 10)),
    text: item.type === 'text' ? String(item.text || '').slice(0, 120) : undefined
  })) : [];
  // The source layout may deliberately bleed outside the frame. AI receives
  // only the visible intersection of each rectangle with the 0-100 canvas.
  // This is a prompt mask, NEVER a change to the user's composited PNG layers.
  const visibleLayout = layout.filter(item => item.type === 'image').map(item => {
    const x = Math.max(0, item.x), y = Math.max(0, item.y);
    return { x, y, width: Math.max(0, Math.min(100, item.x + item.width) - x),
      height: Math.max(0, Math.min(100, item.y + item.height) - y) };
  }).filter(item => item.width > 0 && item.height > 0);
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
  const energy: Record<string, string> = {
    soft: 'Refined and airy, understated but not blank. One meaningful design motif, layered depth and clear headline.',
    balanced: 'Striking yet tasteful, strong title treatment, layered palette, balanced contrast and visible depth.',
    bold: 'Scroll-stopping and instantly readable: expressive oversized artistic title with mixed type styles, impactful contrasting sections, layered brushstrokes and a creative badge shape. Avoid template-like symmetry or thin ornate borders.'
  };
  const slideLabel = String(input.slideName || '').toLowerCase();
  const slideDirection = slideLabel.includes('hero')
    ? 'HERO COVER: one bold typographic statement, visually large collection assets will surround it. Prefer lively asymmetric ink-wash ring or shape, no repetitive border.'
    : slideLabel.includes('showcase')
      ? 'COLLECTION SHOWCASE: elegant curated gallery heading, restrained supporting labels and deliberate structure; the original item grid must remain easy to scan.'
      : slideLabel.includes('artistic')
        ? 'ARTISTIC TYPOGRAPHY: make expressive custom brush/serif lettering the star, with dynamic negative space and minimal abstract supporting decoration.'
        : slideLabel.includes('storybook')
          ? 'STORYBOOK GALLERY: layered torn paper, light page framing and bookish lettering; preserve quiet separate spaces for original clipart.'
          : slideLabel.includes('boutique')
            ? 'MODERN BOUTIQUE: bold asymmetric editorial split, a tall independent typographic panel and a distinct artwork display zone.'
            : slideLabel.includes('preview')
              ? 'FULL COLLECTION PREVIEW: elegant compact editorial header over a neutral uncluttered gallery background for many original products.'
              : slideLabel.includes('closeup')
                ? 'ARTWORK CLOSEUPS: minimal magazine-like framing and generous negative space for a few large cropped-free original art details.'
                : 'CURATED COLLECTION: design a fresh, collection-specific elegant graphic identity with good headline hierarchy and room for exact original assets.';
  // IMPORTANT: the raster generator is a typography/background-only service.
  // Never feed it the collection's objects, character names, reference listing or
  // narrative artDirection: those are intended for the layout planner only and
  // encourage the image model to generate counterfeit collection illustrations.
  const abstractStyles: Record<string, string> = {
    editorial: 'expressive editorial typesetting, spacious offset typography panels and confident flat shapes',
    boutique: 'luxury modern boutique branding, asymmetric split panels and subtle paper layering',
    storybook: 'artful book cover typography, irregular paper collage and gentle pigment textures',
    modern: 'bold contemporary graphic design, oversized typography and geometric color blocks',
    watercolor: 'free-flowing abstract watercolor pigments behind elegant hand-lettering'
  };
  // Reference layout analysis returns only allowlisted nonfigurative design tokens.
  // No uploaded image, original character name or semantic product content enters image-generation prompts.
  const reference = input.referenceDesign;
  const graphicMotifs: Record<string, string> = {
    'blush-brush-ring': 'Delicate translucent pale blush-pink hand-painted CIRCULAR BRUSH RING surrounding an airy title region; cream watercolor paper. No flowers, petals, leaves, food or illustrated objects.',
    'split-panel': 'Refined asymmetric panel division with gentle soft-edged color fields, not large hard geometric slabs.',
    'paper-collage': 'Layered subtly deckled handmade paper and restrained warm painterly edges.',
    'soft-wash': 'Very light watercolor pigment haze around outer edges, mostly ivory negative space.',
    'minimal-lines': 'Thin elegant editorial rules and subtle typographic framing on ivory paper.'
  };
  const letteringStyles: Record<string, string> = {
    'script-serif': 'Hand-lettered expressive flowing brush-script on the first key word paired with oversized elegant contrast serif for the second, dark forest-green lettering and earthy burgundy accent; premium magazine cover, perfectly legible.',
    'editorial-serif': 'Elegant high-contrast editorial serif display title with tasteful italic and varied line sizes.',
    'modern-display': 'Premium contemporary display typography, striking size contrast and balanced letterspacing.',
    'hand-lettered': 'Confident, flowing artisanal calligraphy hand lettering with clean supporting small caps.'
  };
  const paletteMoods: Record<string, string> = {
    'blush-sage': 'Warm ivory paper, blush pink watercolor accents, deep forest green title, gentle sage secondary marks, and muted terracotta detail; do not use orange or blue color blocks.',
    'earthy-warm': 'Warm ivory, gentle terracotta, espresso ink, soft tan watercolor stains and natural cream.',
    'forest-cream': 'Creamy ivory, pine green, sage watercolor and a very small blush accent.',
    'pastel': 'Soft powder pastel pink, muted sage, ivory and dusty peach with very low contrast backgrounds.',
    'vibrant': 'Distinct but tasteful editorial accents with ivory background and deep ink lettering.'
  };
  const referenceGuide = [
    graphicMotifs[reference?.graphicMotif || ''] || '',
    letteringStyles[reference?.letteringStyle || ''] || '',
    paletteMoods[reference?.paletteMood || ''] || ''
  ].filter(Boolean).join(' ');
  const graphicDirection = [
    // Reference style deliberately outranks generic cover style when available.
    mode === 'background-only'
      ? 'Premium nonfigurative graphic composition: painterly movement, textless color fields, tactile paper and refined ornamental structure; no text, badges or writing.'
      : referenceGuide || abstractStyles[coverStyle],
    mode === 'background-only' ? 'Balance abstract colors and texture without visual words or title-like shapes.' : energy[designBoldness],
    styleGuidance[backgroundStyle],
    intensityGuidance[backgroundIntensity],
    'Use non-representational forms ONLY. Every shape must look like paint, paper, typography or graphic geometry, never an object, character, illustration, photograph, silhouette or miniature icon.',
    'No pictorial symbols or decorative themed icons. Absolutely no standalone illustrations anywhere on canvas.',
    'The real product artwork is NOT in this request and is placed later from exact stored PNGs by PaletteIQ.'
  ].join(' ');
  const artisticStyles: Record<string, string> = {
    auto: 'Choose the most compelling bespoke hand-lettered composition: graceful arched headline, varied-size expressive serif with natural brush-script flourishes, or tasteful layered lettering. Avoid rigid straight baseline and generic font-template appearance.',
    arched: 'Compose the dominant headline on a readable curved or arched baseline, with custom expressive calligraphy and beautifully varied letter heights. Set smaller supporting words on complementary gentle curves.',
    flowing: 'Use energetic flowing watercolor-ink brush calligraphy with organic strokes, expressive swashes and rhythmically alternating letter heights. Maintain crisp word legibility.',
    stacked: 'Create a striking multi-line editorial hierarchy using asymmetric stacked words, customized high-contrast lettering, selective italic forms and distinctive but readable spacing.',
    'hand-painted': 'Draw organic hand-painted lettering with subtle ink variation and bespoke curved strokes, mixed with restrained refined editorial text. Avoid a mechanical font look.'
  };
  const typographyInstruction = mode === 'background-only'
    ? 'ZERO LETTERING: NO title, NO subtitle, NO badge, NO watermark, NO numbers, NO letters, NO pseudo-letters or decorative words anywhere. Entire canvas must be free of all text and glyph-like marks.'
    : [
      'PREMIUM CUSTOM ARTISTIC LETTERING: letterforms should feel composed by an experienced editorial artist, not typed with a rigid stock font.',
      artisticStyles[letteringStyle],
      input.headline?.trim() ? 'EXACT MAIN TITLE: ' + JSON.stringify(safeText(input.headline)) + '.' : 'NO MAIN TITLE: leave title blank.',
      input.subtitle?.trim() ? 'EXACT SUBTITLE: ' + JSON.stringify(safeText(input.subtitle)) + '.' : 'NO SUBTITLE: leave subtitle blank.',
      input.badge?.trim() ? 'EXACT BADGE LETTERING: ' + JSON.stringify(safeText(input.badge)) + ' in a tasteful abstract ornamental badge.' : 'NO BADGE: do not invent a badge or extra label.',
      'Arched, curved, flowing, gently waved, offset, or layered typography is welcome when suitable; the title can split across lines with visual rhythm. Use balanced size contrasts, beautiful shapes and premium watercolor/editorial styling.',
      'Prioritize legibility on Etsy search thumbnails: keep the lettering within the designated text-safe area, retain correct wording, spelling and punctuation, avoid obscuring the original clipart slots.',
      'Do not add ANY other words, quantity, DPI, fake watermark or marketing claims.',
      'These are words to typeset, NOT objects to illustrate. Do not draw a visual depiction of the title words.'
    ].join(' ');
  const heroReferenceStyle = [
    'Create a premium Etsy cover with a large soft cream central medallion panel.',
    'Use a blush watercolor circular brush ring around the central title area.',
    'Typography is the visual hero: first keyword in expressive dark forest brush script, second keyword in elegant earthy-red serif.',
    'Keep the background light, airy, and refined on warm ivory paper.',
    'Do NOT use bold orange or teal abstract blobs dominating the canvas.',
    'Do NOT create illustrations, icons, mini food drawings, or product substitutes.',
    'Leave the outer perimeter visually suitable for exact original PNG clipart placements.'
  ].join(' ');
  const isHeroCover = /hero cover/i.test(String(input.slideName || ''));
  // Preserve selected Reference & Assets configuration, but never accept untrusted
  // freeform image-generation instructions from the client.
  const brief = input.designBriefSettings;
  const designBrief = mode === 'full-thumbnail' || !brief ? '' : buildThumbnailDesignBrief({
    ...brief,
    headline: input.headline || brief.headline,
    subtitle: input.subtitle || brief.subtitle,
    typography: mode === 'background-only' ? 'editable' : 'ai-artwork',
    textDisabled: mode === 'background-only' && brief.textDisabled === true,
    quality: String(input.quality || brief.quality),
    coverStyle, boldness: designBoldness,
    backgroundStyle, intensity: backgroundIntensity,
    // Collection style fields are read from the authenticated database, not the client.
    collectionStyle: (collection as {style?:string}).style,
    collectionPalette: (collection as {palette?:string}).palette,
    collectionTexture: (collection as {texture?:string}).texture
  });
  const prompt = mode === 'full-thumbnail'
    ? thumbnailImagePrompt(collection, layout, width, height, input.includeTitle !== false)
    : [
      'Produce a 1:1 square GRAPHIC DESIGN BACKDROP for an Etsy listing. Deliver only abstract background shapes and' + (mode === 'background-only' ? ' NO text.' : ' artistic typography.'),
      'THIS IS NOT AN ILLUSTRATION JOB. Output ZERO standalone objects, icons, illustrations, characters, food, products, photos, drawings or imitations of clipart. Do not visualize the collection, its subject, its category, the title meaning, or the asset slot contents.',
      'ONLY authorized visual materials: abstract color fields, watercolor pigment strokes, soft gradients, paper collage textures, thin graphic rules, elegant geometric ornaments, abstract painted swashes, ribbons without pictorial motifs and type (when requested).',
      'Never create even tiny pictorial decorations or theme-related objects in corners, title panels, badges, circles or along the edges. The entire canvas is non-figurative.',
      typographyInstruction,
      ...(mode === 'background-only' ? [] : ['Keep all artistic lettering inside the reserved safe area (percent canvas coordinates):', JSON.stringify(titleZone)]),
      'Visible areas where original PNG assets will later be composited. Some original images deliberately extend BEYOND the canvas: preserve their visible slots and allow natural crop at the final canvas edge. Leave these slots free of competing decoration; never fill them with substitutes:', JSON.stringify(visibleLayout),
      'A small degree of deliberate original-PNG overlap is permitted and handled by PaletteIQ, but DO NOT draw any items in that space.',
      'Premium design mood (follow reference graphic style when provided):', graphicDirection,
      ...(designBrief ? ['REFERENCE & ASSETS SETTINGS (graphic art direction ONLY; never synthesize objects):', designBrief] : []),
      ...(isHeroCover ? ['HERO ART DIRECTION PRIORITY:', heroReferenceStyle] : []),
      'If a blush brush-ring reference is provided, DO NOT substitute red-orange geometric blobs. Keep the watercolor ring delicate and the central typography visually expressive.',
      'Slide composition identifier:', slideLabel.replace(/[^a-z0-9 -]/g,'').slice(0,50),
      'Graphic layout direction:', slideDirection.replace(/collection assets|original products|original clipart/gi,'empty image areas'),
      'Prioritize decorative graphic design, NOT themed illustration. No accidental images, illustration vignettes or iconography.',
      ...(mode === 'background-only' ? ['FINAL STRICT RULE: ABSOLUTELY NO TEXT, TITLES, SUBTITLES, BADGES, SYMBOLS RESEMBLING LETTERS OR NUMBERS.'] : [])
    ].join('\n');
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
  let qcRejection = '';
  if (mode === 'background-with-typography' || mode === 'background-only') {
    // Fail closed for composition: rejected images are retained for inspection, not accepted.
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
            {type:'input_text',text:'You are reviewing a decorative background layer for a commercial clipart bundle, NOT the finished thumbnail. This layer will later receive exact original PNG clipart from a separate collection. Return ONLY JSON: {"containsObjects":boolean,"containsText":boolean,"reason":string}. Set containsObjects=true ONLY if the image visibly includes a discrete, recognizable, standalone illustrated subject that could be mistaken for a clipart asset offered in the bundle (for example an illustrated bowl of ramen, sushi, a teapot, animal character, identifiable flower bouquet, a tiny product illustration or a photo of a dish). Set containsObjects=false for decorative motifs that are NOT standalone product subjects: watercolor pigments, ink splashes, painterly swooshes, abstract botanical flourishes, leaf-like ornament integrated into borders, thin gold swirls, linework, ribbons, medallions, geometric shapes, paper texture, and abstract silhouettes. An ornamental pattern is NOT a product image just because its curves resemble leaves or petals. Classify based on actual visible content, not guesses about possible objects. Set containsText=true if any readable letters, numerals, words, or pseudo-lettering appear; decorative lines are not text. Background mode: ' + JSON.stringify(mode) + '. For background-only mode, neither product illustrations nor text should appear. For background-with-typography mode, real words and lettering are allowed but standalone illustrative products are not. Give a brief reason naming the specific prohibited illustrated subject when containsObjects is true; never claim an item exists unless visually apparent.'},
            {type:'input_image',image_url:'data:' + (isPng ? 'image/png' : 'image/jpeg') + ';base64,' + imageBase64}
          ]}],text:{format:{type:'json_object'}}
        }), signal: AbortSignal.timeout(60000)
      });
    } catch { return bad('Could not verify background is free of generated clipart; image rejected', 502); }
    if (!review.ok) return bad('Background object validation failed (HTTP ' + review.status + '); image rejected', 502);
    try {
      const validation = await review.json() as {output?:Array<{content?:Array<{text?:string}>}>};
      const raw = validation.output?.flatMap(x=>x.content||[]).map(x=>x.text||'').join('') || '{}';
      const decision = JSON.parse(raw) as {containsObjects?:boolean; containsText?:boolean; reason?:string};
      if (decision.containsObjects !== false) {
        const reason = typeof decision.reason === 'string' ? decision.reason.replace(/[<>\r\n]/g, ' ').slice(0,190) : '';
        qcRejection = 'Possible AI-generated collection-like object' + (reason ? ': ' + reason : '') + '. Inspect before accepting.';
      }
      if (mode === 'background-only' && decision.containsText !== false)
        qcRejection = [qcRejection, 'Unexpected text on decorative-only background.'].filter(Boolean).join(' ');
    } catch { return bad('Background validation returned an unreadable response; image rejected', 502); }
  }
  const assetId = crypto.randomUUID();
  await storage.put('generated/' + user.userId + '/' + assetId + '.' + format, bytes);
  const imageUrl = '/api/thumbnail-background?projectId=' + encodeURIComponent(input.projectId) + '&assetId=' + assetId + '&format=' + format;
  // Return flagged artwork as a review-only draft. The client MUST NOT composite it
  // until the user has explicitly checked it contains no invented product objects.
  return Response.json({ imageUrl, prompt, qcRejected: Boolean(qcRejection), qcReason: qcRejection || undefined });
}
