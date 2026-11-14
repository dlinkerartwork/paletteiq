import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  listingStyleSignature, currentListingVisualStyle, listingStyleDirection
} from '../lib/etsy-listing-visual-style.ts';

const client=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const styleApi=readFileSync(new URL('../app/api/listing-style-analysis/route.ts',import.meta.url),'utf8');
const generator=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const studio=readFileSync(new URL('../app/api/studio/route.ts',import.meta.url),'utf8');

const source = [
  { id:'1',imageUrl:'/api/images/a?format=png' },
  { id:'2',imageUrl:'/api/images/b?format=png' },
  { id:'3',imageUrl:'/api/images/c?format=png' }
];
const profile = {
  signature:listingStyleSignature(source),
  medium:'hand-painted watercolor',
  palette:'cream, blush, sage',
  texture:'soft pigment granulation',
  rendering:'soft organic brush edges',
  mood:'airy botanical',
  summary:'Delicate translucent watercolor strokes with organic softly feathered edges.',
  sampleCount:3,
  analyzedAt:1
};

test('source style fingerprint uses REAL collection URLs and invalidates when any original changes',()=>{
  assert.match(profile.signature,/^visual-v1-3-/);
  assert.equal(listingStyleSignature([...source].reverse()),profile.signature);
  assert.equal(listingStyleSignature([...source,{id:'4',imageUrl:source[0].imageUrl}]),profile.signature);
  assert.notEqual(listingStyleSignature([...source,{id:'4',imageUrl:'/api/images/d?format=png'}]),profile.signature);
  assert.notEqual(listingStyleSignature([...source.slice(0,2),{id:'3',imageUrl:'/api/images/replaced?format=png'}]),profile.signature);
  assert.deepEqual(currentListingVisualStyle(profile,source),profile);
  assert.equal(currentListingVisualStyle(profile,source.slice(0,2)),null);
  assert.equal(currentListingVisualStyle(undefined,source),null);
});

test('real source style gets prioritized over fallback metadata without redrawing any clipart',()=>{
  const direction=listingStyleDirection(profile);
  assert.match(direction,/OBSERVED STYLE OF REAL SOURCE CLIPART/);
  assert.match(direction,/hand-painted watercolor/);
  assert.match(direction,/soft pigment granulation/);
  assert.match(direction,/soft organic brush edges/);
  assert.match(direction,/NONFIGURATIVE background and bespoke typography/);
  assert.match(direction,/freely vary composition/);
  assert.match(generator,/currentListingVisualStyle\(project\.listingVisualStyle, project\.characters \|\| \[\]\)/);
  assert.match(generator,/listingStyleDirection\(observed\)/);
  assert.match(generator,/CREATIVE FREEDOM/);
  assert.match(generator,/No visual sample analysis of the real collection is available/);
  assert.match(generator,/The actual collection images are NOT provided to you/);
  assert.match(generator,/Do NOT generate clipart/);
});

test('Vision style analysis is user-owned, sample-limited, validates original asset IDs and never fetches arbitrary URLs',()=>{
  assert.match(styleApi,/getChatGPTUser\(\)/);
  assert.match(styleApi,/eq\(projects\.owner, owner\)/);
  assert.match(styleApi,/originalAssets\(project\.characters \|\| \[\]\)/);
  assert.match(styleApi,/!known\.has\(sample\.assetId\)/);
  assert.match(styleApi,/seen\.has\(sample\.assetId\)/, 'validate duplicate source IDs');
  assert.match(styleApi,/samples\.length > 6/);
  assert.match(styleApi,/sample\.dataUrl\.length > 230_000/);
  assert.match(styleApi,/totalChars > 1_350_000/);
  assert.match(styleApi,/data:image\\\/jpeg;base64,/);
  assert.match(styleApi,/model:'gpt-4\.1-mini'/);
  assert.match(styleApi,/type:'input_image',image_url:sample\.dataUrl/);
  assert.match(styleApi,/Inspect the real image pixels/);
  assert.match(styleApi,/Do not copy or describe individual subjects/);
  assert.doesNotMatch(styleApi,/fetch\(sample\.(?:url|imageUrl)/);
});

test('style analysis is cached per real-art signature and protected against stale UI saves',()=>{
  assert.match(styleApi,/currentListingVisualStyle\(project\.listingVisualStyle,original\)/);
  assert.match(styleApi,/if \(saved\) return Response\.json\(\{ profile: saved, cached: true \}\)/);
  assert.match(styleApi,/if \(listingStyleSignature\(latest\.characters\|\|\[\]\) !== signature\)/);
  assert.match(styleApi,/latest\.listingVisualStyle=profile/);
  assert.match(styleApi,/getDb\(\)\.update\(projects\)/);
  assert.match(studio,/incoming as typeof incoming & \{ listingVisualStyle\?: unknown \}/);
  assert.match(client,/styleRequest\(styleApiUrl \+ '\?projectId='/);
  assert.match(client,/await ensureSourceStyle\(\)/);
  assert.match(client,/setStyleProfile\(analyzed\.profile\)/);
});

test('client sends downsampled real pixels to Vision only; generator receives style text from DB',()=>{
  assert.match(client,/async function createCollectionStyleSamples\(assets: ListingAsset\[\]\)/);
  assert.match(client,/assets\[Math\.min\(assets\.length - 1, Math\.floor\(\(i \+ 0\.5\)/);
  assert.match(client,/imageFromUrl\(asset\.imageUrl!\)/);
  assert.match(client,/const bounds = imageBounds\(image\)/);
  assert.match(client,/canvas\.width = 320; canvas\.height = 320/);
  assert.match(client,/canvas\.toDataURL\('image\/jpeg', 0\.78\)/);
  assert.match(client,/body: JSON\.stringify\(\{ projectId, samples \}\)/);
  assert.match(client,/One additional paid OpenAI Vision analysis|one additional paid OpenAI Vision analysis/);
  assert.match(client,/styleProfile\.summary/);
  assert.match(client,/setStyleWarning\(styleFallback\.trim\(\)\)/);
  assert.doesNotMatch(client,/styleSummary:\s*input/);
});

test('floating image cost panel can be dismissed, and no longer pollutes generation/result messages',()=>{
  assert.match(client,/data-listing-floating-cost="true"/);
  assert.match(client,/position: 'fixed'/);
  assert.match(client,/aria-label="Dismiss image cost notice"/);
  assert.match(client,/onClick=\{\(\) => setCostNotice\(null\)\}/);
  assert.match(client,/setCostNotice\(\{ step, model, quality, estimate: response\.costEstimate \?\? null \}\)/);
  assert.match(client,/This is not the final OpenAI invoice/);
  assert.doesNotMatch(client,/imageCostNotice/);
});
