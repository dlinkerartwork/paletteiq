/**
 * AI-First thumbnail design. Contact sheets are source-asset INDEXES, not
 * layouts. Vision sees the real collection; image generation NEVER draws
 * product illustrations. Final assets are composited from original PNG bytes.
 */
export const AI_FIRST_MAX_REFERENCE_SHEETS = 8;
export const AI_FIRST_ASSETS_PER_SHEET = 24;
export const AI_FIRST_MAX_REFERENCE_ASSETS = AI_FIRST_MAX_REFERENCE_SHEETS * AI_FIRST_ASSETS_PER_SHEET;

export function aiFirstSampleIndices(total: number, max = AI_FIRST_MAX_REFERENCE_ASSETS): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(max) || max < 1) return [];
  const count = Math.min(total, max);
  if (count === total) return Array.from({length:total},(_,i)=>i);
  return Array.from({length:count},(_,i)=>Math.floor((i+0.5)*total/count));
}
type CreativeInput = {
  theme: string; title: string; subtitle: string; badge: string;
  selectedCount: number; revisionNotes?: string;
  style?: string; palette?: string; texture?: string;
  sourceAssets?: Array<{ name: string; category?: string }>;
};

/** Keep the user's successful Etsy prompt structure; adapt only real source facts. */
export function aiFirstConceptPrompt(input: CreativeInput): string {
  const examples=(input.sourceAssets||[]).slice(0,32)
    .map(x=>[x.name,x.category].filter(Boolean).join(' — '));
  return [
    'Create a stunning, premium-quality Etsy digital clipart bundle thumbnail with a beautifully balanced, artistic, and visually engaging composition.',
    '',
    '**CANVAS**',
    '- Square format, 1024 × 1024 pixels.',
    '- Design a clean, theme-matched background with subtle, tasteful texture.',
    '- Avoid distracting backgrounds, heavy patterns or decorative frames unless they significantly improve the composition.',
    '',
    '**ARTWORK & COMPOSITION**',
    'Create a rich, abundant collage featuring original illustrations from the supplied '+JSON.stringify(input.theme)+' collection.',
    'Approximately 18–25 illustrations can work well when the selection supports it, but use more or fewer whenever the composition benefits. There is no fixed number of objects.',
    'Use a variety of ACTUAL supplied original assets. Source artwork is represented visually by numbered reference images; they are equivalent to the contents of a collection ZIP, not pre-arranged canvas objects.',
    examples.length ? 'Examples of the actual available illustrations (not mandatory to include all): '+examples.join('; ') : '',
    '- Arrange illustrations organically around and between the typography, creating a rich but harmonious composition.',
    '- Use dramatically varied object sizes. Feature compelling visual anchors when suitable; support them with medium and miniature original assets.',
    '- Distribute objects across the canvas including corners and edges; allow creative positioning, rotation, scaling and asymmetry.',
    '- Create visual depth and rhythm through intentional variation.',
    '- Avoid uniform grids, repetitive spacing, awkward overlaps, overcrowding, obscured characters and excessive empty space.',
    '- Make the composition feel like an expertly art-directed commercial illustration collage.',
    '',
    '**TYPOGRAPHY**',
    'Include the following exact text:',
    'Main title: '+JSON.stringify(input.title),
    'Subtitle: '+JSON.stringify(input.subtitle),
    'Badge: '+JSON.stringify(input.badge)+' (leave out if empty).',
    'Create beautiful, professional, artistic typography with a strong hierarchy.',
    '- Choose complementary title colors and expressive lettering appropriate to the actual source theme.',
    '- Make subtitle smaller and refined as aesthetically appropriate; integrate any badge tastefully.',
    '- Keep all typography proportional, artistically appealing and clearly readable at small Etsy thumbnail size.',
    '- Integrate text naturally with the original illustrations without covering important letterforms.',
    '- Explore creative typography and lettering without being restricted to particular fonts.',
    '',
    '**ARTISTIC DIRECTION**',
    'Match the actual illustration style of the attached collection, not a fixed Christmas/woodland reference.',
    input.style?.trim() ? 'Collection visual style: '+input.style.trim() : '',
    input.palette?.trim() ? 'Collection palette guidance: '+input.palette.trim() : '',
    input.texture?.trim() ? 'Collection texture: '+input.texture.trim() : '',
    'Make the result cohesive, charming, premium and highly appealing to Etsy shoppers. Preserve each original illustration’s distinctive rendering, color, expressions and details.',
    '',
    '**CREATIVE FREEDOM**',
    'Act as an experienced Etsy creative director and commercial thumbnail designer.',
    'You have full freedom to determine the best positions, sizes, rotations, visual hierarchy, spacing, text styling and relationships between original objects and typography.',
    'Prioritize beauty, artistic composition, readability, visual richness and strong thumbnail appeal.',
    'Make the result professionally designed, not mechanically assembled.',
    '',
    '**FINAL QUALITY**',
    'A polished premium Etsy listing cover with abundant original clipart, beautifully varied illustration sizes, balanced artistic typography, a harmonious background, and strong visual impact at 128px thumbnail size.',
    '',
    '**SOURCE CLIPART REQUIREMENTS**',
    'Use the supplied clipart collection as the EXCLUSIVE source for all illustrated characters and objects.',
    'Preserve original characters, artistic styles, colors, expressions, clothing, accessories and recognizable details.',
    'Do not invent unrelated clipart or replace supplied characters with newly imagined variations.',
    'You may select any number of actual source assets, resize, rotate, position and repeat EXISTING source PNGs where artistically appropriate. No fixed grid or mandatory size uniformity.',
    'Treat originals as flexible independent illustrations, not an existing design to preserve.',
    'Original PNG pixels must remain exact in the final composite. DO NOT redraw, imitate or regenerate source artwork.',
    'The numbered contact sheets are visual previews of the same originals that PaletteIQ packages as a user-downloadable ZIP. ZIP is NOT itself a visual model input. Never assume position/size from contact-sheet cells.',
    input.revisionNotes?.trim() ? '**ADDITIONAL USER REQUEST**: '+input.revisionNotes.trim().slice(0,800) : '',
    '',
    '**TECHNICAL AI ART DIRECTION OUTPUT**',
    'Do NOT render a new image in this Vision step. Instead return JSON with "chosenIndices" (1-based numbers of REAL referenced originals) and "creativeBrief" (a cohesive premium visual art direction).',
    'Choose any count of real referenced objects, never fabricate asset indices. A separate image model will generate only the background and lettering; PaletteIQ will composite the exact original PNGs.',
  ].filter(Boolean).join('\n');
}

