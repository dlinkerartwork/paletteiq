import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const thumbnail = readFileSync(new URL('../components/thumbnail-designer.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../components/etsy-listing-image-studio.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/listing-image-studio/route.ts', import.meta.url), 'utf8');

test('automatic pack panels remain hidden in Thumbnail Designer; restored PR18 studio is a separate tab', () => {
  assert.doesNotMatch(thumbnail, />15-Image Etsy Listing Studio</);
  assert.doesNotMatch(thumbnail, />Generate Etsy Listing Pack</);
  assert.match(page, /tab === 'thumbnails' && <ThumbnailDesigner/);
  assert.match(page, /tab === 'listing-images' && <EtsyListingImageStudio/);
  assert.doesNotMatch(page, /onStartListingStudio=\{startListingImageStudio\}/);
});

test('restored PR18 generator uses its original OpenAI prompt and Vision coordinates', () => {
  assert.match(studio, /action: 'generate', projectId, number: step, model, quality/);
  assert.match(studio, /action: 'layout', projectId, number: step, backgroundUrl: response\.backgroundUrl, placements: effectivePositions/);
  assert.match(route, /function artPrompt\(number: number, project: StoredProject, count: number\)/);
  assert.match(route, /artPrompt\(input\.number, project, count\)/);
  assert.doesNotMatch(studio, /referenceDesign: styleTokens|settings: config/);
  assert.doesNotMatch(route, /input\.settings/);
});

test('thumbnail work remains separate; originals and edits persist in the 15-image workflow', () => {
  assert.match(studio, /originalAssets\(characters\)/);
  assert.match(studio, /planListingPlacements\(step, categorizedAssets\)/);
  assert.match(studio, /const file = await compose\(background, layout, assets\)/);
  assert.match(studio, /const move = \(field:/);
  assert.match(studio, /const categorize = async/);
  assert.match(studio, /<Check size=\{16\}\/> Approve & Next/);
});
