import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AI_FIRST_MAX_REFERENCE_SHEETS, AI_FIRST_MAX_REFERENCE_ASSETS,
  aiFirstSampleIndices, aiFirstConceptPrompt, aiFirstBackgroundPrompt
} from '../lib/etsy-listing-ai-first.ts';
import {planListingPlacements, validListingPlacement} from '../lib/etsy-listing-image-plan.ts';

const api=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const plan=readFileSync(new URL('../lib/etsy-listing-image-plan.ts',import.meta.url),'utf8');

test('AI-first is optional, original Free and Structured modes remain',()=>{
  assert.match(plan,/ListingCompositionMode = 'free' \| 'structured' \| 'ai-first'/);
  assert.match(ui,/<option value="ai-first">AI-First Composition/);
  assert.match(ui,/<option value="free">Free Composition/);
  assert.match(ui,/<option value="structured">Structured/);
  assert.match(api,/if \(input\.action === 'generate-concept'\)/);
  assert.doesNotMatch(api,/input\.action === 'clean-concept'/);
});

test('source-original reference boards guide a real JSON art director, no starting coordinates and no image redraw',()=>{
  const prompt=aiFirstConceptPrompt({theme:'Woodland Christmas',title:'Woodland Christmas',subtitle:'CLIPART BUNDLE',badge:'80 PNGs',selectedCount:120});
  assert.match(prompt,/Main title: "Woodland Christmas"/);
  assert.match(prompt,/Subtitle: "CLIPART BUNDLE"/);
  assert.match(prompt,/Badge: "80 PNGs"/);
  assert.match(prompt,/no fixed number of objects/i);
  assert.match(prompt,/return JSON with "chosenIndices"/i);
  assert.doesNotMatch(prompt,/\bx\s*:\s*\d|\by\s*:\s*\d|width:|height:/);
  assert.equal(AI_FIRST_MAX_REFERENCE_SHEETS,8);
  assert.equal(AI_FIRST_MAX_REFERENCE_ASSETS,192);
  assert.deepEqual(aiFirstSampleIndices(120),Array.from({length:120},(_,i)=>i));
  const sampled=aiFirstSampleIndices(1500);
  assert.equal(sampled.length,192);
  assert.equal(new Set(sampled).size,192);
  assert.match(ui,/createArtworkContactSheets\(sample,assets\)/);
  assert.match(ui,/sampledAssetIds:sample\.map\(p=>p\.assetId\)/);
  assert.match(api,/chosenIndices/);
  assert.match(api,/const chosenIds=\[\.\.\.new Set/);
  assert.match(api,/https:\/\/api\.openai\.com\/v1\/responses/);
  assert.doesNotMatch(api,/https:\/\/api\.openai\.com\/v1\/images\/edits/);
});

test('image generation receives ONLY text, no source artwork, creates no characters or placeholders',()=>{
  const prompt=aiFirstBackgroundPrompt({
    userDirection:'Rich organic collage with many woodland animals, artistic fonts and room for original art',
    creativeBrief:'Storybook warmth with a forest green and red title, beautiful asymmetry and breathing room',
    title:'Woodland Christmas',subtitle:'CLIPART BUNDLE',badge:'80 PNGs'
  });
  assert.match(prompt,/ABSOLUTE PRODUCT ARTWORK RULE/);
  assert.match(prompt,/DO NOT draw, recreate, trace, hallucinate, regenerate, imitate or include ANY standalone illustrated clipart/);
  assert.match(prompt,/Include EXACT MAIN TITLE: "Woodland Christmas"/);
  assert.match(prompt,/Include EXACT SUBTITLE: "CLIPART BUNDLE"/);
  assert.match(prompt,/Include EXACT BADGE \(empty means omit\): "80 PNGs"/);
  assert.match(prompt,/no required font, font size, text position, background style/);
  assert.match(api,/const backgroundPrompt=aiFirstBackgroundPrompt/);
  assert.match(api,/fetch\('https:\/\/api\.openai\.com\/v1\/images\/generations'/);
  assert.match(api,/body:JSON\.stringify\(\{model,prompt:backgroundPrompt,size:'1024x1024'/);
  assert.match(api,/backgroundUrl=await storeListingPng/);
  assert.doesNotMatch(api,/form\.append\('image\[\]'/);
});

test('final JPG is composed with exact source PNGs chosen by Vision, permitting original repetition',()=>{
  assert.match(ui,/data-ai-first-background-preview="true"/);
  assert.match(ui,/finalizeAiFirstConcept/);
  assert.match(ui,/sourcePositions=compositionMode === 'ai-first'/);
  assert.match(ui,/current\.selectedSourceIds/);
  assert.match(ui,/current\.creativeBrief/);
  assert.match(ui,/const arranged=await arrangeWithAI\(current\.backgroundUrl,shortlisted/);
  assert.match(ui,/await renderAndSave\(current\.backgroundUrl,arranged\.placements/);
  assert.match(ui,/const file = await compose\(background, layout, assets\)/);
  assert.match(ui,/ctx\.drawImage\(image, bounds\.sx, bounds\.sy/);
  assert.match(api,/mode !== 'ai-first' && seen\.has\(p\.assetId\)/);
  assert.match(api,/mode === 'ai-first'\s*\? candidates\.length >= fallback\.length/);
  assert.match(api,/selectedSourceIds/);
  assert.match(api,/creativeBrief/);
  assert.doesNotMatch(ui,/AI-drawn placeholders|temporary AI-drawn placeholders/);
});

test('user only needs original clipart and title, subtitle, badge; no fixed lettering/background choices',()=>{
  assert.doesNotMatch(ui,/ARTISTIC LETTERING SIZE/);
  assert.doesNotMatch(ui,/BACKGROUND STYLE \(THEME-MATCHED\)/);
  assert.doesNotMatch(ui,/listing-lettering-scale|listing-background-style/);
  assert.doesNotMatch(ui,/setTextScale|setBackgroundStyle/);
  assert.match(ui,/id="listing-image-title"/);
  assert.match(ui,/id="listing-image-subtitle"/);
  assert.match(ui,/id="listing-image-badge"/);
  assert.match(ui,/id="listing-background-prompt"/);
  assert.match(ui,/id="listing-vision-prompt"/);
  assert.match(ui,/compositionMode === 'ai-first'[\s\S]*?count:assets\.length/);
  const sources=Array.from({length:400},(_,i)=>({id:'id-'+i,name:'Original '+i,imageUrl:'/a/'+i+'.png'}));
  const placements=planListingPlacements(1,sources,{count:400});
  assert.equal(placements.length,400);
  assert.ok(placements.every(p=>validListingPlacement(p,1)));
  assert.match(ui,/for \(let offset = 0; offset < initial\.length; offset \+= batchSize\)/);
});
