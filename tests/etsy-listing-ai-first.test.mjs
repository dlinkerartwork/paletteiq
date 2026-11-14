import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AI_FIRST_MAX_REFERENCE_SHEETS, AI_FIRST_MAX_REFERENCE_ASSETS,
  aiFirstSampleIndices, aiFirstConceptPrompt, aiFirstCleanPlatePrompt
} from '../lib/etsy-listing-ai-first.ts';
import { planListingPlacements, validListingPlacement } from '../lib/etsy-listing-image-plan.ts';

const api=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const plan=readFileSync(new URL('../lib/etsy-listing-image-plan.ts',import.meta.url),'utf8');

test('AI-first is opt-in and leaves both old composition modes available',()=>{
  assert.match(plan,/ListingCompositionMode = 'free' \| 'structured' \| 'ai-first'/);
  assert.match(ui,/<option value="ai-first">AI-First Composition/);
  assert.match(ui,/<option value="free">Free Composition/);
  assert.match(ui,/<option value="structured">Structured/);
  assert.match(api,/input\.action === 'generate-concept' \|\| input\.action === 'clean-concept'/);
  assert.match(api,/mode === 'ai-first'/);
});

test('the visual concept is built with source reference image edits, NEVER pre-layout coordinates or raw ZIP',()=>{
  const prompt=aiFirstConceptPrompt({theme:'Cottage Flowers',title:'Spring Flowers',subtitle:'Watercolor Botanical',badge:'80 Flowers',selectedCount:120});
  assert.match(prompt,/full-cover concept image|FULL premium thumbnail CONCEPT/i);
  assert.match(prompt,/MAIN TITLE: "Spring Flowers"/);
  assert.match(prompt,/SUBTITLE: "Watercolor Botanical"/);
  assert.match(prompt,/BADGE \(empty means do not draw one\): "80 Flowers"/);
  assert.match(prompt,/No prescribed grid, fonts, hero count/);
  assert.doesNotMatch(prompt,/\bx\s*:\s*[0-9]|\by\s*:\s*[0-9]|width:|height:/);
  assert.equal(AI_FIRST_MAX_REFERENCE_SHEETS,8);
  assert.equal(AI_FIRST_MAX_REFERENCE_ASSETS,192);
  const sampled=aiFirstSampleIndices(120);
  assert.equal(sampled.length,120);
  assert.deepEqual(sampled,[...Array(120).keys()]);
  const many=aiFirstSampleIndices(1500);
  assert.equal(many.length,192);
  assert.ok(many[0]>0 && many.at(-1)<1500);
  assert.equal(new Set(many).size,many.length);
  assert.match(api,/https:\/\/api\.openai\.com\/v1\/images\/edits/);
  assert.match(api,/form\.append\('image\[\]'/);
  assert.match(api,/selectedAssetIds/);
  assert.match(api,/referenceSheets/);
  assert.match(ui,/aiFirstSampleIndices\(positions\.length\)/);
  assert.match(ui,/createArtworkContactSheets\(sample, assets\)/);
  assert.match(ui,/selectedAssetIds:positions\.map\(p=>p\.assetId\)/);
  assert.match(ui,/backgroundPrompt:promptDraft!\.backgroundPrompt/);
});

test('concept is separated from typography plate and final JPG composes ONLY original PNGs',()=>{
  const p=aiFirstCleanPlatePrompt('Fresh Flowers','Watercolor Blooms','');
  assert.match(p,/REMOVE EVERY standalone illustrated clipart object/);
  assert.match(p,/Preserve these exact requested words/);
  assert.match(p,/MAIN TITLE: "Fresh Flowers"/);
  assert.match(p,/Do not add replacement illustrations/);
  assert.match(api,/conceptUrl\?: string/);
  assert.match(api,/const conceptReference =|let conceptReference/);
  assert.match(api,/conceptReference \? \[\{type:'input_image',image_url:conceptReference\}\]/);
  assert.match(api,/clean-concept/);
  assert.match(api,/storeListingPng\(user\.userId,input\.projectId,cleaned\.bytes\)/);
  assert.match(ui,/data-ai-first-concept-preview="true"/);
  assert.match(ui,/generateAiFirstConcept/);
  assert.match(ui,/finalizeAiFirstConcept/);
  assert.match(ui,/const cleaned = await send\(/);
  assert.match(ui,/await arrangeWithAI\(cleaned\.backgroundUrl,positions/);
  assert.match(ui,/await renderAndSave\(cleaned\.backgroundUrl,arranged\.placements/);
  assert.match(ui,/const file = await compose\(background, layout, assets\)/);
  assert.match(api,/rejected\.conceptUrl/);
});

test('AI-first reference cap samples only creative vision, NOT the number of originals pasted into final JPG',()=>{
  const source=Array.from({length:400},(_,i)=>({id:'id-'+i,name:'Original '+i,imageUrl:'/a/'+i+'.png'}));
  const placements=planListingPlacements(1,source,{count:400});
  assert.equal(placements.length,400);
  assert.equal(new Set(placements.map(p=>p.assetId)).size,400);
  assert.ok(placements.every(p=>validListingPlacement(p,1)));
  assert.match(ui,/for \(let offset = 0; offset < initial\.length; offset \+= batchSize\)/);
  assert.match(ui,/All selected originals remain eligible|ALL selected originals remain eligible/);
});
