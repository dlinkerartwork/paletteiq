import type { ListingPlacement } from './etsy-listing-image-plan.ts';
import { fitListingPlacementsBelowText, isListingPlacementTextSafe } from './listing-text-safe.ts';

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
const finite = (n:number) => Number.isFinite(n);
const clamp = (n:number, lo:number, hi:number) => Math.max(lo,Math.min(hi,n));

/** Kept as a legacy mode indicator. A selected reference is no longer assumed
 * to have a centered title, including for cover 01 and closing cover 15. */
export function isCentralHero(number:number, hasReference:boolean):boolean {
  return (number===1 || number===15) && hasReference;
}

function validBox(box: ReferenceRectangle):boolean {
  return Boolean(box) && [box.x,box.y,box.width,box.height].every(finite) &&
    box.width>0 && box.height>0 && box.x>=0 && box.y>=0 &&
    box.x+box.width<=100 && box.y+box.height<=100;
}

/** Text protection follows the detected wording, not a hard-coded center/top
 * location. If the reference contains several text elements, each is protected
 * independently so blank space between them can still hold original artwork. */
export function referenceTextZones(layout?:ListingReferenceLayout, padding=2):ListingTextZone[] {
  return (layout?.texts || []).filter(validBox).slice(0,16).map(box=>({
    x:clamp(box.x-padding,0,100), y:clamp(box.y-padding,0,100),
    width:clamp(box.width+2*padding,1,100-clamp(box.x-padding,0,100)),
    height:clamp(box.height+2*padding,1,100-clamp(box.y-padding,0,100))
  }));
}

/** Compatibility helper for the server's single-zone persistence.
 * Derives a bounding union of reference text if present. Empty means no
 * detected reference typography—not a conjectured central medallion. */
export function heroTextZone(layout?:ListingReferenceLayout):ListingTextZone {
  const zones=referenceTextZones(layout);
  if (!zones.length) return {x:0,y:0,width:100,height:38};
  const left=Math.min(...zones.map(z=>z.x)), top=Math.min(...zones.map(z=>z.y));
  const right=Math.max(...zones.map(z=>z.x+z.width)), bottom=Math.max(...zones.map(z=>z.y+z.height));
  return {x:left,y:top,width:right-left,height:bottom-top};
}
const intersects=(a:ListingTextZone,b:ListingTextZone)=> a.x<b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y;

function rotatedBounds(p:ListingPlacement):ListingTextZone | null {
  if (!p || ![p.x,p.y,p.width,p.height,p.rotation??0].every(finite) ||
    p.width<=0 || p.height<=0 || Math.abs(p.rotation||0)>15) return null;
  const rad=(p.rotation||0)*Math.PI/180;
  const width=Math.abs(p.width*Math.cos(rad))+Math.abs(p.height*Math.sin(rad));
  const height=Math.abs(p.height*Math.cos(rad))+Math.abs(p.width*Math.sin(rad));
  return {x:p.x+(p.width-width)/2,y:p.y+(p.height-height)/2,width,height};
}

export function isListingPlacementSafe(
  placement:ListingPlacement, number:number, hasReference:boolean,
  layout?:ListingReferenceLayout, zoneOverride?:ListingTextZone
):boolean {
  if (!hasReference) return isListingPlacementTextSafe(placement);
  const bounds=rotatedBounds(placement);
  if (!bounds || bounds.x<0 || bounds.y<0 ||
      bounds.x+bounds.width>100 || bounds.y+bounds.height>100) return false;
  const zones=referenceTextZones(layout);
  // For a persisted render with no available source layout, use the saved zone.
  if (!zones.length && zoneOverride) zones.push(zoneOverride);
  // A missing reference analysis is NOT evidence of central typography.
  if (!zones.length) zones.push({x:0,y:0,width:100,height:38});
  return zones.every(zone=>!intersects(bounds,zone));
}

function acceptAtSlot(original:ListingPlacement, slot:ListingTextZone,
  number:number, layout:ListingReferenceLayout):ListingPlacement|null {
  const p={...original,x:slot.x,y:slot.y,width:slot.width,height:slot.height,rotation:0};
  return isListingPlacementSafe(p,number,true,layout) ? p : null;
}

/** Follow the reference image's actual slots, title position and size rhythm.
 * No pre-selected title orientation or 'perimeter-only' layout exists.
 * When slots are inadequate, choose remaining free tiles around the detected
 * text zones without recreating or duplicating source assets.
 */
export function fitListingPlacementsToReference(
  number:number, originals:ListingPlacement[], hasReference:boolean,
  layout?:ListingReferenceLayout
):ListingPlacement[] {
  if (!hasReference) return fitListingPlacementsBelowText(originals);
  if (!originals.length) return [];
  if (originals.every(p=>isListingPlacementSafe(p,number,true,layout)))
    return originals.map(p=>({...p}));

  const output:ListingPlacement[]=[];
  const rawSlots=(layout?.slots||[]).filter(validBox);
  const used=new Set<number>();
  for (const original of originals) {
    let chosen:ListingPlacement|null=null;
    for (let i=0;i<rawSlots.length;i++) {
      if (used.has(i)) continue;
      chosen=acceptAtSlot(original,rawSlots[i],number,layout||{});
      if (chosen) {used.add(i);break;}
    }
    if (chosen) output.push(chosen);
    else break;
  }
  if (output.length===originals.length) return output;

  const remaining=originals.slice(output.length);
  const slots:ListingTextZone[]=[];
  // Generate small tiles across the entire artwork canvas, excluding detected
  // typography. No specific quadrant, ring, or top/bottom is preferred.
  const cols=Math.max(4,Math.min(12,Math.ceil(Math.sqrt(originals.length*1.8))));
  const cell=100/cols;
  for(let y=0;y<=100-cell;y+=cell) for(let x=0;x<=100-cell;x+=cell) {
    const slot={x:x+.5,y:y+.5,width:cell-1,height:cell-1};
    if (!referenceTextZones(layout).some(z=>intersects(slot,z)) &&
        acceptAtSlot(originals[0],slot,number,layout||{})) slots.push(slot);
  }
  // Larger visual items follow the reference slots when possible; tiles are
  // just a safe fallback. Never silently drop any selected asset.
  if(slots.length<remaining.length) return [];
  for(let i=0;i<remaining.length;i++) {
    const slot=slots[i];
    const candidate=acceptAtSlot(remaining[i],slot,number,layout||{});
    if(!candidate) return [];
    output.push(candidate);
  }
  return output;
}
