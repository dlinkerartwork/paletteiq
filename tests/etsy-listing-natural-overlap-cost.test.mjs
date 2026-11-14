import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimateListingImageGenerationCost } from '../lib/etsy-listing-image-cost.ts';
import { planListingPlacements, curatedListingHighlights } from '../lib/etsy-listing-image-plan.ts';

const backend = readFileSync(new URL('../app/api/listing-image-studio/route.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../components/etsy-listing-image-studio.tsx', import.meta.url), 'utf8');
const pricing = readFileSync(new URL('../lib/etsy-listing-image-cost.ts', import.meta.url), 'utf8');

test('OpenAI Vision arranges actual clipart around visible lettering naturally without rigid exclusion or AI redraw', () => {
  assert.match(backend, /Read the ACTUAL title, subtitle and badge positions from the background pixels/);
  assert.match(backend, /Partial overlap near outer edges, swashes and decorative lettering is welcome/);
  assert.match(backend, /do not obscure central strokes or whole words of the main title/);
  assert.match(backend, /do not treat partial text overlap as unsafe by itself/);
  assert.match(backend, /p\.x>=0 && p\.y>=0/);
  assert.match(backend, /p\.x\+p\.width<=100 && p\.y\+p\.height<=100/);
  assert.doesNotMatch(backend, /The title and subtitle must remain unobstructed, usually in the upper 23%/);
  assert.doesNotMatch(backend, /p\.x>=0 && p\.y>=23/);
  assert.match(backend, /The actual collection images are NOT provided to you/);
  assert.match(backend, /Do NOT generate clipart/);
  assert.match(backend, /Return each listed assetId EXACTLY ONCE/);
  assert.match(client, /const file = await compose\(background, layout, assets\)/);
});

test('Main Cover uses seven varied original cliparts with artwork around edges, not ten piled in the center', () => {
  const source = Array.from({ length: 45 }, (_, i) => ({
    id: 'clipart-' + i, name: 'Art ' + i, imageUrl: '/original/' + i + '.png',
    category: ['Americana','Cars','Travel'][i % 3]
  }));
  const cover = planListingPlacements(1, source);
  assert.equal(cover.length, 7);
  assert.equal(new Set(cover.map(item => item.assetId)).size, 7);
  assert.ok(cover.some(item => item.x < 8), 'left perimeter');
  assert.ok(cover.some(item => item.x >= 70), 'right perimeter');
  assert.ok(cover.some(item => item.y >= 75), 'lower perimeter');
  assert.ok(cover.every(item => item.width >= 15 && item.height >= 18));
  assert.equal(planListingPlacements(4, source).length, 8);
  assert.equal(planListingPlacements(15, source).length, 9);
  assert.equal(curatedListingHighlights(source,10).length,10,'other callers still support ten');
});

test('known models use published 1024-square output-only prices when token usage is unavailable', () => {
  assert.deepEqual(estimateListingImageGenerationCost('gpt-image-1-mini','low'),{
    usd: 0.005, basis:'published-square-output'
  });
  assert.deepEqual(estimateListingImageGenerationCost('gpt-image-1-mini','medium'),{
    usd: 0.011, basis:'published-square-output'
  });
  assert.deepEqual(estimateListingImageGenerationCost('gpt-image-1.5','high'),{
    usd: 0.133, basis:'published-square-output'
  });
  assert.equal(estimateListingImageGenerationCost('unpublished-image-model','medium'),null);
  assert.equal(estimateListingImageGenerationCost('gpt-image-2.5-flare','medium'),null,
    'unknown generation token output should not be presented as a made-up price');
});

test('reported provider token usage generates a nonzero estimate including input text and image output', () => {
  const actual = estimateListingImageGenerationCost('gpt-image-1-mini','medium',{
    input_tokens:100, output_tokens:1056,
    input_tokens_details:{ text_tokens:100, image_tokens:0 }
  });
  assert.ok(actual);
  assert.equal(actual?.basis,'reported-usage');
  assert.ok(Math.abs((actual?.usd || 0) - ((1056*8+100*2)/1_000_000)) < 1e-10);
  const newer = estimateListingImageGenerationCost('gpt-image-2.5-sunburst','medium',{
    input_tokens:220, output_tokens:1100,
    input_tokens_details:{text_tokens:220,image_tokens:0}
  });
  assert.equal(newer?.basis,'reported-usage');
  assert.ok(Math.abs((newer?.usd || 0) - ((1100*30+220*5)/1_000_000)) < 1e-10);
  assert.equal(estimateListingImageGenerationCost('unknown','high',{output_tokens:300}),null);
  assert.deepEqual(estimateListingImageGenerationCost('gpt-image-1-mini','low',{
    input_tokens:0,output_tokens:-1
  }),{usd:0.005,basis:'published-square-output'});
  assert.doesNotMatch(pricing,/0\.00,\s*medium:\s*0\.00/);
});

test('show clearly labeled estimated image cost in success and error notifications; exclude Vision and QC', () => {
  assert.match(backend, /estimateListingImageGenerationCost\(model, quality as 'low' \| 'medium' \| 'high', result\.usage\)/);
  assert.match(backend, /costEstimate \}/);
  assert.match(client, /response\.costEstimate\.usd\.toFixed\(5\)/);
  assert.match(client, /Estimated OpenAI image cost/);
  assert.match(client, /Additional Vision\/QC API charges not included; actual billing may differ/);
  assert.match(client, /published square-image output estimate; prompt tokens excluded/);
  assert.match(client, /imageCostNotice \? ' ' \+ imageCostNotice : ''/);
  assert.match(client, /Image ' \+ String\(step\)\.padStart\(2, '0'\) \+ ' saved as draft\. ' \+ imageCostNotice/);
  assert.match(pricing, /NEVER the official invoice/);
});
