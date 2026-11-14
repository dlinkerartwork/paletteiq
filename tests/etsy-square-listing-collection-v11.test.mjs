import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LISTING_HEIGHT, LISTING_WIDTH, LISTING_IMAGE_SPECS,
  isSquareListingApproved, listingFilename } from '../lib/etsy-listing-image-plan.ts';
import { listingCreativeDirection, listingMockupScene } from '../lib/etsy-listing-creative-direction.ts';

const component = readFileSync(new URL('../components/etsy-listing-image-studio.tsx', import.meta.url), 'utf8');
const backend = readFileSync(new URL('../app/api/listing-image-studio/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('2026 listing instruction uses 1024 square canvases across image AI, client render, mockups, and export', () => {
  assert.equal(LISTING_WIDTH,1024);
  assert.equal(LISTING_HEIGHT,1024);
  assert.equal(LISTING_WIDTH/LISTING_HEIGHT,1);
  assert.match(backend,/size: '1024x1024'/);
  assert.match(backend,/FINAL CANVAS IS 1024 x 1024 pixels, 1:1 SQUARE JPG/);
  assert.match(backend,/No crop is applied/);
  assert.match(component,/canvas\.width = LISTING_WIDTH; canvas\.height = LISTING_HEIGHT/);
  assert.match(component,/canvas\.toBlob\(blob => blob \? resolve\(blob\) : reject\(Error\('Could not render JPG image\.'\)\), 'image\/jpeg'/);
  assert.match(component,/aspectRatio: '1 \/ 1'/);
  assert.match(component,/1024 × 1024 px \(1:1 square\)/);
  const scene=listingMockupScene(8,listingCreativeDirection({name:'Cute Bears',theme:'Cute Animals'}).family);
  assert.match(scene?.prompt||'',/final 1:1 square canvas/);
  for(const step of [8,9,10,11,12]){
    assert.doesNotMatch(listingMockupScene(step,'classic')?.prompt||'',/4:3|3:2|landscape source/);
  }
  assert.doesNotMatch(backend,/size: '1536x1024'|landscape \(3000x2250\)/);
});

test('old 4:3 approvals are preserved but cannot count toward square workflow or ZIP', () => {
  const old = { number:1,status:'approved',renderedImageUrl:'/api/thumbnail-background?assetId=old',
    placements:[{assetId:'test',x:20,y:20,width:30,height:30,rotation:0}],updatedAt:1 };
  const current={...old,width:1024,height:1024};
  assert.equal(isSquareListingApproved(old),false);
  assert.equal(isSquareListingApproved({...old,width:3000,height:2250}),false);
  assert.equal(isSquareListingApproved(current),true);
  assert.equal(isSquareListingApproved({...current,status:'draft'}),false);
  assert.equal(isSquareListingApproved({...current,renderedImageUrl:''}),false);
  assert.match(backend,/selected\.some\(item => !isSquareListingApproved\(item\)\)/);
  assert.match(backend,/Save a 1024 × 1024 JPG using original collection artwork before approval/);
  assert.match(backend,/width !== LISTING_WIDTH \|\| height !== LISTING_HEIGHT/);
  assert.match(component,/isSquareListingApproved\(r\)/);
  assert.match(component,/Legacy 4:3 • remake as square/);
  assert.match(component,/width: LISTING_WIDTH, height: LISTING_HEIGHT/);
  assert.match(component,/Your older 4:3 image remains saved/);
});

test('simplified /new-listing /revise /next UX has collection as only artwork source', () => {
  assert.match(component,/Start \/new-listing — Generate Main Cover/);
  assert.match(component,/Revise Image /);
  assert.match(component,/Approve & Next \(\/next\)/);
  assert.match(component,/Advanced AI settings \(optional\)/);
  assert.match(component,/originalAssets\(characters\)/);
  assert.match(component,/inspectOriginalCollectionSample\(assets\)/);
  assert.match(component,/sample = assets\.slice\(0, 12\)/);
  assert.match(component,/const file = await compose\(background, layout, assets\)/);
  assert.match(page,/label: 'Etsy Clipart Listing Studio'/);
  assert.match(backend,/The actual collection images are NOT provided to you/);
  assert.doesNotMatch(backend,/ZIP file contents sent to AI/);
});

test('square workflow retains exactly 15 commercial mockup and gallery stages', () => {
  assert.equal(LISTING_IMAGE_SPECS.length,15);
  assert.equal(new Set(LISTING_IMAGE_SPECS.map(x=>x.number)).size,15);
  assert.equal(LISTING_IMAGE_SPECS[0].title,'Main Cover');
  assert.equal(LISTING_IMAGE_SPECS[14].title,'Final Bundle Showcase');
  assert.equal(listingFilename(1),'01_Main_Cover.jpg');
  assert.equal(listingFilename(15),'15_Final_Showcase.jpg');
  assert.match(component,/if \(!precedingApproved\)/);
  assert.match(component,/status: 'approved' \| 'needs_revision'/);
});
