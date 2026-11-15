import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  LISTING_WIDTH,LISTING_HEIGHT,LISTING_IMAGE_SPECS,
  planCompleteCollectionCatalog,completeCatalogMatchesInventory,
  isSquareListingApproved,planListingPlacements
} from '../lib/etsy-listing-image-plan.ts';
const api=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const original=(count)=>Array.from({length:count},(_,i)=>({
  id:'original-'+String(i+1).padStart(3,'0'),
  name:'Woodland illustration '+(i+1),category:i%2?'Animals':'Decorations',
  imageUrl:'/api/images/original-'+(i+1)+'.png'
}));
function savedCatalog(files){
  const p=planCompleteCollectionCatalog(files);
  return {
    number:3,status:'approved',renderedImageUrl:'/api/example-verified.jpg',
    width:LISTING_WIDTH,height:LISTING_HEIGHT,
    placements:p.placements,catalogAssetIds:p.placements.map(x=>x.assetId),
    catalogExpectedCount:files.length,aiGeneratedFullCover:false,updatedAt:1
  };
}

test('03 Complete Collection includes every one of 120 original assets, exactly once',()=>{
  const files=original(120);
  const grid=planCompleteCollectionCatalog(files);
  assert.equal(grid.columns,12);
  assert.equal(grid.rows,10);
  assert.equal(grid.placements.length,120);
  assert.equal(new Set(grid.placements.map(p=>p.assetId)).size,120);
  assert.deepEqual(new Set(grid.placements.map(p=>p.assetId)),new Set(files.map(a=>a.id)));
  assert.ok(grid.placements.every(p=>p.x>=0&&p.y>=12.5&&p.width>0&&p.height>0));
  assert.ok(grid.placements.every(p=>p.x+p.width<=100&&p.y+p.height<=94));
  assert.equal(planListingPlacements(3,files,{count:80}).length,120,
    'user 80-of-120 setting must never truncate Complete Collection');
  assert.equal(planListingPlacements(3,files,{assetIds:files.slice(0,80).map(x=>x.id)}).length,120,
    'explicit 80-of-120 selection must never truncate Complete Collection');
});
test('03 full catalog works for small and uneven collection sizes without missing or invented items',()=>{
  for(const n of [1,2,7,17,38,80,119,120,121,238]){
    const files=original(n);
    const plan=planCompleteCollectionCatalog(files);
    assert.equal(plan.placements.length,n);
    assert.equal(plan.columns*plan.rows>=n,true);
    assert.ok(plan.columns*(plan.rows-1)<n);
    assert.equal(new Set(plan.placements.map(x=>x.assetId)).size,n);
    assert.ok(plan.placements.every(x=>x.width>=1&&x.height>=1),String(n));
  }
});
test('approved Complete Collection requires exact current inventory, no AI image substitutes',()=>{
  const files=original(120);
  const valid=savedCatalog(files);
  assert.equal(completeCatalogMatchesInventory(valid,files),true);
  assert.equal(isSquareListingApproved(valid),true);
  assert.equal(completeCatalogMatchesInventory({...valid,placements:valid.placements.slice(0,80)},files),false);
  assert.equal(completeCatalogMatchesInventory({...valid,catalogAssetIds:valid.catalogAssetIds.slice(0,80)},files),false);
  assert.equal(completeCatalogMatchesInventory({...valid,catalogExpectedCount:80},files),false);
  assert.equal(completeCatalogMatchesInventory({...valid,aiGeneratedFullCover:true},files),false);
  assert.equal(completeCatalogMatchesInventory(valid,original(121)),false);
  assert.equal(completeCatalogMatchesInventory(valid,original(119)),false);
  assert.equal(isSquareListingApproved({...valid,catalogAssetIds:undefined}),false);
  assert.equal(isSquareListingApproved({...valid,aiGeneratedFullCover:true}),false);
});
test('browser draws entire 03 catalog from source image pixels with no AI calls, fails on missing originals',()=>{
  const renderer=ui.slice(ui.indexOf('async function composeCompleteCollectionCatalog('),
    ui.indexOf('/** Save an AI-generated full cover as JPG'));
  assert.match(renderer,/planCompleteCollectionCatalog\(originals\)/);
  assert.match(renderer,/for\(let i=0;i<placements\.length;i\+\+\)/);
  assert.match(renderer,/imageFromUrl\(source\.imageUrl\)/);
  assert.match(renderer,/ctx\.drawImage\(image,bounds\.sx/);
  assert.match(renderer,/Could not load original clipart/);
  assert.match(renderer,/placements\.length\+' ORIGINAL CLIPART ILLUSTRATIONS'/);
  assert.doesNotMatch(renderer,/OpenAI|createArtworkContactSheets|form\.append\('image\[\]'/);
  const generate=ui.slice(ui.indexOf('const generateCompleteCollection = async () =>'),
    ui.indexOf('/** One paid image edit:'));
  assert.match(generate,/composeCompleteCollectionCatalog\(assets,copy\.title/);
  assert.match(generate,/catalogAssetIds:catalog\.assetIds/);
  assert.match(generate,/catalogExpectedCount:assets\.length/);
  assert.match(generate,/aiGeneratedFullCover:false/);
  assert.doesNotMatch(generate,/send\(\{action:'generate-concept'|aiFirstSampleIndices|backgroundPrompt/);
  assert.match(ui,/if \(step===3\) return generateCompleteCollection\(\)/);
  assert.match(ui,/step!==3 && !promptsReady/);
});
test('03 source picker is locked and user sees 120/120 completion status without AI costs',()=>{
  assert.match(ui,/value=\{step===3\?'complete-catalog':compositionMode\}/);
  assert.match(ui,/Complete Catalog — every original exactly once/);
  assert.match(ui,/disabled=\{!!working \|\| step===3\}/);
  assert.match(ui,/ALL ORIGINAL COLLECTION CLIPARTS — LOCKED/);
  assert.match(ui,/step===3 \? 'Generate Complete Collection — '/);
  assert.match(ui,/no AI cost/);
  assert.match(ui,/data-complete-collection-required="true"/);
  assert.match(ui,/completeCatalogMatchesInventory\(current,assets\)/);
  assert.match(ui,/step===3 && !completeCatalogMatchesInventory\(current,assets\)/);
});
test('server rejects AI-only 03, blocks approval and export of an incomplete collection',()=>{
  assert.match(api,/if \(input\.number===3\)\s*return bad\('Complete Collection is generated directly/);
  assert.match(api,/completeCatalogMatchesInventory\(\{/);
  assert.match(api,/Complete Collection approval requires every current original clipart/);
  assert.match(api,/!completeCatalogMatchesInventory\(selected\[2\],project\.characters\|\|\[\]\)/);
  assert.match(api,/catalogAssetIds,catalogExpectedCount/);
  assert.equal(LISTING_IMAGE_SPECS[2].title,'Complete Collection');
  assert.match(LISTING_IMAGE_SPECS[2].purpose,/every original collection clipart exactly once/);
});
