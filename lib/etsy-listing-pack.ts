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
  const hero = make('hero', 'Hero Cover', name, 'Digital Clipart Collection', 'hero', 6, { x: 22, y: 31, width: 56, height: 38 });
  const showcase = make('showcase', 'Collection Showcase', name, summary, 'showcase', 12);
  const preview = make('preview', 'Collection Preview', 'Explore the Collection', summary, 'grid', 35);
  const closeup = make('closeup', 'Artwork Closeups', 'Beautiful Details', 'A closer look at the artwork', 'closeup', 4);
  const bundle = make('bundle', 'Complete Bundle', name, summary, 'hero', 7, { x: 22, y: 31, width: 56, height: 38 });
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
    make('artistic', 'Artistic Typography', name, 'A curated illustration collection', 'hero', 5, { x: 22, y: 31, width: 56, height: 38 }),
    make('storybook', 'Storybook Gallery', 'Inside the Collection', name, 'grid', 9),
    make('boutique', 'Modern Boutique', name, 'Creative artwork collection', 'boutique', 5, { x: 5, y: 7, width: 41, height: 83 }),
    preview, category(0), category(1), closeup, bundle];
}

const foodTerms = /\b(sushi|sashimi|nigiri|maki|temaki|uramaki|hosomaki|futomaki|gunkan|chirashi|onigiri|inari|toro|salmon|tuna|ebi|ikura|uni)\b/i;
const notSushi = /\b(ramen|udon|soba|noodle|pho|bibimbap|kimchi|dumpling|bao|dim sum|soup|curry|pad thai|takoyaki|tempura|bento|mochi|tea|coffee|hot pot|satay|spring roll)\b/i;
const relevant = (slide: PackSlide, character: PackCharacter) => {
  if (slide.ids) return slide.ids.includes(character.id);
  const title = slide.headline.toLowerCase(), name = character.name.toLowerCase();
  // A narrow product title must never borrow visually unrelated illustrations.
  if (/\b(sushi|sashimi)\b/.test(title)) return foodTerms.test(name) && !notSushi.test(name);
  const category = character.category || character.subtheme || character.group || '';
  if (category && title.toLowerCase().includes(category.toLowerCase())) return true;
  if (/\b(ramen|noodles?)\b/.test(title)) return /\b(ramen|noodle|udon|soba)\b/i.test(name);
  return true;
};
export function filterThemeCharacters(title: string, characters: PackCharacter[]): PackCharacter[] {
  const term = title.toLowerCase();
  if (/\b(sushi|sashimi)\b/.test(term))
    return characters.filter(c => c.imageUrl && foodTerms.test(c.name) && !notSushi.test(c.name));
  if (/\b(ramen|noodles?)\b/.test(term))
    return characters.filter(c => c.imageUrl && /\b(ramen|noodle|udon|soba)\b/i.test(c.name));
  return characters.filter(c => c.imageUrl);
}
export function selectPackCharacters(slide: PackSlide, characters: PackCharacter[]) {
  return characters.filter(c => c.imageUrl && relevant(slide,c)).slice(0,slide.limit);
}
const overlap = (a: Zone, b: Zone, pad = 2) =>
  a.x < b.x + b.width + pad && a.x + a.width + pad > b.x &&
  a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;
const rotatedBounds = (box: Zone, angle: number): Zone => {
  const r = Math.abs(angle)*Math.PI/180;
  const w = box.width*Math.cos(r)+box.height*Math.sin(r);
  const h = box.width*Math.sin(r)+box.height*Math.cos(r);
  return { x:box.x+(box.width-w)/2, y:box.y+(box.height-h)/2, width:w, height:h };
};
export function placeOriginals(slide: PackSlide, characters: PackCharacter[], referenceSlots: Zone[] = []) {
  const options = selectPackCharacters(slide,characters);
  if (!options.length) return [];
  const count = options.length;
  // Editorial templates: radial hero, clean grid, split boutique, gallery and detail.
  const area: Zone = slide.layout==='boutique'
    ? {x:53,y:9,width:41,height:82}
    : slide.layout==='showcase'
      ? {x:5,y:28,width:90,height:67}
      : {x:6,y:32,width:88,height:62};
  const columns = slide.layout==='grid' ? (count>24?7:count>10?4:3)
    : slide.layout==='closeup'||slide.layout==='boutique'?2
    : count>9?4:3;
  const rows = Math.ceil(count/columns);
  const cellW=area.width/columns,cellH=area.height/rows;
  const used:Zone[]=[];
  const result:Array<{characterId:string;x:number;y:number;width:number;height:number;rotation:number}>=[];
  const safe = (z:Zone,rotation:number) => {
    const bound=rotatedBounds(z,rotation);
    return bound.x>=2&&bound.y>=2&&bound.x+bound.width<=98&&bound.y+bound.height<=98
      &&!overlap(bound,slide.textZone,5)&&used.every(other=>!overlap(bound,other,2));
  };
  for(let i=0;i<count;i++){
    const width=Math.min(cellW*.72,slide.layout==='closeup'?33:27);
    const height=Math.min(cellH*.70,slide.layout==='closeup'?32:28);
    const col=i%columns,row=Math.floor(i/columns);
    const heroPositions = [
      [3, 9], [84, 9], [3, 40], [84, 40], [3, 75], [84, 75], [35, 6], [35, 77]
    ];
    const [hx,hy]=heroPositions[i % heroPositions.length];
    const grid:Zone=slide.layout==='hero'
      ? {x:hx,y:hy,width:Math.min(width,12),height:Math.min(height,18)}
      : {x:area.x+col*cellW+(cellW-width)/2,y:area.y+row*cellH+(cellH-height)/2,width,height};
    const angle=slide.layout==='grid'||slide.layout==='showcase'?0:(i%3-1)*3;
    const candidates:Zone[]=[];
    // Reference slot positions are only hints; never override typography exclusion.
    if(referenceSlots[i]&&slide.layout!=='grid'){
      const ref=referenceSlots[i];
      candidates.push({x:Math.max(3,Math.min(97-width,ref.x)),y:Math.max(3,Math.min(97-height,ref.y)),width,height});
    }
    candidates.push(grid);
    for(let j=0;j<25;j++){
      const step=j+1;
      candidates.push({x:Math.max(3,Math.min(97-width,grid.x+((step%5)-2)*cellW*.18)),y:Math.max(3,Math.min(97-height,grid.y+Math.floor(step/5)*cellH*.13)),width,height});
    }
    const chosen=candidates.find(c=>safe(c,angle));
    if(!chosen)continue;
    used.push(rotatedBounds(chosen,angle));
    result.push({characterId:options[i].id,...chosen,rotation:angle});
  }
  return result;
}
