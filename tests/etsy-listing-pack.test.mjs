import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPack, placeOriginals } from '../lib/etsy-listing-pack.ts';

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
