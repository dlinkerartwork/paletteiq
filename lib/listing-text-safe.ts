/** Text-safe geometry for Etsy Listing Image Studio (all coordinates are percent). 
 * Generated title/subtitle always remain in a protected top band; product PNGs
 * are never flattened into the background or redrawn.
 */
import type { ListingPlacement } from './etsy-listing-image-plan';

export const LISTING_TEXT_SAFE_BOTTOM = 36;
export const LISTING_TEXT_PADDING = 2;
const ceil = LISTING_TEXT_SAFE_BOTTOM + LISTING_TEXT_PADDING;
const finite = (n: number) => typeof n === 'number' && Number.isFinite(n);

/** Width/height indicate a containing rectangle. The renderer preserves PNG aspect ratio. */
export function isListingPlacementTextSafe(p: ListingPlacement, textBottom = ceil): boolean {
  return Boolean(p) && [p.x,p.y,p.width,p.height,p.rotation ?? 0].every(finite) &&
    p.width > 0 && p.height > 0 && p.x >= 0 && p.y >= textBottom &&
    p.x+p.width <= 100 && p.y+p.height <= 100 &&
    Math.abs(p.rotation || 0) <= 15;
}

/** Automatically rescales original slots below all typography; the clipart pixels stay unchanged.
 * Rotation is normalized so the allowed boxes cannot rotate back over the text band.
 * Dense galleries are fitted as one band instead of losing any distinctive asset.
 */
export function fitListingPlacementsBelowText(placements: ListingPlacement[], textBottom = ceil): ListingPlacement[] {
  if (!placements.length) return [];
  const top = Math.min(65, Math.max(ceil, textBottom));
  // Existing mockup layouts and manually edited safe positions must not drift.
  if (placements.every(p => isListingPlacementTextSafe(p,top))) return placements.map(p => ({...p}));
  const available = 99 - top;
  const minY = Math.min(...placements.map(p => p.y));
  const maxBottom = Math.max(...placements.map(p => p.y+p.height));
  const span = Math.max(1, maxBottom-minY);
  const scale = Math.min(1, available/span);
  const fitted = placements.map(p => {
    const width = Math.max(.5, Math.min(p.width,99));
    const height = Math.max(.5,p.height*scale);
    const y = Math.max(top, Math.min(99-height,top+(p.y-minY)*scale));
    const x = Math.max(.5, Math.min(99-width,p.x));
    return { ...p,x,y,width,height,rotation:0 };
  });
  // Strict safety: impossible/invalid input should never be silently approved.
  return fitted.every(p => isListingPlacementTextSafe(p,top)) ? fitted : [];
}

export function duplicateListingAssetIds(placements: ListingPlacement[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const p of placements) {
    if (seen.has(p.assetId)) duplicates.push(p.assetId);
    seen.add(p.assetId);
  }
  return duplicates;
}
