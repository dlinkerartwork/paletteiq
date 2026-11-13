import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const thumbnail = readFileSync(new URL('../components/thumbnail-designer.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../components/etsy-listing-image-studio.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/listing-image-studio/route.ts', import.meta.url), 'utf8');

test('15-image listing workflow remains separate while the legacy launch panel is hidden', () => {
  assert.doesNotMatch(thumbnail, />15-Image Etsy Listing Studio</);
  assert.doesNotMatch(thumbnail, />Generate Etsy Listing Pack</);
  assert.match(thumbnail, /onStartListingStudio\?\.\(/);
  assert.match(page, /onStartListingStudio=\{startListingImageStudio\}/);
  assert.match(page, /setTab\('listing-images'\)/);
});
test('Reference & Assets selections flow to AI background generation', () => {
  assert.match(studio, /action: 'generate', projectId, number: step, model, quality/);
  assert.match(studio, /settings: config \?/);
  assert.match(route, /artPrompt\(input.number, project, count, input.settings, input.referenceDesign\)/);
  assert.match(route, /settings\?\.backgroundStyle/);
  assert.match(route, /settings\?\.coverStyle/);
});
test('Thumbnails remain separate, and drafts preserve original collection PNGs', () => {
  assert.match(page, /tab === 'thumbnails' && <ThumbnailDesigner/);
  assert.match(page, /tab === 'listing-images' && <EtsyListingImageStudio/);
  assert.match(studio, /const file = await compose\(background, layout, assets\)/);
  assert.match(studio, /config\?\.layoutMode !== 'manual'/);
});
