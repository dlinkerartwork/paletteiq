import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../components/etsy-listing-image-studio.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/listing-image-studio/route.ts', import.meta.url), 'utf8');

test('Thumbnail Designer and original 15-image Listing Studio remain separately accessible', () => {
  const steps = page.match(/const steps = (\[[^\n]+\]);/)?.[1] || '';
  assert.ok(steps.includes("'thumbnails'"));
  assert.ok(steps.includes("'listing-images'"));
  assert.ok(steps.indexOf("'thumbnails'") < steps.indexOf("'listing-images'"));
  assert.match(page, /tab === 'thumbnails' && <ThumbnailDesigner/);
  assert.match(page, /tab === 'listing-images' && <EtsyListingImageStudio/);
  assert.match(page, /restored.tab && validTabs.includes\(restored.tab\)/);
});

test('restore original PR18 listing studio without the later Reference & Assets configuration panel', () => {
  assert.match(studio, /<h2>Etsy Listing Image Studio<\/h2>/);
  assert.match(studio, /OPENAI ARTISTIC BACKGROUND MODEL/);
  assert.match(studio, /BACKGROUND QUALITY/);
  assert.match(studio, /const \[quality, setQuality\] = useState<'low' \| 'medium' \| 'high'>\('medium'\)/);
  assert.match(studio, /const \[model, setModel\] = useState\('gpt-image-1-mini'\)/);
  assert.doesNotMatch(studio, /<h2>Reference & Assets — Listing Image Studio<\/h2>/);
  assert.doesNotMatch(studio, /onConfigSave|config: initialConfig|settingsDirty|initialPlacements|changeConfig/);
  assert.doesNotMatch(page, /onConfigSave=\{saveListingImageSettings\}|listingStudioSessionSettings/);
  assert.doesNotMatch(route, /settings\?\.coverStyle|settings\?\.backgroundStyle|input\.settings|referenceDesign\?:/);
});

test('original sequence requires review/approval per image and retains 15-image JPG ZIP export', () => {
  assert.match(studio, /const precedingApproved = LISTING_IMAGE_SPECS\.slice\(0, step - 1\)/);
  assert.match(studio, /if \(!precedingApproved\)/);
  assert.match(studio, /const review = async \(status: 'approved' \| 'needs_revision'\)/);
  assert.match(studio, /if \(status === 'approved' && step < 15\)/);
  assert.match(studio, /Apply layout & save JPG/);
  assert.match(studio, /Export 15 approved JPGs as ZIP/);
  assert.match(studio, /aspectRatio: '4 \/ 3'/);
  assert.match(studio, /const file = await compose\(background, layout, assets\)/);
  assert.match(route, /Approve all 15 rendered listing images before exporting/);
});

test('revert keeps safe upload and paid background retry fixes, including original project data', () => {
  assert.match(studio, /uploadListingJpg\(projectId, fileName\(number\), blob, fetch, onProgress\)/);
  assert.match(studio, /Retry save JPG \(no AI cost\)/);
  assert.match(studio, /await saveRecord\(\{\s*number: step, status: 'draft', backgroundUrl: response\.backgroundUrl/);
  assert.match(route, /value\.renderedImageUrl !== undefined \? value\.renderedImageUrl/);
  assert.match(page, /listingImages\?: ListingImageRecord\[\]/);
  assert.match(page, /listingStudioSettings\?: ListingStudioConfig/);
});
