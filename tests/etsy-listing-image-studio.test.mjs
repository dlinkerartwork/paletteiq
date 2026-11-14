import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LISTING_IMAGE_SPECS, LISTING_WIDTH, LISTING_HEIGHT,
  originalAssets, planListingPlacements, listingFilename, listingTitle
} from '../lib/etsy-listing-image-plan.ts';

const artwork = Array.from({ length: 80 }, (_, i) => ({
  id: 'asset-' + (i+1), name: 'Original ' + (i+1),
  imageUrl: '/api/images/' + String(i+1).padStart(36,'0'),
  category: ['Animals','Seasonal','Nature','Accessories'][i%4]
}));

test('listing image plan contains exactly 15 unique numbered pages in approved order', () => {
  assert.equal(LISTING_IMAGE_SPECS.length, 15);
  assert.deepEqual(LISTING_IMAGE_SPECS.map(x=>x.number), Array.from({ length: 15 },(_,i)=>i+1));
  assert.equal(new Set(LISTING_IMAGE_SPECS.map(x=>x.key)).size, 15);
  assert.equal(LISTING_WIDTH, 3000);
  assert.equal(LISTING_HEIGHT, 2250);
});
test('all source images appear exactly once in 02 and 03 without regenerating assets', () => {
  for(const number of [2,3]){
    const elements = planListingPlacements(number, artwork);
    assert.equal(elements.length, artwork.length);
    assert.deepEqual(new Set(elements.map(p => p.assetId)), new Set(artwork.map(x=>x.id)));
  }
});
test('category showcase uses collection IDs and source categories', () => {
  const elements = planListingPlacements(5, artwork);
  assert.ok(elements.length > 0 && elements.length <= 18);
  assert.ok(elements.every(p => artwork.some(a=>a.id===p.assetId)));
});
test('non-gallery mockups place real clipart only in specified blank areas', () => {
  for(const number of [8,9,10,11,12]){
    const elements=planListingPlacements(number, artwork);
    assert.ok(elements.length>0);
    for(const p of elements){
      assert.ok(artwork.some(a=>a.id===p.assetId));
      assert.ok(p.y>=35 && p.y+p.height<=95, 'keep mockup product region in the lower portion');
      assert.ok(p.x>=30 && p.x+p.width<=70, 'print area in central product region');
    }
  }
});
test('only image records with unique original URLs count as sellable assets', () => {
  const same = [...artwork, {...artwork[0],id:'different-id'}, {id:'empty',name:'Missing'}];
  assert.equal(originalAssets(same).length,80);
});
test('each page has deterministic separate JPG name',()=>{
  assert.equal(listingFilename(1),'01_Main_Cover.jpg');
  assert.equal(listingFilename(15),'15_Final_Showcase.jpg');
  assert.equal(new Set(Array.from({length:15},(_,i)=>listingFilename(i+1))).size,15);
  assert.throws(()=>listingFilename(16));
});
test('main cover uses collection title and all pages have original IDs',()=>{
  assert.equal(listingTitle(1,'  Cozy Winter Forest  '),'Cozy Winter Forest');
  for(let number=1;number<=15;number++){
    const elements=planListingPlacements(number,artwork);
    assert.ok(elements.length);
    assert.ok(elements.every(e=>artwork.some(a=>a.id===e.assetId)));
    assert.ok(elements.every(e=>e.width>0 && e.height>0));
  }
});
