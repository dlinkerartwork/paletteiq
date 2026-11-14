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
};

/** Editable instructions sent to multimodal Vision, not to image generation. */
export function aiFirstConceptPrompt(input: CreativeInput): string {
  return [
    'Act as an exceptional Etsy creative director designing an original premium 1024×1024 digital clipart bundle cover.',
    'The numbered reference boards contain EXCLUSIVELY original collection artwork, each number identifying an existing source PNG. They are NOT a canvas and provide NO composition coordinates, scale or order.',
    'Use these references to DIRECT a complete cohesive design. You choose which ORIGINAL objects to feature and how many, as well as the typography, background, colors, layout, scale variation, rotation, organic grouping and negative space. No mandatory font, font family, position, object count, focal count or grid.',
    'Design with authentic artwork as the only figurative content. No new animals, flowers, clipart, accessories, character variations, regenerated objects or artificial substitutes are allowed.',
    'Compose with strong artistic hierarchy and creative freedom. Let title, subtitle and badge stay readable at Etsy search size; arrange large and small objects around—not over—the lettering. Natural rotations and tasteful asset repetition are welcome when they improve the cover.',
    'EXACT MAIN TITLE: ' + JSON.stringify(input.title),
    'EXACT SUBTITLE: ' + JSON.stringify(input.subtitle),
    'EXACT BADGE: ' + JSON.stringify(input.badge),
    'Collection theme: ' + JSON.stringify(input.theme),
    'Collection includes ' + input.selectedCount + ' eligible originals (a representative subset may be visible in the reference boards). Choose a compelling selection without a prescribed count.',
    input.revisionNotes?.trim() ? 'User creative direction: ' + JSON.stringify(input.revisionNotes.trim().slice(0,700)) : '',
    'Return a JSON-only ART DIRECTION, not an image. Include "creativeBrief": concise actionable description of the artistic hierarchy, cohesive background and lettering, and intended original-art placement; include "chosenIndices": numbered reference-board indices for the original PNGs you want on the cover. You may select any number of referenced originals, but do not fabricate indices. Never draw or propose new clipart.'
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
