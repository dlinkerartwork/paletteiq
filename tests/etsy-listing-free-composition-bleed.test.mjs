import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  defaultListingCompositionMode, listingAllowsBleed, validListingPlacement,
  planListingPlacements, originalAssets
} from '../lib/etsy-listing-image-plan.ts';

const api=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const editor=readFileSync(new URL('../components/etsy-listing-layout-canvas.tsx',import.meta.url),'utf8');
const studio=readFileSync(new URL('../app/api/studio/route.ts',import.meta.url),'utf8');

const art=Array.from({length:120},(_,i)=>({
 id:'real-'+i,name:'Original Art '+i,imageUrl:'/collection/'+i+'.png',category:'Animals'
}));

test('AI-led Free Composition is the default only on Main Cover; other 14 retain structured choice',()=>{
  assert.equal(defaultListingCompositionMode(1),'free');
  for(let image=2;image<=15;image++)assert.equal(defaultListingCompositionMode(image),'structured');
  assert.match(ui,/compositionMode: ListingCompositionMode = compositionModes\[String\(step\)\] \?\? defaultListingCompositionMode\(step\)/);
  assert.match(ui,/<option value="free">Free Composition/);
  assert.match(ui,/<option value="structured">Structured/);
  assert.match(ui,/data-listing-layout-canvas="true"|EtsyListingLayoutCanvas/);
  assert.match(ui,/compositionMode === 'free' \|\| allowVisionRefinement/);
  assert.match(ui,/setCompositionModes\(old =>/);
  assert.match(ui,/allowVisionRefinement/);
});

test('source images can bleed off canvas edges for a natural illustration collage, while mockups stay safe',()=>{
  for(const number of [1,2,3,4,5,6,7,13,14,15])assert.equal(listingAllowsBleed(number),true);
  for(const number of [8,9,10,11,12])assert.equal(listingAllowsBleed(number),false);
  const partlyCropped={assetId:'real-0',x:-22,y:7,width:42,height:68,rotation:-15};
  assert.equal(validListingPlacement(partlyCropped,1),true);
  assert.equal(validListingPlacement({...partlyCropped,x:90,y:83,width:35,height:35},1),true);
  assert.equal(validListingPlacement({...partlyCropped,x:101},1),false,'must touch final canvas');
  assert.equal(validListingPlacement({...partlyCropped,x:-60,width:20},1),false,'entirely off canvas');
  assert.equal(validListingPlacement({...partlyCropped,width:230},1),false,'impractically huge item');
  assert.equal(validListingPlacement(partlyCropped,10),false,'no bleed beyond product mockup');
  assert.equal(validListingPlacement({...partlyCropped,x:10,y:10,width:20,height:22},10),true);
  assert.equal(validListingPlacement({assetId:'real-0',x:75,y:30,width:40,height:30},10),false);
});

test('both preset and custom-selected artworks remain sourced uniquely from the collection, even at high counts',()=>{
  assert.equal(planListingPlacements(1,art).length,12);
  const count=planListingPlacements(1,art,{count:100});
  assert.equal(count.length,100);
  assert.equal(new Set(count.map(x=>x.assetId)).size,100);
  assert.equal(originalAssets(art).length,120);
  assert.match(ui,/max=\{assets\.length\}/);
  assert.match(ui,/checked=\{selectedAssetIds\.includes\(asset\.id\)\}/);
});

test('AI free composition does NOT force previous PaletteIQ coordinates into the paid background prompt',()=>{
  assert.match(api,/compositionMode === 'free'/);
  assert.match(api,/Any positions from PaletteIQ are ONLY an optional selection sketch, never a placement constraint/);
  assert.match(api,/An independent AI Vision art director will decide all clipart positions/);
  assert.match(api,/TYPOGRAPHY COLOR DIRECTION/);
  assert.match(api,/You choose the number, distribution, accents and palette freely/);
  assert.match(api,/main title block only about 10–13%/);
  assert.match(api,/preLayout\?\.length/);
  assert.match(api,/STRUCTURED COMPOSITION: honor user-arranged WHITE CANVAS positions/);
  assert.match(api,/compositionMode \?\? defaultListingCompositionMode\(input\.number\)/);
  assert.match(api,/input\.compositionMode !== undefined && !\['free','structured'\]/);
  assert.match(ui,/featuredCount: effectivePositions\.length, placements: effectivePositions, textScale, backgroundStyle, compositionMode/);
});

test('OpenAI Vision sees numbered thumbnails from actual original clipart and freely chooses layout geometry',()=>{
  assert.match(ui,/async function createArtworkContactSheets\(/);
  assert.match(ui,/const byId = new Map\(assets\.map\(asset => \[asset\.id,asset\]\)\)/);
  assert.match(ui,/await imageFromUrl\(url\)/);
  assert.match(ui,/ctx\.drawImage\(image,bounds\.sx,bounds\.sy,bounds\.sw,bounds\.sh/);
  assert.match(ui,/canvas\.toDataURL\('image\/jpeg',0\.66\)/);
  assert.match(ui,/const perSheet = 24, columns = 8, cell = 128/);
  assert.match(api,/contactSheets\.length > Math\.ceil\(fallback\.length \/ 24\)/);
  assert.match(ui,/compositionMode === 'free'/);
  assert.match(api,/contactSheets\.map\(image_url => \(\{type:'input_image',image_url\}\)\)/);
  assert.match(api,/Ignore PaletteIQ starter geometry completely/);
  assert.match(api,/professionally art-directed collage/);
  assert.match(api,/CANVAS BLEED IS ALLOWED/);
  assert.match(api,/no mandatory grid, center, perimeter, hero count/);
  assert.match(api,/Return each listed assetId EXACTLY ONCE/);
  assert.match(api,/validListingPlacement\(p,input\.number!\)/);
  assert.match(api,/candidates\.length === fallback\.length/);
  assert.match(api,/const seen = new Set<string>\(\)/);
  assert.match(api,/never redraw|NEVER redraw/);
  assert.match(ui,/const file = await compose\(background, layout, assets\)/);
});

test('mode, bleed coordinates, and original PNG IDs survive server persistence and remain manually editable',()=>{
  assert.match(api,/listingCompositionModes\?: Record<string, ListingCompositionMode>/);
  assert.match(api,/compositionModes: project\.listingCompositionModes \|\| \{\}/);
  assert.match(api,/project\.listingCompositionModes = \{/);
  assert.match(api,/validListingPlacement\(p, input\.number!\)/);
  assert.match(api,/validListingPlacement\(p, value\.number\)/);
  assert.match(studio,/const savedCompositionModes =/);
  assert.match(ui,/setSavedCompositionModes\(result\.compositionModes\)/);
  assert.match(ui,/allowBleed=\{listingAllowsBleed\(step\)\}/);
  assert.match(editor,/allowBleed\?-100:0/);
  assert.match(editor,/allowBleed\?200:100/);
  assert.match(ui,/Apply layout & save JPG \(no AI cost\)/);
  assert.match(ui,/selected\.rotation/);
});

test('Free Composition excludes PaletteIQ starter geometry and can arrange all unique originals in progressive batches',()=>{
  assert.match(api,/const descriptor = fallback\.map\(\(p,index\) => free/);
  assert.match(api,/\? \{ index:index\+1, assetId:p\.assetId, name:valid\.get\(p\.assetId\) \}/);
  assert.match(api,/existingPlacements\?: ListingPlacement\[\]/);
  assert.match(api,/ALREADY AI-ARRANGED ORIGINALS/);
  assert.match(api,/AI Vision returned the same PaletteIQ starter composition/);
  assert.match(ui,/const batchSize = 24/);
  assert.match(ui,/offset < initial\.length; offset \+= batchSize/);
  assert.match(ui,/existingPlacements:arranged, totalSelected:initial\.length/);
  assert.match(ui,/await arrangeWithAI\(response\.backgroundUrl, effectivePositions\)/);
  assert.match(ui,/await arrangeWithAI\(current\.backgroundUrl, positions/);
  assert.doesNotMatch(api,/\.slice\(0, 300\)/);
  assert.doesNotMatch(api,/length > 300/);
  assert.match(ui,/There is no preset maximum number of canvas objects/);
  const dense=planListingPlacements(1,art,{count:120});
  assert.equal(dense.length,120);
  assert.equal(new Set(dense.map(x=>x.assetId)).size,120);
});
