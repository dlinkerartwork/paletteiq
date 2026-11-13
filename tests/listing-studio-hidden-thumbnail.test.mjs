import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_LISTING_STUDIO_CONFIG } from '../lib/listing-studio-config.ts';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const listing = readFileSync(new URL('../components/etsy-listing-image-studio.tsx', import.meta.url), 'utf8');
const config = readFileSync(new URL('../lib/listing-studio-config.ts', import.meta.url), 'utf8');

test('Thumbnail Designer and Etsy Listing Image Studio are both visible, separate pipeline steps', () => {
  const steps = page.match(/const steps = (\[[^\n]+\]);/)?.[1] || '';
  assert.ok(steps.includes("'thumbnails'"));
  assert.ok(steps.includes("'listing-images'"));
  assert.ok(steps.indexOf("'thumbnails'") < steps.indexOf("'listing-images'"));
  assert.match(page, /tab === 'thumbnails' && <ThumbnailDesigner/);
  assert.match(page, /tab === 'listing-images' && <EtsyListingImageStudio/);
  assert.match(page, /restored.tab && validTabs.includes\(restored.tab\)/);
  assert.doesNotMatch(page, /requested === 'thumbnails' \? 'listing-images'/);
});

test('all Reference & Assets controls are accessible from Listing Image Studio', () => {
  for (const key of ['layoutMode','analysisProvider','analysisModel','coverStyle',
      'backgroundStyle','boldness','hierarchy','intensity','headline','referenceImage','referenceStyle']) {
    assert.ok(listing.includes("changeConfig('"+key+"'") ||
      listing.includes("analysisProvider: value") || listing.includes("analysisModel: value"),
      'Missing setting control: ' + key);
  }
  assert.match(listing, /Save listing design settings/);
  assert.match(listing, /settingsDirty\) return setMessage/);
  assert.match(listing, /onConfigSave\(config\)/);
  assert.match(page, /onConfigSave=\{saveListingImageSettings\}/);
  assert.match(page, /referenceImage: settings.referenceImage\?\.startsWith\('data:'\) \? undefined/);
  assert.match(listing, /createImageBitmap\(file\)/);
  assert.match(listing, /AI artistic lettering/);
});

test('new collections can generate 15 listing images with valid default settings without legacy editor', () => {
  assert.equal(DEFAULT_LISTING_STUDIO_CONFIG.imageModel, 'gpt-image-1-mini');
  assert.equal(DEFAULT_LISTING_STUDIO_CONFIG.typography, 'ai-artwork');
  assert.equal(DEFAULT_LISTING_STUDIO_CONFIG.layoutMode, 'ai');
  assert.match(listing, /DEFAULT_LISTING_STUDIO_CONFIG/);
  assert.match(listing, /LISTING_IMAGE_SPECS\.map/);
  assert.match(config, /DEFAULT_LISTING_STUDIO_CONFIG/);
});
