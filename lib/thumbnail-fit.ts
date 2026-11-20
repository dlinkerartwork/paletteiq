/**
 * Deterministic, browser/server-safe geometry fitting for exact collection PNG layers.
 * All geometry is in 0..100 canvas percentages, not pixels.
 * Never regenerate, crop or distort the underlying collection artwork.
 */
export type ThumbnailBox = { x: number; y: number; width: number; height: number };
export type ThumbnailPlacement = ThumbnailBox & { rotation?: number; characterId?: string };
export type FitOptions = { titlePadding?: number; subtitlePadding?: number; maxArtworkOverlap?: number; grid?: boolean; minScale?: number };
const finite = (n: number) => typeof n === 'number' && Number.isFinite(n);
export function validThumbnailBox(box: unknown): box is ThumbnailBox {
  if (!box || typeof box !== 'object') return false;
  const z = box as ThumbnailBox;
  return [z.x,z.y,z.width,z.height].every(finite) && z.x >= 0 && z.y >= 0 &&
    z.width > 0 && z.height > 0 && z.x+z.width <= 100 && z.y+z.height <= 100;
}
export function rotatedThumbnailBounds(box: ThumbnailPlacement): ThumbnailBox {
  const radians = Math.abs((box.rotation || 0) * Math.PI / 180);
  const w = box.width * Math.cos(radians) + box.height * Math.sin(radians);
  const h = box.width * Math.sin(radians) + box.height * Math.cos(radians);
  return { x:box.x+(box.width-w)/2, y:box.y+(box.height-h)/2, width:w, height:h };
}
export function boxesIntersect(a: ThumbnailBox, b: ThumbnailBox, padding = 0): boolean {
  return a.x < b.x+b.width+padding && a.x+a.width+padding > b.x &&
    a.y < b.y+b.height+padding && a.y+a.height+padding > b.y;
}
export function boxOverlapRatio(a: ThumbnailBox,b: ThumbnailBox): number {
  const w = Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
  const h = Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  return w*h/Math.max(0.0001,Math.min(a.width*a.height,b.width*b.height));
}
const within = (box: ThumbnailBox) => box.x >= 1 && box.y >= 1 && box.x+box.width <= 99 && box.y+box.height <= 99;

/** Fit Vision's proposed positions around the actual detected text areas.
 * Translate first; scale uniformly only when necessary. Never return a layer
 * over protected text. Grid slides do not allow layering over other products.
 */
export function fitClipartAroundTypography<T extends ThumbnailPlacement>(
  originals: T[], titleZones: ThumbnailBox[], subtitleZones: ThumbnailBox[] = [], options: FitOptions = {}
): T[] {
  const protectedAreas = [
    ...titleZones.filter(validThumbnailBox).map(zone => ({ zone, padding: options.titlePadding ?? 4 })),
    ...subtitleZones.filter(validThumbnailBox).map(zone => ({ zone, padding: options.subtitlePadding ?? 3 }))
  ];
  const placed: T[] = [];
  const overlapLimit = options.grid ? 0 : Math.max(0,Math.min(.5,options.maxArtworkOverlap ?? .3));
  const minimumScale = Math.max(.45,Math.min(1,options.minScale ?? .68));
  const eligible = (candidate: T) => {
    const bounds = rotatedThumbnailBounds(candidate);
    if (!within(bounds)) return false;
    if (protectedAreas.some(({zone,padding}) => boxesIntersect(bounds,zone,padding))) return false;
    return placed.every(other => boxOverlapRatio(bounds,rotatedThumbnailBounds(other)) <= overlapLimit);
  };
  for (const original of originals) {
    if (!validThumbnailBox(original)) continue;
    const scales = [1,.96,.92,.88,.84,.8,.76,.72,.68,.64,.6,.56,.52,.48].filter(v => v >= minimumScale-0.0001);
    let best: T | undefined;
    for (const scale of scales) {
      const width=original.width*scale, height=original.height*scale;
      const anchorX=original.x+(original.width-width)/2;
      const anchorY=original.y+(original.height-height)/2;
      const search: Array<[number,number]> = [[0,0]];
      // Nearest-first translation preserves the art-director's intended hierarchy.
      for (const radius of [3,6,9,12,16,21,28,36,44,55,70]) {
        for (let angle=0;angle<16;angle++) {
          const theta=angle*Math.PI/8;
          search.push([Math.cos(theta)*radius,Math.sin(theta)*radius]);
        }
      }
      for (const [dx,dy] of search) {
        const candidate = {...original,x:anchorX+dx,y:anchorY+dy,width,height} as T;
        if (eligible(candidate)) { best=candidate; break; }
      }
      if (best) break;
    }
    // Important: never re-add an unsafe original position when fitting fails.
    // Other collection assets remain available for manual placement.
    if (best) placed.push(best);
  }
  return placed;
}
