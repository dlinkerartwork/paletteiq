import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  aiFirstListingPrompt, aiFirstLayoutArchetype,
  aiFirstDetailedReferenceCount, AI_FIRST_LAYOUT_ARCHETYPES,
  AI_FIRST_MAX_REFERENCE_SHEETS
} from '../lib/etsy-listing-ai-first.ts';
import {LISTING_IMAGE_SPECS} from '../lib/etsy-listing-image-plan.ts';
const route=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const studio=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');

const data={theme:'Vintage Road Trip',title:'The Complete Collection',subtitle:'',badge:'',
  selectedCount:120,collectionCount:120,
  sourceAssets:[
    {name:'Vintage camper van',category:'Vehicles'},
    {name:'Coral convertible car',category:'Vehicles'},
    {name:'Route 66 road sign',category:'Road Signs'},
    {name:'Travel suitcase',category:'Accessories'}
  ],
  approvedCoverStyle:'Approved Main Cover: green teal and warm cream palette only'
};

test('each supporting Etsy listing tile gets a unique structural archetype, not only different text',()=>{
  assert.equal(LISTING_IMAGE_SPECS.length,15);
  const names=Array.from({length:14},(_,i)=>AI_FIRST_LAYOUT_ARCHETYPES[i+2].name);
  assert.equal(new Set(names).size,14);
  for(let n=2;n<=15;n++){
    const a=AI_FIRST_LAYOUT_ARCHETYPES[n];
    assert.ok(a.layout.length>=180,'layout needs real visual direction: '+n);
    assert.ok(a.forbidden.length>=60,'must explicitly forbid wrong structure: '+n);
    assert.match(aiFirstListingPrompt(n,data),/NON-NEGOTIABLE VISUAL STRUCTURE/);
    assert.ok(aiFirstListingPrompt(n,data).includes(a.name));
    assert.ok(aiFirstListingPrompt(n,data).includes(a.layout));
    assert.ok(aiFirstListingPrompt(n,data).includes(a.forbidden));
    assert.match(aiFirstListingPrompt(n,data),/preserve each reference image character silhouette/i);
  }
  assert.throws(()=>aiFirstLayoutArchetype(1));
  assert.throws(()=>aiFirstLayoutArchetype(16));
  assert.equal(aiFirstDetailedReferenceCount(1),5);
});

test('02 overview has LARGE showcases above a MINI GALLERY, not the 03 catalogue or cover',()=>{
  const p=aiFirstListingPrompt(2,data);
  assert.match(p,/TWO-TIER MERCHANDISING PAGE/);
  assert.match(p,/FOUR TO SIX prominently sized/);
  assert.match(p,/5–8 narrow columns/);
  assert.match(p,/TOP: a slim heading/);
  assert.match(p,/LOWER:/);
  assert.match(p,/DO NOT copy Main Cover header bands/);
  assert.doesNotMatch(p,/MAXIMUM-COVERAGE FULL CATALOG GRID/);
});

test('03 complete collection prioritizes dense 10–12-column 8–10-row catalogue, with tiny title',()=>{
  const p=aiFirstListingPrompt(3,data);
  assert.match(p,/TRUE COMPLETE-COLLECTION INVENTORY BOARD/);
  assert.match(p,/TEN TO TWELVE COLUMNS by EIGHT TO TEN ROWS/);
  assert.match(p,/75–85%/);
  assert.match(p,/NO 4–6 giant featured images/);
  assert.match(p,/do not invent entries/);
});

test('04 best elements shows two very large anchors and a small supporting gallery',()=>{
  const p=aiFirstListingPrompt(4,data);
  assert.match(p,/TWO very large, detailed hero illustrations/);
  assert.match(p,/FOUR TO EIGHT secondary/);
  assert.match(p,/NO dense small catalog grid/);
  assert.match(p,/NO giant dark title panel/);
});

test('05–15 each have different layouts for category, features, details, physical mockups, educational guide and finale',()=>{
  const expect={
    5:/TWO TO FIVE separate titled compartments/,
    6:/split editorial infographic/,
    7:/detail-led close-up/,
    8:/sheet of paper with several distinct die-cut/,
    9:/ONE T-shirt or sweatshirt/,
    10:/ONE believable accessory product/,
    11:/overhead or three-quarter photographic flat-lay/,
    12:/overhead craft desk or scrapbook/,
    13:/informational page/,
    14:/THREE or FOUR numbered steps/,
    15:/fresh asymmetrical cluster/
  };
  for(const [number,pattern] of Object.entries(expect))
    assert.match(aiFirstListingPrompt(Number(number),data),pattern);
});

test('approved Main Cover is ONLY text-derived style context, NEVER fed as an image/layout ref',()=>{
  assert.match(route,/studioV11Context\(project,input\.number\)/);
  assert.match(route,/observedSourceStyle/);
  assert.match(route,/palette:observed\?\.palette/);
  assert.doesNotMatch(route,/approved-main-cover-style-reference-ONLY\.jpg/);
  assert.match(route,/NEVER pass approved Main Cover pixels as an input image/);
  assert.match(route,/aiFirstLayoutArchetype\(input\.number\)/);
  assert.match(route,/Main Cover header, plaque, large top title band/);
  assert.match(studio,/data-listing-layout-archetype=\{AI_FIRST_LAYOUT_ARCHETYPES\[step\]\.name\}/);
});

test('image-edit request includes extra real full-detail originals on top of source contact sheets',()=>{
  assert.match(route,/const detailCandidates=aiFirstSampleIndices\(sampled\.length,/);
  assert.match(route,/originalAssetStorageKey\(asset,user\.userId\)/);
  assert.match(route,/await getRecoverableAsset\(bucket\(\),source\.key\)/);
  assert.match(route,/HIGH-DETAIL-ORIGINAL-/);
  assert.match(route,/form\.append\('image\[\]'/);
  assert.match(route,/new Blob\(\[new Uint8Array\(bytes\)\]/);
  assert.match(route,/detailedOriginalReferencesIncluded/);
  assert.match(route,/16-sheets\.length/);
  assert.ok(AI_FIRST_MAX_REFERENCE_SHEETS+aiFirstDetailedReferenceCount(2)<=16);
  assert.ok(aiFirstDetailedReferenceCount(3)<aiFirstDetailedReferenceCount(4));
  assert.match(studio,/full-detail original PNG\/JPG files alongside contact sheets/);
  assert.match(studio,/not a guarantee of identical pixels/);
});

test('the final prompt forbids fabricated or blended art without promising pixel identity',()=>{
  const p=aiFirstListingPrompt(4,data);
  assert.match(p,/Do not invent characters, blend parts from two references/);
  assert.match(p,/distinctive identity/);
  assert.match(p,/pixel-exact copying is not guaranteed/);
  assert.match(route,/Do not generate new characters or objects, merge two originals/);
});
