/** Applied at generation time, including to prompts saved before originality rules existed. */
export const normalizeSimilarityLimit = (value: unknown): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100 ? value : 80;

/** A creative target for the advisory review, never a guaranteed numeric outcome. */
export const similarityOriginalityGuidance = (maximumPercent: number): string =>
  'SIMILARITY TARGET: Aim for an estimated visual similarity score of no more than ' +
  normalizeSimilarityLimit(maximumPercent) +
  '% relative to the Etsy source references. Preserve only the general visual style DNA ' +
  '(medium, palette, texture, lighting and intended theme); independently design anatomy, ' +
  'pose, silhouette, expression, accessories, composition and detail placement. ' +
  'Avoid recognizably copying source character designs and arrangements. ' +
  'This percentage is an advisory creative target, not a measurable guarantee; ' +
  'the generated image must still pass a separate visual review.';

export const originalImagePrompt = (prompt: string, characterId: string, variation = '', maximumPercent = 80) => {
  const creativeSeed = [...(characterId + variation)].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 17);
  const views = ['a gentle three-quarter angle', 'a natural side-facing pose', 'a dynamic diagonal arrangement', 'an expressive front-facing pose'];
  const details = ['a distinct silhouette and asymmetric accent details', 'fresh proportions and a different focal detail', 'an inventive pose with independently arranged elements', 'a new arrangement of features and decorative accents'];
  return `${prompt.trim()}\n\n${similarityOriginalityGuidance(maximumPercent)}\n\nORIGINALITY REQUIREMENT — HIGH PRIORITY: The Etsy listing and its artwork are inspiration for broad subject/category and medium only, NOT designs to reproduce. Create a new, independent illustration with original composition, proportions, silhouette, pose, visual arrangement, specific details, and decorative elements. Do not recreate or trace a reference, copy its exact flower/petal/face configuration, distinctive accessory, layout, or recognizable combination of elements. Keep the requested subject and broad watercolor/clipart style, but make the result unmistakably different from any source listing image. Deliberately use ${views[creativeSeed % views.length]} with ${details[(creativeSeed >>> 4) % details.length]}. Never include a reference image or its mockup as output. If the original prompt specifies a reference-identical pose/layout, override that instruction with an original alternative.`;
};
