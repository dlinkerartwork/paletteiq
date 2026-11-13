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

test('AI planner protects text and restricts excess overlap while allowing layered originals', () => {
  assert.match(planner,/const box = bounds\(slot\)/);
  assert.match(planner,/collides\(box,titleArea,5\)/);
  assert.match(planner,/isCatalogue && placed\.some\(p => collides\(box,bounds\(p\),2\)\)/);
  assert.match(planner, /\(iw \* ih\) \/ smaller > \.30/);
});

test('One-click batch uses AI layout positions and background with AI lettering and badges', () => {
  assert.match(designer,/fetch\('\/api\/thumbnail-art-direction'/);
  assert.match(designer,/plan\.slots\.map\(position =>/);
  assert.match(designer,/layout: plannedElements\.map/);
  assert.match(generator, /TYPOGRAPHY ONLY: Render these exact strings/);
  assert.match(generator, /THIS IS NOT AN ILLUSTRATION JOB/);
  assert.match(generator, /placed later from exact stored PNGs/);
});

test('AI thumbnail backgrounds prohibit object illustrations and are screened before storage', () => {
  assert.match(generator, /No pictorial symbols or decorative themed icons/);
  assert.match(generator, /Never create even tiny pictorial decorations/);
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
  assert.match(generator, /Premium design mood/);
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

test('Background QC accepts integrated abstract decoration but rejects standalone saleable clipart', () => {
  assert.match(generator, /An ornamental pattern is NOT a product image/);
  assert.match(generator, /a tiny product illustration/);
  assert.match(generator, /decorative motifs that are NOT standalone product subjects/);
  assert.match(generator, /decision\.containsObjects !== false/);
  assert.match(generator, /reason\.replace/);
});

test('QC-rejected paid backgrounds are stored for review, never auto-composited', () => {
  assert.match(generator, /qcRejected: Boolean\(qcRejection\)/);
  assert.match(generator, /await storage\.put/);
  assert.ok(generator.indexOf('await storage.put') < generator.indexOf('qcRejected: Boolean(qcRejection)'));
  assert.match(designer, /rejectedBackgroundUrl: result\.imageUrl/);
  assert.match(designer, /if \(result\.qcRejected\)/);
  assert.match(designer, /View rejected AI artwork/);
  assert.match(designer, /Approve after visual inspection/);
  assert.match(designer, /Confirm it contains NO AI-generated collection clipart/);
});

test('Batch stops repeated paid requests if QC flags two consecutive backgrounds', () => {
  assert.match(designer, /if \(rejected >= 2\)/);
  assert.match(designer, /Stopped after two QC rejections/);
});

test('Thumbnail card preview button closes before review links and approval actions', () => {
  const gallery = designer.slice(designer.indexOf('All collection thumbnails ('));
  const previewStart = gallery.indexOf('<button type="button" onClick={() => { setActiveId(item.id);');
  const previewEnd = gallery.indexOf('</button>', previewStart);
  const reviewStart = gallery.indexOf('{item.rejectedBackgroundUrl && <div', previewStart);
  assert.ok(previewStart >= 0 && previewEnd > previewStart && reviewStart > previewEnd,
    'Review controls must be siblings of the preview button, not nested inside it');
  assert.ok(gallery.indexOf('Approve after visual inspection') > reviewStart);
});

test('Image generator receives ONLY abstract graphics and lettering instructions, never character names or project theme', () => {
  assert.match(generator, /Never feed it the collection.s objects, character names/);
  assert.match(generator, /Do not visualize the collection, its subject, its category/);
  assert.doesNotMatch(generator, /Collection visual context:|Authorized ORIGINAL assets:|Collection theme:/);
  assert.match(generator, /Do not draw a visual depiction of the title words/);
  assert.match(generator, /Reserved areas where original PNG assets will later be composited/);
});

test('Single thumbnail is the default and respects selected slide key and one-image request count', () => {
  assert.match(designer, /useState<'single' \| PackPreset>\('single'\)/);
  assert.match(designer, /useState\('hero'\)/);
  assert.match(designer, /generationScope === 'single' \? all\.filter\(slide => slide\.key === singleSlideKey\)\.slice\(0, 1\) : all/);
  assert.match(designer, /const created: ThumbnailDesign\[\] = slides\.map/);
  assert.match(designer, /for \(let i = 0; i < created\.length; i\+\+\)/);
  assert.match(designer, /generationScope === 'single' \? 'Generate 1 Thumbnail'/);
  assert.match(designer, /aria-label="Single thumbnail type"/);
  assert.match(designer, /generationScope === 'single' && singleSlideKey\.startsWith\('category-'\)/);
});

test('Reference styles influence only abstract graphic and lettering prompts, not object generation', () => {
  assert.match(generator, /referenceDesign\?: \{ graphicMotif\?: string/);
  assert.match(generator, /blush-brush-ring/);
  assert.match(generator, /Delicate translucent pale blush-pink hand-painted CIRCULAR BRUSH RING/);
  assert.match(generator, /No flowers, petals, leaves, food or illustrated objects/);
  assert.match(generator, /referenceGuide \|\| abstractStyles\[coverStyle\]/);
  assert.match(designer, /referenceDesign = \{ graphicMotif: body\.layout\?\.graphicMotif/);
  assert.match(designer, /referenceDesign: target\.referenceDesign/);
  assert.match(designer, /aria-label="Etsy custom cover headline"/);
});
test('AI planner cannot collapse a multi-asset cover to one original clipart', () => {
  assert.match(designer, /const expectedMin = Math\.min\(plannedElements\.length/);
  assert.match(designer, /plan\.slots\.length < expectedMin/);
  assert.match(designer, /Using safe collection layout/);
});
