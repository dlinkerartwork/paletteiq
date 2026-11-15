import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LISTING_IMAGE_SPECS} from '../lib/etsy-listing-image-plan.ts';
import {aiFirstConceptPrompt, aiFirstListingPrompt, AI_FIRST_LISTING_IMAGE_BRIEFS} from '../lib/etsy-listing-ai-first.ts';

const api=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const studio=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const designer=readFileSync(new URL('../components/thumbnail-designer.tsx',import.meta.url),'utf8');
const sample={
  theme:'Woodland Christmas',style:'Vintage storybook watercolor',palette:'forest green, cranberry red',
  texture:'soft brushed paper',title:'Woodland Christmas',subtitle:'CLIPART BUNDLE',
  badge:'80 PNGs',selectedCount:20,collectionCount:80,
  sourceAssets:[{name:'woodland fox',category:'Animals'},{name:'pine cone',category:'Winter accents'},
    {name:'festive hedgehog',category:'Animals'}]
};

test('all 15 Etsy listing image types have distinct user-facing AI-first prompts',()=>{
  assert.equal(LISTING_IMAGE_SPECS.length,15);
  assert.deepEqual(Object.keys(AI_FIRST_LISTING_IMAGE_BRIEFS).map(Number).sort((a,b)=>a-b),
    LISTING_IMAGE_SPECS.slice(1).map(x=>x.number));
  const prompts=LISTING_IMAGE_SPECS.map(spec=>aiFirstListingPrompt(spec.number,sample));
  assert.equal(new Set(prompts).size,15);
  for(let i=0;i<prompts.length;i++){
    assert.match(prompts[i],/1024/);
    assert.match(prompts[i],/Woodland Christmas/);
    assert.match(prompts[i],/CLIPART BUNDLE/);
    assert.match(prompts[i],/80 PNGs/);
    if(i===0)continue;
    assert.match(prompts[i],new RegExp(LISTING_IMAGE_SPECS[i].title.replace(/[.*+?^$()|[\]{}]/g,'\\$&'),'i'));
    assert.match(prompts[i],/not Main Cover|NOT Main Cover/);
    assert.doesNotMatch(prompts[i],/Approximately 18–25 illustrations can work well/);
    assert.match(prompts[i],/complete image in one creative pass/);
  }
  assert.equal(prompts[0],aiFirstConceptPrompt(sample));
  assert.match(prompts[0],/rich, abundant collage/i);
});

test('overview, full gallery, highlights, categories and details have distinct visual structures',()=>{
  const p=n=>aiFirstListingPrompt(n,sample);
  assert.match(p(2),/broad, representative assortment/);
  assert.match(p(3),/dense mosaic/);
  assert.match(p(4),/one.*small set|small set/);
  assert.match(p(5),/category metadata/);
  assert.match(p(6),/do not invent dimensions, resolution, DPI/);
  assert.match(p(7),/macro-detail study/);
  assert.match(p(13),/factual contents validated/);
  assert.match(p(14),/numbered educational infographic/);
  assert.match(p(15),/distinct from the Main Cover/);
  assert.doesNotMatch(p(3),/Create a rich, abundant collage featuring original illustrations from the supplied/);
});

test('mockup types 08–12 are explicitly examples, not included physical products',()=>{
  for(const id of [8,9,10,11,12]){
    const prompt=aiFirstListingPrompt(id,sample);
    assert.match(prompt,/mockup|EXAMPLE/i);
    assert.match(prompt,/not included|not an included|not a promise|not imply|only/i);
  }
  assert.match(aiFirstListingPrompt(8,sample),/sticker-sheet APPLICATION MOCKUP/);
  assert.match(aiFirstListingPrompt(9,sample),/T-shirt or sweatshirt/);
  assert.match(aiFirstListingPrompt(10,sample),/tote bag, ceramic mug or tumbler/);
  assert.match(aiFirstListingPrompt(11,sample),/packaging or gift-label/);
  assert.match(aiFirstListingPrompt(12,sample),/scrapbook, planner spread or practical DIY craft/);
});

test('prompt depends on real collection, selected source descriptions and exact text',()=>{
  const changed={...sample,theme:'Tropical Flowers',title:'Tropical Floral Clipart',
    subtitle:'ISLAND BOTANICALS',badge:'125 PNGs',sourceAssets:[{name:'hibiscus flower',category:'Flowers'}]};
  const prompt=aiFirstListingPrompt(5,changed);
  assert.match(prompt,/Tropical Flowers/);
  assert.match(prompt,/Tropical Floral Clipart/);
  assert.match(prompt,/ISLAND BOTANICALS/);
  assert.match(prompt,/125 PNGs/);
  assert.match(prompt,/hibiscus flower/);
  assert.doesNotMatch(prompt,/woodland fox|festive hedgehog|cranberry-red script/);
  assert.throws(()=>aiFirstListingPrompt(0,sample));
  assert.throws(()=>aiFirstListingPrompt(16,sample));
});

test('Etsy Clipart Listing Studio routes each tile to matching prompt without changing Thumbnail Designer',()=>{
  assert.match(api,/const prompt = mode === 'ai-first'\s*\? aiFirstListingPrompt\(input\.number,/);
  assert.match(api,/const creativePrompt=input\.backgroundPrompt\?\.trim\(\) \|\| aiFirstListingPrompt\(input\.number,/);
  assert.match(api,/LISTING_IMAGE_SPECS\[input\.number-1\]\.title/);
  assert.match(studio,/action:'preview-prompt', projectId, number:step/);
  assert.match(studio,/value=\{step===3\?'complete-catalog':compositionMode\}/);
  assert.match(studio,/<option value="ai-first">AI-First Composition/);
  assert.doesNotMatch(studio,/\!\(step >= 8 && step <= 12\) && <option value="ai-first"/);
  assert.match(studio,/spec\.title\.toUpperCase\(\)\+' CREATIVE PROMPT'/);
  assert.match(studio,/Generate '\+spec\.title\+' \(OpenAI paid\)'/);
  assert.doesNotMatch(designer,/aiFirstListingPrompt|AI_FIRST_LISTING_IMAGE_BRIEFS/);
});
