import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateListingCoverTitle, suggestListingCoverCopy } from '../lib/etsy-listing-cover-copy.ts';

const ui=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const editor=readFileSync(new URL('../components/etsy-listing-layout-canvas.tsx',import.meta.url),'utf8');
const api=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const studio=readFileSync(new URL('../app/api/studio/route.ts',import.meta.url),'utf8');

test('title length advisory warns, but never silently rewrites the full Etsy SEO Title', () => {
  assert.equal(evaluateListingCoverTitle('Botanical Clipart').status,'good');
  assert.equal(evaluateListingCoverTitle('Beautiful Botanical Watercolor Floral Clipart Collection').status,'warning');
  assert.equal(evaluateListingCoverTitle('The Most Beautiful Vintage Botanical Watercolor Floral Clipart Bundle For Digital Designers').status,'too-long');
  assert.equal(evaluateListingCoverTitle('').status,'warning');
  assert.match(ui,/data-listing-title-length=\{titleAdvice\.status\}/);
  assert.match(ui,/evaluateListingCoverTitle\(currentLettering\.title\)/);
  assert.match(ui,/evaluation\.status === 'too-long' && !window\.confirm/);
  assert.match(ui,/titleAdvice\.message/);
  assert.match(ui,/SEO Title from Etsy Listing Draft/);
});

test('cost-free suggestions reflect the actual collection SEO, keyword, theme and supported item count', () => {
  const suggestions=suggestListingCoverCopy({
    name:'Blossom Garden Flowers',theme:'Flowers & Blossoms',
    subtheme:'Botanical Flowers',style:'Watercolor',seoTitle:'Botanical Watercolor Flowers | Digital Clipart Bundle',
    primaryKeyword:'botanical watercolor flowers',collectionSize:120
  });
  assert.ok(suggestions.titles.length >= 3, 'a choice of title lengths');
  assert.ok(suggestions.subtitles.length >= 3, 'a choice of subtitles');
  assert.ok(suggestions.titles.some(t=>/Botanical Flowers/i.test(t)));
  assert.ok(suggestions.subtitles.some(x=>x.includes('120')));
  assert.ok(suggestions.subtitles.some(x=>/botanical watercolor/i.test(x)));
  assert.ok(suggestions.titles.every(x=>!/\bPNG\b|license|300\s?dpi/i.test(x)));
  assert.equal(new Set(suggestions.titles).size,suggestions.titles.length);
  assert.match(ui,/coverCopy\.titles\.map\(option =>/);
  assert.match(ui,/coverCopy\.subtitles\.map\(option =>/);
  assert.match(ui,/editLettering\('title', option\)/);
  assert.match(ui,/editLettering\('subtitle', option\)/);
  assert.match(ui,/cost-free suggestions/i);
});

test('white pre-layout and post-generation layered canvas use only original PNG URLs', () => {
  assert.match(ui,/White Canvas Pre-Layout — arrange before AI generation/);
  assert.match(ui,/Editable Original Clipart Layers \(post-generate\)/);
  assert.match(ui,/<EtsyListingLayoutCanvas/);
  assert.match(ui,/backgroundUrl=\{current\?\.backgroundUrl\}/);
  assert.match(ui,/onChange=\{layout => setChanges\(old => \(\{ \.\.\.old, \[step\]: layout \}\)\)\}/);
  assert.match(editor,/backgroundColor:'#fff'/);
  assert.match(editor,/data-listing-layout-canvas="true"/);
  assert.match(editor,/assetMap\.get\(p\.assetId\)/);
  assert.match(editor,/src=\{source\.imageUrl\}/);
  assert.match(editor,/onPointerDown=\{event=>begin\(event,i,'move'\)\}/);
  assert.match(editor,/onPointerDown=\{e=>begin\(e,i,'resize'\)\}/);
  assert.match(editor,/event\.currentTarget\.setPointerCapture/);
  assert.match(ui,/ROTATION \(°\)/);
  assert.match(ui,/Apply layout & save JPG \(no AI cost\)/);
});

test('save white canvas snapshots per step, prevent stale full-collection saves overwriting them', () => {
  assert.match(api,/listingPreLayouts\?: Record<string, ListingPlacement\[\]>/);
  assert.match(api,/Response\.json\(\{ images, preLayouts: project\.listingPreLayouts \|\| \{\} \}\)/);
  assert.match(api,/if \(input\.action === 'prelayout'\)/);
  assert.match(api,/new Set\(placements\.map\(p => p\.assetId\)\)\.size !== placements\.length/);
  assert.match(api,/project\.listingPreLayouts = \{ \.\.\.\(project\.listingPreLayouts \|\| \{\}\), \[String\(input\.number\)\]: placements \}/);
  assert.match(api,/eq\(projects\.owner,user\.userId\)/);
  assert.match(ui,/await savePreLayout\(effectivePositions\)/);
  assert.match(ui,/setPreLayouts\(response\.preLayouts \|\| \{\}\)/);
  assert.match(ui,/changes\[step\] \|\| current\?\.placements \|\| preLayouts\[String\(step\)\]/);
  assert.match(ui,/Save White Canvas Pre-Layout \(no AI cost\)/);
  assert.match(studio,/const savedLayouts = \(old as \{ listingPreLayouts\?: Record<string, unknown> \}\)\.listingPreLayouts/);
});

test('generation honors chosen pre-layout; Vision cannot secretly rearrange clipart', () => {
  assert.match(api,/USER-ARRANGED WHITE CANVAS PRE-LAYOUT/);
  assert.match(api,/do not draw the assets/);
  assert.match(api,/preLayout\?: ListingPlacement\[\]/);
  assert.match(api,/Invalid pre-layout/);
  assert.match(ui,/placements: effectivePositions/);
  assert.match(ui,/allowVisionRefinement && effectivePositions\.length <= 24/);
  assert.match(ui,/setAllowVisionRefinement\(false\)/);
  assert.match(ui,/aria-label="Let AI Vision refine pre-layout"/);
  assert.match(ui,/The current white-canvas pre-layout is saved before paid generation/);
  assert.match(ui,/const file = await compose\(background, layout, assets\)/);
  assert.doesNotMatch(editor,/fetch\(|generations|gpt-image|redraw/);
});
