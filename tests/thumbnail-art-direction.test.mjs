import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const planner = readFileSync(new URL('../app/api/thumbnail-art-direction/route.ts', import.meta.url),'utf8');
const designer = readFileSync(new URL('../components/thumbnail-designer.tsx', import.meta.url),'utf8');
const generator = readFileSync(new URL('../app/api/thumbnail-ai-image/route.ts', import.meta.url),'utf8');

test('AI positioning is restricted to saved original collection images, not invented assets', () => {
  assert.match(planner,/collection\.characters/);
  assert.match(planner,/filter\(c => !!c\.imageUrl\)/);
  assert.match(planner,/allowed\.has\(item\.characterId\)/);
  assert.match(planner,/used\.has\(item\.characterId\)/);
  assert.match(planner,/assetSource:'original'/);
  assert.match(designer,/source: 'original'/);
});

test('AI planner checks text collision, rotated bounds and intersections with other clipart', () => {
  assert.match(planner,/const box = bounds\(slot\)/);
  assert.match(planner,/collides\(box,titleArea,5\)/);
  assert.match(planner,/placed\.some\(p => collides\(box,bounds\(p\),2\)\)/);
});

test('One-click batch uses AI layout positions and background with AI lettering and badges', () => {
  assert.match(designer,/fetch\('\/api\/thumbnail-art-direction'/);
  assert.match(designer,/plan\.slots\.map\(position =>/);
  assert.match(designer,/layout: plannedElements\.map/);
  assert.match(generator,/INCLUDES artistic typography, tasteful ornamental badges/);
  assert.match(generator,/STRICT SEPARATION: Draw NO collection-related objects whatsoever/);
  assert.match(generator,/The AI must never invent, reconstruct, imitate, redraw/);
});

test('AI thumbnail backgrounds prohibit object illustrations and are screened before storage', () => {
  assert.match(generator, /Draw NO collection-related objects whatsoever/);
  assert.match(generator, /The AI must never invent, reconstruct, imitate, redraw/);
  assert.match(generator, /decision\.containsObjects !== false/);
  assert.ok(generator.indexOf('decision.containsObjects !== false') < generator.indexOf("await storage.put("));
});

test('Etsy thumbnails are fixed at 1024 square including rendered export', () => {
  assert.match(designer, /const THUMBNAIL_SIZE = 1024/);
  assert.match(designer, /canvas\.width = THUMBNAIL_SIZE; canvas\.height = THUMBNAIL_SIZE/);
  assert.match(designer, /quality: packQuality, width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE/);
  assert.match(generator, /width !== 1024 \|\| height !== 1024/);
});

test('Etsy pack defaults to independently editable typography and exact original assets', () => {
  assert.match(designer, /useState<'editable' \| 'ai-artwork'>\('ai-artwork'\)/);
  assert.match(designer, /packTypography === 'editable' \? \[\.\.\.plannedElements, \.\.\.typographyForSlide\(slide\)\]/);
  assert.match(designer, /mode: packTypography === 'editable' \? 'background-only' : 'background-with-typography'/);
  assert.match(designer, /originalAssetsOnly: true/);
});

test('Both background modes reject illustrated substitutes, and editable mode rejects AI lettering', () => {
  assert.match(generator, /mode === 'background-with-typography' \|\| mode === 'background-only'/);
  assert.match(generator, /decision\.containsObjects !== false/);
  assert.match(generator, /mode === 'background-only' && decision\.containsText !== false/);
  assert.match(generator, /Art-director notes:/);
});

test('Batch requests the AI background even if art direction fails', () => {
  assert.match(designer, /let plannedElements: ThumbnailElement\[\] = item\.elements\.filter/);
  assert.match(designer, /catch \{\s*setPackStatus\('Using safe collection layout/);
  assert.match(designer, /fetch\('\/api\/thumbnail-ai-image'/);
  assert.match(designer, /packTypography === 'ai-artwork'/);
});

test('Every collection thumbnail offers safe deletion and a background retry', () => {
  assert.match(designer, /const deleteThumbnail = \(thumbnailId: string\)/);
  assert.match(designer, /Original clipart assets will not be deleted/);
  assert.match(designer, /onClick=\{\(\) => deleteThumbnail\(item\.id\)\}/);
  assert.match(designer, /onClick=\{\(\) => void retryBackground\(item\)\}/);
  assert.match(designer, /backgroundRetryId === item\.id/);
});
