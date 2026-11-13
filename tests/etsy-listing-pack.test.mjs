import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPack, filterThemeCharacters, placeOriginals } from '../lib/etsy-listing-pack.ts';

const characters = Array.from({ length: 55 }, (_, i) => ({
  id: 'art-' + i, name: 'Artwork ' + i, imageUrl: '/api/image/' + i
}));
const overlaps = (a, b, pad = 0) => a.x < b.x + b.width + pad && a.x + a.width + pad > b.x && a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;

test('Etsy complete and core packs have exact requested sizes', () => {
  assert.equal(buildPack('complete-10', 'Asian Food', characters).length, 10);
  assert.equal(buildPack('core-5', 'Asian Food', characters).length, 5);
});

test('Category slides use actual group metadata or neutral selections', () => {
  const pack = buildPack('category-showcase', 'Asian Food', characters);
  assert.ok(pack.length >= 3 && pack.length <= 10);
  assert.ok(pack.slice(1, -1).every(slide => slide.ids?.every(id => characters.some(c => c.id === id))));
});

test('Original layer placements do not overlap title safe zones or one another', () => {
  for (const slide of buildPack('complete-10', 'Asian Food', characters)) {
    const placements = placeOriginals(slide, characters, [{x: 8, y: 6, width: 80, height: 25}]);
    assert.ok(placements.length > 0, slide.name);
    assert.ok(placements.every(p => characters.some(c => c.id === p.characterId)));
    for (const p of placements) {
      assert.equal(overlaps(p, slide.textZone, 3), false, slide.name + ': title collision');
      for (const other of placements) {
        if (other === p) continue;
        assert.equal(overlaps(p, other), false, slide.name + ': artwork collision');
      }
    }
  }
});

test('specific sushi listing never receives ramen or unrelated noodle artwork', () => {
  const assets = [
    { id:'s1',name:'Salmon Nigiri Sushi',imageUrl:'s1.png' },
    { id:'s2',name:'Tuna Sashimi',imageUrl:'s2.png' },
    { id:'s3',name:'California Sushi Roll',imageUrl:'s3.png' },
    { id:'r1',name:'Tonkotsu Ramen Noodle Soup',imageUrl:'r1.png' },
    { id:'r2',name:'Miso Soup',imageUrl:'r2.png' }
  ];
  const selected = filterThemeCharacters('Japanese Sushi and Sashimi',assets);
  assert.deepEqual(selected.map(x=>x.id),['s1','s2','s3']);
  for (const slide of buildPack('core-5','Japanese Sushi and Sashimi',selected)) {
    const placements=placeOriginals(slide,selected);
    assert.ok(placements.every(x=>!['r1','r2'].includes(x.characterId)));
  }
});

test('hero medallion keeps original assets away from centered title even after rotation', () => {
  const assets=Array.from({length:9},(_,i)=>({id:'s'+i,name:'Sushi nigiri '+i,imageUrl:'s'+i+'.png'}));
  const hero=buildPack('core-5','Japanese Sushi',assets)[0];
  assert.equal(hero.layout,'hero');
  const placements=placeOriginals(hero,assets);
  assert.ok(placements.length>=4,'Should show a useful number of original cliparts');
  for (const p of placements) {
    const r=Math.abs(p.rotation)*Math.PI/180;
    const w=p.width*Math.cos(r)+p.height*Math.sin(r), h=p.width*Math.sin(r)+p.height*Math.cos(r);
    const bounding={x:p.x+(p.width-w)/2,y:p.y+(p.height-h)/2,width:w,height:h};
    assert.equal(overlaps(bounding,hero.textZone,4),false);
  }
});

test('Premium hero layout uses clearly different focal and accent sizes', () => {
  const hero = buildPack('core-5', 'Asian Food', characters)[0];
  const placements = placeOriginals(hero, characters, [], 'dramatic');
  assert.ok(placements.length >= 4, 'Premium cover should include hero and supporting collection assets');
  const widths = placements.map(p => p.width);
  assert.ok(Math.max(...widths) >= 24, 'Hero asset should be visibly large');
  assert.ok(Math.max(...widths) / Math.min(...widths) >= 1.6, 'Premium cover should have an unmistakable size hierarchy');
  for (const item of placements) {
    assert.equal(overlaps(item, hero.textZone, 3), false, 'Large original artwork must stay out of title zone');
  }
});

test('Catalogue showcase and hero layouts are intentionally different', () => {
  const pack = buildPack('complete-10', 'Asian Food', characters);
  const hero = placeOriginals(pack[0], characters, [], 'dramatic');
  const preview = placeOriginals(pack[5], characters, [], 'dramatic');
  assert.ok(hero.length >= 4);
  assert.ok(preview.length > hero.length);
  assert.ok(Math.max(...hero.map(p => p.width)) > Math.max(...preview.map(p => p.width)));
});
