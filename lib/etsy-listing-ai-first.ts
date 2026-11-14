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
    'The selected clipart are VISUAL REFERENCES for the image model to integrate creatively into ONE finished thumbnail. Stay as faithful as possible to the original artwork, recognizable subjects, colors, expressions and details. A generative image model may reinterpret or redraw them; pixel-exact copying is not guaranteed.',
    'The numbered contact sheets are visual previews of the same originals that PaletteIQ packages as a user-downloadable ZIP. ZIP is NOT itself a visual model input. Never assume position/size from contact-sheet cells.',
    input.revisionNotes?.trim() ? '**ADDITIONAL USER REQUEST**: '+input.revisionNotes.trim().slice(0,800) : '',
    '',
    '**FINAL IMAGE GENERATION**',
    'Generate the complete finished 1024 × 1024 Etsy cover directly as ONE cohesive image: illustrated collage, artistic typography, background and badge together. This is NOT a layout JSON request, an empty typography plate or a contact sheet.',
    'The attached visual reference boards are an unordered collection of artwork; numbers and cell boundaries are for identification only. Ignore the source board geometry. Select and arrange elements freely, with dramatically varied scale and attractive spacing.',
    'Use only objects depicted in the reference boards as the visual subject vocabulary; do not add unrelated characters or falsely claim more available items than the collection contains.',
    'Maintain exact wording for title, subtitle and badge. Make all lettering readable at Etsy search thumbnail size.',
  ].filter(Boolean).join('\n');
}

