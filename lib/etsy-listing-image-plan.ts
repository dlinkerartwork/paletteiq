export const LISTING_WIDTH = 3000;
export const LISTING_HEIGHT = 2250;

export const LISTING_IMAGE_SPECS = [
  { number: 1, key: 'Main_Cover', title: 'Main Cover', headline: 'The Clipart Collection', purpose: 'Hero cover with standout original artwork', kind: 'gallery' },
  { number: 2, key: 'Bundle_Overview', title: 'Bundle Overview', headline: 'Explore the Bundle', purpose: 'See every available illustration', kind: 'all' },
  { number: 3, key: 'Complete_Collection', title: 'Complete Collection', headline: 'The Complete Collection', purpose: 'See the full variety, grouped by theme when available', kind: 'all-grouped' },
  { number: 4, key: 'Best_Elements', title: 'Best Elements', headline: 'Our Favorite Details', purpose: 'Larger illustrations showcasing the highlights', kind: 'gallery' },
  { number: 5, key: 'Collection_Categories', title: 'Collection Categories', headline: 'Meet the Collection', purpose: 'Browse distinct, verified artwork groups', kind: 'categories' },
  { number: 6, key: 'File_Features', title: 'File Features', headline: 'Made for Your Projects', purpose: 'Show only verified digital-product facts', kind: 'detail' },
  { number: 7, key: 'Artwork_Close_Up', title: 'Artwork Close-Up', headline: 'Hand-Painted Details', purpose: 'Inspect original image quality and detail', kind: 'detail' },
  { number: 8, key: 'Sticker_Sheet_Mockup', title: 'Sticker Sheet Mockup', headline: 'Create Lovely Stickers', purpose: 'Original PNG art on a blank sticker sheet', kind: 'mockup' },
  { number: 9, key: 'Apparel_Mockup', title: 'Apparel Mockup', headline: 'Personalize Your Style', purpose: 'Original PNG art printed on blank apparel', kind: 'mockup' },
  { number: 10, key: 'Accessories_Mockup', title: 'Accessories Mockup', headline: 'Everyday Accessories', purpose: 'Original PNG art on a canvas tote', kind: 'mockup' },
  { number: 11, key: 'Packaging_Labels_Mockup', title: 'Packaging & Labels Mockup', headline: 'Beautiful Packaging', purpose: 'Original PNG art on an empty label', kind: 'mockup' },
  { number: 12, key: 'Creative_Projects_Mockup', title: 'Creative Projects Mockup', headline: 'Creative Project Ideas', purpose: 'Original PNG art in a blank scrapbook layout', kind: 'mockup' },
  { number: 13, key: 'Whats_Included', title: "What's Included", headline: "What's Included", purpose: 'Accurately summarize available collection files', kind: 'information' },
  { number: 14, key: 'How_To_Download_And_Use', title: 'How to Download & Use', headline: 'Digital Download Guide', purpose: 'Explain how customers receive digital products', kind: 'information' },
  { number: 15, key: 'Final_Showcase', title: 'Final Bundle Showcase', headline: 'Create Something Wonderful', purpose: 'Premium closing gallery of original clipart', kind: 'gallery' },
] as const;

export type ListingImageNumber = number;
export type ListingImageStatus = 'draft' | 'approved' | 'needs_revision';
export type ListingAsset = { id: string; name: string; imageUrl?: string; category?: string; subtheme?: string; group?: string };
export type ListingPlacement = { assetId: string; x: number; y: number; width: number; height: number; rotation?: number };
export type ListingImageRecord = {
  number: number; status: ListingImageStatus; backgroundUrl?: string; renderedImageUrl?: string;
  placements?: ListingPlacement[]; notes?: string; reviewWarning?: string; updatedAt: number;
};
export type ListingImageKind = typeof LISTING_IMAGE_SPECS[number]['kind'];

export function originalAssets(assets: ListingAsset[]): ListingAsset[] {
  const urls = new Set<string>();
  return assets.filter(asset => {
    if (!asset.id || !asset.imageUrl || urls.has(asset.imageUrl)) return false;
    urls.add(asset.imageUrl);
    return true;
  });
}
export function listingTitle(number: number, name: string): string {
  if (number === 1) return name.trim().replace(/\s+/g, ' ').slice(0, 75) || 'Original Clipart Collection';
  return LISTING_IMAGE_SPECS[number - 1]?.headline || 'Original Clipart Collection';
}
export function listingFilename(number: number): string {
  const spec = LISTING_IMAGE_SPECS[number - 1];
  if (!spec) throw new Error('Invalid listing image number');
  return String(number).padStart(2, '0') + '_' + spec.key + '.jpg';
}
export function listingCategory(asset: ListingAsset): string {
  return (asset.category || asset.group || asset.subtheme || '').trim().slice(0, 50);
}
/**
 * A reproducible, varied selection for the cover, best details and finale.
 * Spread across the collection and saved category groups; don't just display
 * the first 10 entries (which may be near-duplicates of a single subtheme).
 * Genuine visual attractiveness is assessed by the user's per-image review.
 */
