export type PackPreset = 'complete-10' | 'core-5' | 'category-showcase';
export type PackCharacter = { id: string; name: string; imageUrl?: string; category?: string; subtheme?: string; group?: string };
export type Zone = { x: number; y: number; width: number; height: number };
export type PackSlide = { key: string; name: string; headline: string; subtitle: string; layout: 'hero' | 'grid' | 'boutique' | 'closeup' | 'showcase'; limit: number; textZone: Zone; ids?: string[] };
const top: Zone = { x: 8, y: 5, width: 84, height: 23 };
const make = (key: string, name: string, headline: string, subtitle: string, layout: PackSlide['layout'], limit: number, textZone = top): PackSlide =>
  ({ key, name, headline: headline.slice(0, 75), subtitle: subtitle.slice(0, 95), layout, limit, textZone });
export function categoryGroups(characters: PackCharacter[]) {
  const available = characters.filter(c => c.imageUrl);
  const groups = new Map<string, string[]>();
  for (const c of available) {
    const category = [c.category, c.subtheme, c.group].find(v => typeof v === 'string' && v.trim());
    if (category) groups.set(category.trim(), [...(groups.get(category.trim()) || []), c.id]);
  }
  if (groups.size > 1) {
    const covered = new Set([...groups.values()].flat());
    const rest = available.filter(c => !covered.has(c.id)).map(c => c.id);
    if (rest.length) groups.set('More Illustrations', rest);
    return [...groups].map(([name, ids]) => ({ name, ids }));
  }
  const result: Array<{name: string; ids: string[]}> = [];
  for (let i = 0; i < available.length; i += 9)
    result.push({ name: 'Collection Selection ' + (result.length + 1), ids: available.slice(i, i + 9).map(c => c.id) });
  return result;
}
export function buildPack(preset: PackPreset, title: string, characters: PackCharacter[]): PackSlide[] {
  const name = (title || 'Clipart Collection').slice(0, 70);
  const total = characters.filter(c => c.imageUrl).length;
  const summary = total + ' illustrated assets';
  const hero = make('hero', 'Hero Cover', name, 'Digital Clipart Collection', 'hero', 5);
  const showcase = make('showcase', 'Collection Showcase', name, summary, 'showcase', 12);
  const preview = make('preview', 'Collection Preview', 'Explore the Collection', summary, 'grid', 35);
  const closeup = make('closeup', 'Artwork Closeups', 'Beautiful Details', 'A closer look at the artwork', 'closeup', 4);
  const bundle = make('bundle', 'Complete Bundle', name, summary, 'hero', 7);
  if (preset === 'core-5') return [hero, showcase, preview, closeup, bundle];
  const groups = categoryGroups(characters);
  const category = (i: number): PackSlide => {
    const group = groups[i];
    const slide = make('category-' + i, group?.name || (i ? 'More to Discover' : 'Favorite Illustrations'),
      group?.name || 'Collection Highlights', name, 'grid', 9);
    return group ? { ...slide, ids: group.ids } : slide;
  };
  if (preset === 'category-showcase') return [hero, ...groups.slice(0, 8).map((_, i) => category(i)), bundle];
  return [hero, showcase,
    make('artistic', 'Artistic Typography', name, 'A curated illustration collection', 'showcase', 5),
    make('storybook', 'Storybook Gallery', 'Inside the Collection', name, 'grid', 9),
    make('boutique', 'Modern Boutique', name, 'Creative artwork collection', 'boutique', 5, { x: 5, y: 7, width: 41, height: 83 }),
    preview, category(0), category(1), closeup, bundle];
}
const overlap = (a: Zone, b: Zone, pad = 2) => a.x < b.x + b.width + pad && a.x + a.width + pad > b.x && a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;
export function placeOriginals(slide: PackSlide, characters: PackCharacter[], referenceSlots: Zone[] = []) {
  const options = characters.filter(c => c.imageUrl && (!slide.ids || slide.ids.includes(c.id)));
  const count = Math.min(slide.limit, options.length);
  const region: Zone = slide.layout === 'boutique' ? { x: 51, y: 7, width: 44, height: 86 } : { x: 5, y: 32, width: 90, height: 63 };
  const cols = slide.layout === 'grid' ? (count > 24 ? 7 : count > 9 ? 4 : 3) : slide.layout === 'closeup' || slide.layout === 'boutique' ? 2 : count > 9 ? 4 : 3;
  const rows = Math.ceil(count / cols);
  const cw = region.width / cols, ch = region.height / Math.max(1, rows);
  const used: Zone[] = [];
  return options.slice(0, count).flatMap((c, i) => {
    const w = Math.min(cw * .78, 32), h = Math.min(ch * .78, 35);
    const suggested = referenceSlots[i];
    const grid: Zone = { x: region.x + i % cols * cw + (cw-w)/2, y: region.y + Math.floor(i/cols)*ch + (ch-h)/2, width:w, height:h };
    const ref: Zone = suggested ? {x:Math.max(2,Math.min(98-w,suggested.x)),y:Math.max(2,Math.min(98-h,suggested.y)),width:w,height:h} : grid;
    const valid = (z: Zone) => !overlap(z, slide.textZone, 4) && used.every(other => !overlap(z, other, 1));
    const zone = slide.layout !== 'grid' && valid(ref) ? ref : grid;
    if (!valid(zone)) return [];
    used.push(zone);
    return [{ characterId: c.id, ...zone, rotation: slide.layout === 'grid' || slide.layout === 'showcase' ? 0 : (i % 3 - 1) * 5 }];
  });
}