/** This is the ONLY prompt allowed to reach the image generation endpoint. */
export function aiFirstBackgroundPrompt(input: {
  userDirection: string; creativeBrief: string; title: string; subtitle: string; badge: string;
}): string {
  return [
    'Create a 1024×1024 square premium Etsy thumbnail BACKGROUND AND ARTISTIC TYPOGRAPHY ONLY.',
    'ABSOLUTE PRODUCT ARTWORK RULE: DO NOT draw, recreate, trace, hallucinate, regenerate, imitate or include ANY standalone illustrated clipart, character, animal, flower, plant, ornament, object, icon, silhouette, sticker, or placeholder art. All such PNG illustrations will be placed separately by PaletteIQ from their ORIGINAL collection image files.',
    'You are free to creatively design the typography and nonfigurative graphic background, with no required font, font size, text position, background style or color recipe.',
    'Use the following creative-director brief (informed by the authentic source clipart): ' + input.creativeBrief,
    'Treat the original user prompt as ART DIRECTION, not permission to generate the described illustrative objects. Render the actual clipart subjects ZERO times. USER ART DIRECTION: ' + JSON.stringify(input.userDirection.slice(0,10000)),
    'Include EXACT MAIN TITLE: ' + JSON.stringify(input.title),
    'Include EXACT SUBTITLE: ' + JSON.stringify(input.subtitle),
    'Include EXACT BADGE (empty means omit): ' + JSON.stringify(input.badge),
    'Render no extra words. Arrange the writing intentionally and leave room around it for a freely composed collage of original PNG images. No artwork may overlap the complete word shapes.',
    'Only lettering, nonfigurative shapes, abstract color and texture are allowed. Return a SINGLE square illustration-free background image.'
  ].join('\n');
}