export function curatedListingHighlights(source: ListingAsset[], limit = 10): ListingAsset[] {
  const available = originalAssets(source);
  const take = Math.min(Math.max(0, Math.floor(limit)), available.length);
  if (take === 0) return [];
  const result: ListingAsset[] = [];
  const used = new Set<string>();
  const add = (item: ListingAsset | undefined) => {
    if (item && result.length < take && !used.has(item.id)) {
      used.add(item.id);
      result.push(item);
    }
  };
  const grouped = new Map<string, ListingAsset[]>();
  for (const item of available) {
    const category = listingCategory(item);
    if (category) grouped.set(category, [...(grouped.get(category) || []), item]);
  }
  for (const group of grouped.values()) add(group[Math.floor(group.length / 2)]);
  for (let i = 0; i < take; i++) add(available[Math.min(available.length-1, Math.floor((i+0.5)*available.length/take))]);
  for (const item of available) add(item);
  return result;
}
export function planListingPlacements(number: number, source: ListingAsset[]): ListingPlacement[] {
  const available = originalAssets(source);
  if (!available.length) return [];
  const spec = LISTING_IMAGE_SPECS[number - 1];
  if (!spec) return [];
  let selected: ListingAsset[] = [];
  if (spec.kind === 'all' || spec.kind === 'all-grouped') {
    selected = spec.kind === 'all-grouped'
      ? [...available].sort((a, b) => listingCategory(a).localeCompare(listingCategory(b)))
      : available;
  } else if (spec.kind === 'categories') {
    const groups = new Map<string, ListingAsset[]>();
    for (const asset of available) {
      const category = listingCategory(asset) || 'Collection';
      groups.set(category, [...(groups.get(category) || []), asset]);
    }
    const distinct = [...groups.values()];
    if (distinct.length > 1) {
      const chosen: ListingAsset[] = [];
      for (const group of distinct.slice(0, 6)) chosen.push(...group.slice(0, 3));
      selected = chosen;
    } else selected = available.slice(0, 18);
  } else if (number === 1) selected = curatedListingHighlights(available, 10);
  else if (number === 4) selected = curatedListingHighlights(available, 8);
  else if (number === 6) selected = available.slice(0, 2);
  else if (number === 7) selected = available.slice(0, 3);
  else if (number === 8) selected = available.slice(0, 9);
  else if (number >= 9 && number <= 11) selected = available.slice(0, 1);
  else if (number === 12) selected = available.slice(0, 3);
  else if (number === 13) selected = available.slice(0, 5);
  else if (number === 14) selected = available.slice(0, 2);
  else selected = number === 15 ? curatedListingHighlights(available, 9) : available.slice(0, 9);

  const box = (asset: ListingAsset, x: number, y: number, width: number, height: number): ListingPlacement =>
    ({ assetId: asset.id, x, y, width, height, rotation: 0 });
  if (number === 9 || number === 10 || number === 11) {
    const target = number === 9 ? [40, 46, 20, 25] : number === 10 ? [40, 47, 20, 24] : [41, 49, 18, 22];
    return selected.map(a => box(a, target[0], target[1], target[2], target[3]));
  }
  if (number === 8 || number === 12) {
    const originX = 37;
    const originY = number === 8 ? 40 : 44;
    const cols = number === 8 ? 3 : 3;
    const width = number === 8 ? 9 : 10;
    const height = number === 8 ? 12 : 19;
    return selected.map((a, i) => box(a, originX + (i % cols) * (width + 1.5), originY + Math.floor(i / cols) * (height + 1.5), width, height));
  }
  if (spec.kind === 'all-grouped') {
    // Visually separate the complete collection into four curated groups,
    // instead of duplicating the uniform all-assets grid of image 02.
    const sections = Math.min(4, Math.max(1, Math.ceil(selected.length / 12)));
    const perSection = Math.ceil(selected.length / sections);
    return selected.map((asset, index) => {
      const group = Math.min(sections - 1, Math.floor(index / perSection));
      const local = index - group * perSection;
      const size = Math.min(perSection, selected.length - group * perSection);
      const cols = Math.max(1, Math.ceil(Math.sqrt(size * 42 / 28)));
      const rows = Math.ceil(size / cols);
      const x0 = group % 2 === 0 ? 5 : 53;
      const y0 = group < 2 ? 31 : 65;
      const cellW = 42 / cols, cellH = 27 / rows;
      return box(asset, x0 + local % cols * cellW + 0.3,
        y0 + Math.floor(local / cols) * cellH + 0.2, cellW - 0.6, cellH - 0.4);
    });
  }
  if (spec.kind === 'all') {
    const cols = selected.length > 70 ? 10 : selected.length > 40 ? 8 : selected.length > 20 ? 6 : 5;
    const rows = Math.ceil(selected.length / cols);
    const cellW = 90 / cols;
    const cellH = 70 / rows;
    return selected.map((a, i) => box(a, 5 + (i % cols) * cellW + 0.5, 24 + Math.floor(i / cols) * cellH + 0.3, cellW - 1, cellH - 0.7));
  }
  if (number === 1 || number === 15) {
    const slots = [[3, 28, 26, 34], [71, 29, 26, 34], [29, 37, 20, 29], [51, 37, 20, 29], [4, 64, 22, 27], [73, 64, 23, 27], [27, 69, 17, 23], [56, 69, 17, 23], [14, 50, 19, 28], [66, 50, 19, 28]];
    return selected.map((a, i) => box(a, ...slots[i % slots.length] as [number, number, number, number]));
  }
  const count = selected.length;
  const cols = count > 12 ? 6 : count > 6 ? 4 : count > 3 ? 3 : count;
  const rows = Math.ceil(count / cols);
  const cellW = 86 / cols, cellH = 63 / rows;
  return selected.map((a, i) => box(a, 7 + (i % cols) * cellW + 0.8, 29 + Math.floor(i / cols) * cellH + 0.5, cellW - 1.6, cellH - 1));
}
