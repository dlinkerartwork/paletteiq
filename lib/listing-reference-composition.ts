import type { ListingPlacement } from './etsy-listing-image-plan';
import { fitListingPlacementsBelowText, isListingPlacementTextSafe } from './listing-text-safe';

export type ReferenceRectangle = { x: number; y: number; width: number; height: number; rotation?: number };
export type ListingReferenceLayout = {
  slots?: ReferenceRectangle[];
  texts?: Array<ReferenceRectangle & { text?: string }>;
  compositionGuide?: string;
  graphicMotif?: string;
  letteringStyle?: string;
  paletteMood?: string;
};

export type ListingTextZone = { x: number; y: number; width: number; height: number };

const finite = (n: number) => typeof n === 'number' && Number.isFinite(n);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi,n));

/** A reference-driven hero protects the middle, not the top of the page.
 * Gallery/catalogue/mockup slides retain the stricter top-band fitting.
 */
export function isCentralHero(number: number, hasReference: boolean): boolean {
  return (number === 1 || number === 15) && hasReference;
}

export function heroTextZone(layout?: ListingReferenceLayout): ListingTextZone {
  // The protected center must leave practical perimeter bands on ALL FOUR sides.
  // Reference text-box heights are often exaggerated by decorative badges;
  // do not let an expansive vision union consume the bottom product-art band.
  const boxes = (layout?.texts || []).filter(t =>
    [t.x,t.y,t.width,t.height].every(finite) && t.width > 0 && t.height > 0);
  const centerAligned = boxes.length && boxes.some(t => {
    const cx=t.x+t.width/2, cy=t.y+t.height/2;
    return cx >= 34 && cx <= 66 && cy >= 28 && cy <= 75;
  });
  // Whether the input is central or just a noisy estimate, keep the cover's
  // central title lockup inside a fixed, reference-inspired safe region.
  return centerAligned ? {x:25,y:23,width:50,height:55} : {x:25,y:24,width:50,height:54};
}

const intersects = (a: ListingTextZone, b: ListingTextZone) =>
  a.x < b.x+b.width && a.x+a.width > b.x &&
  a.y < b.y+b.height && a.y+a.height > b.y;

export function isListingPlacementSafe(
  placement: ListingPlacement, number: number, hasReference: boolean,
  layout?: ListingReferenceLayout, zoneOverride?: ListingTextZone
): boolean {
  if (!isCentralHero(number,hasReference)) return isListingPlacementTextSafe(placement);
  const p = placement;
  if (![p.x,p.y,p.width,p.height,p.rotation ?? 0].every(finite) ||
    p.width <= 0 || p.height <= 0 || Math.abs(p.rotation || 0) > 15) return false;
  const radians = (p.rotation || 0) * Math.PI/180;
  const rotatedW = Math.abs(p.width*Math.cos(radians))+Math.abs(p.height*Math.sin(radians));
  const rotatedH = Math.abs(p.height*Math.cos(radians))+Math.abs(p.width*Math.sin(radians));
  const rect = { x:p.x+(p.width-rotatedW)/2,y:p.y+(p.height-rotatedH)/2,
    width:rotatedW,height:rotatedH };
  const protectedZone = zoneOverride || heroTextZone(layout);
  return rect.x >= 0 && rect.y >= 0 && rect.x+rect.width <= 100 &&
    rect.y+rect.height <= 100 && !intersects(rect,protectedZone);
}

const perimeter: ListingTextZone[] = [
  {x:1,y:1,width:31,height:19},{x:35,y:1,width:30,height:19},{x:68,y:1,width:31,height:19},
  {x:1,y:25,width:22,height:25},{x:77,y:25,width:22,height:25},
  {x:1,y:53,width:22,height:25},{x:77,y:53,width:22,height:25},
  {x:1,y:81,width:31,height:18},{x:35,y:81,width:30,height:18},{x:68,y:81,width:31,height:18}
];

/** Place real PNG rectangles around a central reference-derived title area.
 * A deterministic fallback is safer than forcing a collage through the text.
 * Alternate sizes are intentional: the current "all small thumbnails" effect is avoided.
 */
export function fitListingPlacementsToReference(
  number: number, originals: ListingPlacement[], hasReference: boolean,
  layout?: ListingReferenceLayout
): ListingPlacement[] {
  if (!isCentralHero(number,hasReference)) return fitListingPlacementsBelowText(originals);
  if (!originals.length) return [];
  if (originals.every(p => isListingPlacementSafe(p,number,hasReference,layout))) return originals.map(p=>({...p}));
  // Dynamic reference slots only apply if they do not collide with the title.
  const referenceSlots = (layout?.slots || []).filter(slot =>
    [slot.x,slot.y,slot.width,slot.height].every(finite) &&
    slot.width > 2 && slot.height > 2).map(slot =>
    ({x:slot.x,y:slot.y,width:slot.width,height:slot.height}));
  const available = referenceSlots.length >= originals.length &&
    referenceSlots.slice(0,originals.length).every((slot,i) =>
      isListingPlacementSafe({ ...originals[i],...slot,rotation:0 },number,hasReference,layout))
      ? referenceSlots : perimeter;
  const result: ListingPlacement[] = originals.map((p,i) => {
    const slot = available[i % available.length];
    const duplicatePass = Math.floor(i/available.length);
    const shrink = duplicatePass ? Math.pow(.75,duplicatePass) : 1;
    const width = slot.width*shrink,height=slot.height*shrink;
    return { ...p, x:slot.x+(slot.width-width)/2,y:slot.y+(slot.height-height)/2,
      width,height,rotation:0 };
  });
  return result.every(p => isListingPlacementSafe(p,number,hasReference,layout)) ? result : [];
}
