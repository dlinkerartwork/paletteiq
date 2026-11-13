/**
 * Unified Etsy thumbnail art-direction brief from Reference & Assets selections.
 * Intentionally NEVER includes character names, prompts, original images or instructions
 * to synthesize product illustrations. The exact collection PNGs are composed later.
 */
export type ThumbnailBriefSettings = {
  layoutMode: string; scope: string; slide: string; headline: string; subtitle: string;
  typography: 'editable' | 'ai-artwork'; boldness: string; hierarchy: string;
  coverStyle: string; quality: string; backgroundStyle: string; intensity: string;
  referenceInterpretation: string; hasReference: boolean;
  analysisProvider: string; analysisModel: string;
  imageModel: string;
  collectionStyle?: string; collectionPalette?: string; collectionTexture?: string;
};
const compact = (value: string | undefined, max = 100) =>
  (value || '').replace(/[\r\n<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export function buildThumbnailDesignBrief(settings: ThumbnailBriefSettings): string {
  const s = settings;
  return [
    'ETSY THUMBNAIL DESIGN BRIEF — BACKGROUND + TYPOGRAPHY ONLY.',
    'Generate only decorative nonfigurative background design and ' +
      (s.typography === 'ai-artwork' ? 'exact premium lettering.' : 'NO text; editable typography will be composited separately.'),
    'Output: 1:1 square; exact original collection PNG assets are placed by PaletteIQ after AI Vision analysis.',
    'Layout mode: ' + compact(s.layoutMode) + '; selected generation scope: ' + compact(s.scope) + '; thumbnail concept: ' + compact(s.slide) + '.',
    'Exact main title: ' + JSON.stringify(compact(s.headline, 100)) + '; exact subtitle: ' + JSON.stringify(compact(s.subtitle, 140)) + '.',
    'Typography mode: ' + s.typography + '; design boldness: ' + compact(s.boldness) + '.',
    'Clipart size hierarchy (layout instructions only): ' + compact(s.hierarchy) + '.',
    'Cover art style: ' + compact(s.coverStyle) + '; watercolor/paper background treatment: ' + compact(s.backgroundStyle) + '.',
    'Decoration intensity: ' + compact(s.intensity) + '; image quality: ' + compact(s.quality) + '.',
    'Reference: ' + (s.hasReference ? 'uploaded/selected; interpretation ' + compact(s.referenceInterpretation) : 'none; use selected cover style') + '.',
    'Reference analysis provider/model: ' + compact(s.analysisProvider) + ' / ' + compact(s.analysisModel) + '; image generation model: ' + compact(s.imageModel) + '.',
    'Collection visual style for NONFIGURATIVE design only: ' + compact(s.collectionStyle, 180) + '.',
    'Collection color palette for abstract decoration only: ' + compact(s.collectionPalette, 180) + '.',
    'Collection texture for abstract background only: ' + compact(s.collectionTexture, 180) + '.',
    'Keep title and subtitle readable. Leave perimeter suitable for original asset placement, with a mixture of large, medium and small objects; object overlap is handled only by the compositor.',
    'STRICTLY FORBIDDEN: generate, redraw, imitate, stylize or recreate any clipart, character, food, animal, plant, product, icon, standalone illustration, photo, or artwork from the collection or reference image.',
    'Do not add invented product quantities, DPI, licensing claims, or unrelated words.'
  ].join('\n');
}
