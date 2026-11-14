/**
 * AI-First cover: asset reference boards are a visual stand-in for a ZIP.
 * They contain only original collection thumbnails, NEVER canvas coordinates.
 * No source image is rendered into the deliverable by an image model.
 */
export const AI_FIRST_MAX_REFERENCE_SHEETS = 8;
export const AI_FIRST_ASSETS_PER_SHEET = 24;
export const AI_FIRST_MAX_REFERENCE_ASSETS = AI_FIRST_MAX_REFERENCE_SHEETS * AI_FIRST_ASSETS_PER_SHEET;

export function aiFirstSampleIndices(total: number, max = AI_FIRST_MAX_REFERENCE_ASSETS): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(max) || max < 1) return [];
  const count = Math.min(total, max);
  if (count === total) return Array.from({ length: total }, (_, i) => i);
  // Uniform coverage of the entire collection; no early-prefix bias.
  return Array.from({ length: count }, (_, i) => Math.floor((i + 0.5) * total / count));
}

type CreativeInput = {
  theme: string; title: string; subtitle: string; badge: string;
  selectedCount: number; revisionNotes?: string;
};

export function aiFirstConceptPrompt(input: CreativeInput): string {
  return [
    'You are the sole creative director designing an outstanding square 1024×1024 Etsy clipart bundle thumbnail.',
    'The attached numbered image boards show ACTUAL selected source artwork from one collection. They are a sample of individual PNG illustrations, NOT a canvas, collage to reproduce, or pre-existing placement layout.',
    'Design a FULL premium thumbnail CONCEPT in one cohesive creative pass, including imaginative typography, background, color and an art-directed collage using the visual reference objects as inspiration.',
    'You have complete freedom to invent the layout, font selection, styling, scale hierarchy, grouping, rotation, asymmetry, decorative treatments and text position. No prescribed grid, fonts, hero count or edge-only arrangement.',
    'The final deliverable will use exact original PNG assets from the PaletteIQ collection. Your illustrated subjects in this concept are temporary PLACEHOLDERS for visual planning, never approved sellable art. Do not invent unrelated subjects or draw additional product characters.',
    'Make an engaging, balanced composition without crowded typography: all complete title, subtitle and badge words must remain readable and have enough breathing room. Text must not be obscured by flowers, animals, leaves or other clipart.',
    'Render these words exactly, without additions:',
    'MAIN TITLE: ' + JSON.stringify(input.title),
    'SUBTITLE: ' + JSON.stringify(input.subtitle),
    'BADGE (empty means do not draw one): ' + JSON.stringify(input.badge),
    'Collection theme: ' + JSON.stringify(input.theme),
    'Original collection contains ' + input.selectedCount + ' selected source illustrations. Represent a beautiful editorial selection of their visual vocabulary; more originals can be arranged in the exact-asset final composite.',
    input.revisionNotes?.trim() ? 'User artistic direction: ' + JSON.stringify(input.revisionNotes.trim().slice(0, 700)) : '',
    'Return ONE finished-looking 1024×1024 full-cover concept image; do not return a JSON layout, a reference grid, or a contact sheet.'
  ].filter(Boolean).join('\n');
}

export function aiFirstCleanPlatePrompt(title: string, subtitle: string, badge: string): string {
  return [
    'Edit this square Etsy thumbnail concept into a CLEAN BACKGROUND AND TYPOGRAPHY PLATE for exact PNG compositing.',
    'Keep the overall background design, artistic typography, colors, word positions and visual hierarchy as faithful to the supplied concept as possible.',
    'REMOVE EVERY standalone illustrated clipart object, character, flower, plant, animal, product illustration and their shadows from the entire image, reconstructing the clean background beneath them.',
    'Remove all temporary illustrated objects even when they cross letters; restore any obscured letters so the entire original wording becomes completely readable.',
    'Preserve these exact requested words with no extras:',
    'MAIN TITLE: ' + JSON.stringify(title),
    'SUBTITLE: ' + JSON.stringify(subtitle),
    'BADGE: ' + JSON.stringify(badge),
    'Do not add replacement illustrations, silhouettes, ghosts, faded subjects or cutouts. PaletteIQ will paste the ORIGINAL collection PNGs after this step.',
    'Nonfigurative texture, color washes, hand-created lettering and abstract graphic accents are permitted. Return exactly one square image.'
  ].join('\n');
}
