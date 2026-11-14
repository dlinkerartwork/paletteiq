import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { originalAssets, planListingPlacements } from '../lib/etsy-listing-image-plan.ts';
import {
  LISTING_TEXT_SAFE_BOTTOM, fitListingPlacementsBelowText,
  isListingPlacementTextSafe, duplicateListingAssetIds
} from '../lib/listing-text-safe.ts';

const studio = readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const route = readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');

const assets = Array.from({length:90},(_,i)=>({
  id:'asset'+i,name:'Classic original artwork '+i,
  imageUrl:'/api/assets?assetId='+i+'&cache='+i
}));

test('all dense gallery originals fit BELOW protected text without asset loss',()=>{
  const planned = planListingPlacements(2,assets);
  const fitted = fitListingPlacementsBelowText(planned);
  assert.equal(fitted.length,90);
  assert.ok(fitted.every(p=>isListingPlacementTextSafe(p)));
  assert.ok(fitted.every(p=>p.y >= LISTING_TEXT_SAFE_BOTTOM));
  assert.equal(new Set(fitted.map(p=>p.assetId)).size,90);
});
test('safe mockup placements do not drift',()=>{
  const original = planListingPlacements(10,assets);
  assert.deepEqual(fitListingPlacementsBelowText(original),original);
});
test('rotation bounding box cannot protrude into text zone',()=>{
  const collision={assetId:'a',x:35,y:38,width:35,height:25,rotation:15};
  assert.equal(isListingPlacementTextSafe(collision),false);
  assert.ok(isListingPlacementTextSafe({...collision,y:44}));
});
test('duplicate image identities preserve distinct assetId query values',()=>{
  const chosen=originalAssets([
    {id:'a',name:'Classic Red Sedan',imageUrl:'/api/assets?assetId=one&cache=12'},
    {id:'b',name:'Classic Blue Sedan',imageUrl:'/api/assets?assetId=two&cache=12'},
    {id:'c',name:'Classic Blue Sedan copy (2)',imageUrl:'/api/assets?assetId=other&cache=3'},
    {id:'d',name:'Distinct Road Sign',imageUrl:'/api/assets?assetId=one&cache=99'}
  ]);
  assert.deepEqual(chosen.map(x=>x.id),['a','b']);
});
test('duplicate original asset ids are never permitted in one layout',()=>{
  assert.deepEqual(duplicateListingAssetIds([
    {assetId:'a',x:4,y:40,width:10,height:10},
    {assetId:'a',x:25,y:40,width:10,height:10},
    {assetId:'b',x:35,y:40,width:10,height:10}
  ]),['a']);
});
test('all seven experimental selectors are absent from Listing Image Studio',()=>{
  for(const label of ['TYPOGRAPHY','COVER ART STYLE','BACKGROUND STYLE','DESIGN BOLDNESS',
    'CLIPART HIERARCHY','DECORATION INTENSITY','REFERENCE INTERPRETATION'])
    assert.doesNotMatch(studio,new RegExp('>'+label+'</span>'));
  assert.doesNotMatch(route,/settings\?\.(?:coverStyle|backgroundStyle|intensity|boldness|hierarchy|referenceStyle)/);
  assert.match(studio,/fitListingPlacementsToReference\(number,planListingPlacements/);
  assert.match(studio,/isListingPlacementSafe\(p,step/);
  assert.match(studio,/disabled=\{a\.id !== selected\.assetId && positions\.some/);
  assert.match(route,/GALLERY TEXT SAFETY/);
  assert.match(route,/REFERENCE-LED CENTRAL HERO COMPOSITION/);
  assert.match(route,/Clipart must be distinct and stay below the protected title\/subtitle area/);
});
