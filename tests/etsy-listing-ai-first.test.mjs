import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AI_FIRST_MAX_REFERENCE_SHEETS,AI_FIRST_MAX_REFERENCE_ASSETS,
  aiFirstSampleIndices,aiFirstConceptPrompt} from '../lib/etsy-listing-ai-first.ts';
import {planListingPlacements,validListingPlacement} from '../lib/etsy-listing-image-plan.ts';

const api=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const ui=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const plan=readFileSync(new URL('../lib/etsy-listing-image-plan.ts',import.meta.url),'utf8');

test('AI-first is distinct from original Free and Structured modes',()=>{
  assert.match(plan,/ListingCompositionMode = 'free' \| 'structured' \| 'ai-first'/);
  assert.match(ui,/<option value="ai-first">AI-First Composition/);
  assert.match(ui,/<option value="free">Free Composition/);
  assert.match(ui,/<option value="structured">Structured/);
  assert.match(api,/input\.action === 'generate-concept'/);
  assert.doesNotMatch(api,/input\.action === 'clean-concept'/);
});

test('user premium creative prompt creates a COMPLETE image, not geometry/JSON plan',()=>{
  const p=aiFirstConceptPrompt({theme:'Woodland Christmas',title:'Woodland Christmas',
    subtitle:'CLIPART BUNDLE',badge:'80 PNGs',selectedCount:120});
  for(const section of ['CANVAS','ARTWORK & COMPOSITION','TYPOGRAPHY','ARTISTIC DIRECTION',
    'CREATIVE FREEDOM','FINAL QUALITY','SOURCE CLIPART REQUIREMENTS','FINAL IMAGE GENERATION'])
    assert.ok(p.includes('**'+section+'**'),section);
  assert.match(p,/Main title: "Woodland Christmas"/);
  assert.match(p,/Subtitle: "CLIPART BUNDLE"/);
  assert.match(p,/Badge: "80 PNGs"/);
  assert.match(p,/Generate the complete finished 1024 × 1024 Etsy cover directly/);
  assert.match(p,/pixel-identical copying is not guaranteed/);
  assert.doesNotMatch(p,/return JSON with "chosenIndices"|DO NOT render a new image in this Vision step/);
  assert.doesNotMatch(p,/\bx\s*:\s*\d|\by\s*:\s*\d|width:|height:/);
  assert.equal(AI_FIRST_MAX_REFERENCE_SHEETS,8);
  assert.equal(AI_FIRST_MAX_REFERENCE_ASSETS,192);
  assert.deepEqual(aiFirstSampleIndices(120),Array.from({length:120},(_,i)=>i));
  const sampled=aiFirstSampleIndices(1500);
  assert.equal(sampled.length,192);
  assert.equal(new Set(sampled).size,192);
});

test('OpenAI gets reference images and exact title, badge in a SINGLE paid images/edits request',()=>{
  assert.match(ui,/createArtworkContactSheets\(sample,assets\)/);
  assert.match(ui,/sampledAssetIds:sample\.map\(p=>p\.assetId\)/);
  assert.match(api,/const fullPrompt = \[/);
  assert.match(api,/MAIN TITLE: '\+JSON\.stringify\(title\)/);
  assert.match(api,/SUBTITLE: '\+JSON\.stringify\(subtitle\)/);
  assert.match(api,/BADGE: '\+JSON\.stringify\(badge\)/);
  assert.match(api,/https:\/\/api\.openai\.com\/v1\/images\/edits/);
  assert.match(api,/form\.append\('image\[\]'/);
  assert.match(api,/form\.append\('prompt',fullPrompt\)/);
  const action=api.slice(api.indexOf("if (input.action === 'generate-concept')"),
    api.indexOf("if (input.action === 'layout')"));
  assert.doesNotMatch(action,/https:\/\/api\.openai\.com\/v1\/responses/);
  assert.doesNotMatch(action,/chosenIndices|images\/generations|aiFirstBackgroundPrompt/);
  assert.match(action,/backgroundUrl=await storeListingPng/);
});

test('one-step JPG export uses AI full-cover pixels; no coordinate map or original PNG overlay',()=>{
  assert.match(ui,/const file=await flattenAiFullCover\(response\.backgroundUrl\)/);
  assert.match(ui,/const renderedImageUrl=await upload\(projectId,step,file/);
  assert.match(ui,/aiGeneratedFullCover:true,placements:\[\]/);
  assert.match(ui,/No PNG positioning, mapping or post-compositing/);
  const action=ui.slice(ui.indexOf('const generateAiFirstConcept = async () =>'),
    ui.indexOf('const generate = async () =>'));
  assert.doesNotMatch(action,/arrangeWithAI\(|renderAndSave\(|compose\(|finalizeAiFirstConcept/);
  assert.match(ui,/data-ai-first-full-cover-notice="true"/);
  assert.doesNotMatch(ui,/Build final JPG with original PNGs|data-ai-first-background-preview/);
  assert.match(ui,/compositionMode !== 'ai-first' && step!==3 && <section/);
  assert.match(plan,/aiGeneratedFullCover\?: boolean/);
  assert.match(api,/!value\.aiGeneratedFullCover/);
  assert.match(api,/record\.aiGeneratedFullCover/);
  assert.match(api,/\[String\(input\.number\)\]:'ai-first'/);
});

test('AI-first exposes source image picker, one creative prompt and no PNG placement controls',()=>{
  assert.doesNotMatch(ui,/ARTISTIC LETTERING SIZE|BACKGROUND STYLE \(THEME-MATCHED\)/);
  assert.match(ui,/id="listing-image-title"/);
  assert.match(ui,/id="listing-image-subtitle"/);
  assert.match(ui,/id="listing-image-badge"/);
  assert.match(ui,/id="listing-background-prompt"/);
  assert.match(ui,/compositionMode !== 'ai-first' && <>/);
  assert.match(ui,/Generate Full Creative Thumbnail/);
  assert.match(ui,/complete SINGLE-LAYER cover/);
  assert.match(ui,/compositionMode === 'ai-first' \|\| promptDraft\.layoutPrompt\.trim\(\)/);
  const sources=Array.from({length:400},(_,i)=>({id:'id-'+i,name:'Original '+i,
    imageUrl:'/a/'+i+'.png'}));
  const placements=planListingPlacements(1,sources,{count:400});
  assert.equal(placements.length,400);
  assert.ok(placements.every(p=>validListingPlacement(p,1)));
});
