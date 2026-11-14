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

test('AI planner fits original artwork away from actual title and subtitle regions', () => {
  assert.match(planner,/const box = bounds\(slot\)/);
  assert.match(planner,/const fitted = fitClipartAroundTypography\(/);
  assert.match(planner,/detectedSubtitleZone\?: Box/);
  assert.match(planner,/detectedTitleZone\?: Box/);
  assert.match(planner,/slots:fitted/);
  assert.match(planner,/isCatalogue && placed\.some\(p => collides\(box,bounds\(p\),2\)\)/);
});

test('One-click batch uses AI layout positions and background with AI lettering and badges', () => {
  assert.match(designer,/fetch\('\/api\/thumbnail-art-direction'/);
  assert.match(designer,/placeOriginalsOverBackground\(/);
  assert.match(designer,/layout: initialElements\.map/);
  assert.match(generator, /PREMIUM CUSTOM ARTISTIC LETTERING/);
  assert.match(generator, /EXACT MAIN TITLE:/);
  assert.match(generator, /NO BADGE: do not invent a badge/);
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
  assert.match(designer, /packTypography === 'editable'\s*\? \[\.\.\.placement\.elements, \.\.\.typographyForSlide\(slide\)\]/);
  assert.match(designer, /mode: packTypography === 'editable' \? 'background-only' : 'background-with-typography'/);
  assert.match(designer, /originalAssetsOnly: true/);
});

test('Both background modes reject illustrated substitutes, and editable mode rejects AI lettering', () => {
  assert.match(generator, /mode === 'background-with-typography' \|\| mode === 'background-only'/);
  assert.match(generator, /decision\.containsObjects !== false/);
  assert.match(generator, /mode === 'background-only' && decision\.containsText !== false/);
  assert.match(generator, /Premium design mood/);
});

test('Batch requests the image before Vision layout and preserves safe fallback', () => {
  const batch = designer.slice(designer.indexOf('const generateReferenceBatch ='), designer.indexOf('const retryBackground ='));
  assert.ok(batch.indexOf("fetch('/api/thumbnail-ai-image'") < batch.indexOf('await placeOriginalsOverBackground('));
  assert.match(designer, /return \{ elements: safeFallback, usedFallback: true \}/);
  assert.match(designer, /backgroundImageUrl: result\.imageUrl/);
});

test('Every collection thumbnail offers safe deletion and a background retry', () => {
  assert.match(designer, /const deleteThumbnail = \(thumbnailId: string\)/);
  assert.match(designer, /Original clipart assets will not be deleted/);
  assert.match(designer, /onClick=\{\(\) => deleteThumbnail\(item\.id\)\}/);
  assert.match(designer, /item\.packSlideKey === 'custom-canvas' \? \(setActiveId\(item\.id\)/);
  assert.match(designer, /: void retryBackground\(item\)/);
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
  assert.match(generator, /Visible areas where original PNG assets will later be composited/);
  assert.match(generator, /JSON\.stringify\(visibleLayout\)/);
});

test('Single-thumbnail legacy implementation is retained but the visible editor generates from manual canvas', () => {
  assert.match(designer, /useState<'single' \| PackPreset>\('single'\)/);
  assert.match(designer, /useState\('hero'\)/);
  assert.match(designer, /generationScope === 'single' \? all\.filter\(slide => slide\.key === singleSlideKey\)\.slice\(0, 1\) : all/);
  assert.match(designer, /const created: ThumbnailDesign\[\] = slides\.map/);
  assert.match(designer, /for \(let i = 0; i < created\.length; i\+\+\)/);
  assert.doesNotMatch(designer, /aria-label="Single thumbnail type"/);
  assert.match(designer, /Generate AI Background & Typography from Canvas/);
  assert.match(designer, /const generateCanvasArtwork = async/);
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
  assert.match(designer, /aria-label="Canvas main title"/);
});
test('Background-first Vision cannot collapse a multi-asset cover to one original clipart', () => {
  assert.match(designer, /const expectedMin = Math\.min\(imageElements\.length/);
  assert.match(designer, /result\.slots\.length < expectedMin/);
  assert.match(designer, /return \{ elements: safeFallback, usedFallback: true \}/);
});

test('Vision analyzes the exact persisted background, not a generic pre-generation prompt', () => {
  assert.match(planner, /backgroundImageUrl\?: string/);
  assert.match(planner, /nativeAssetBucket\(\) \?\? env\.BUCKET/);
  assert.match(planner, /parsedUrl\.pathname !== '\/api\/thumbnail-background'/);
  assert.match(planner, /parsedUrl\.searchParams\.get\('projectId'\) !== body\.projectId/);
  assert.match(planner, /image_url:backgroundDataUrl/);
  assert.match(planner, /detectedTitleZone\?: Box/);
  assert.match(designer, /backgroundImageUrl: imageUrl/);
  assert.match(designer, /AI Vision analyzing generated background and positioning original clipart/);
});
test('Hero cover prompt includes the requested cream medallion, blush ring and editorial lettering', () => {
  assert.match(generator, /const heroReferenceStyle = \[/);
  assert.match(generator, /large soft cream central medallion panel/);
  assert.match(generator, /blush watercolor circular brush ring/);
  assert.match(generator, /Do NOT create illustrations, icons, mini food drawings/);
  assert.match(generator, /isHeroCover \? \['HERO ART DIRECTION PRIORITY:'/);
});

test('Manual approval runs background-first Vision for custom canvas and original asset layers', () => {
  const part = designer.slice(designer.indexOf('const approveReviewedBackground'),designer.indexOf('const onReferenceUpload'));
  assert.match(part, /if \(target\.packSlideKey === 'custom-canvas'\)/);
  const custom = part.slice(part.indexOf("if (target.packSlideKey === 'custom-canvas')"), part.indexOf("setMessage('AI Vision analyzing approved background"));
  assert.match(custom, /await placeOriginalsOverBackground/);
  assert.match(custom, /badgeOverlay\(zone,target\.packBadge \|\| ''\)/);
  assert.match(custom, /source: 'original' as const/);
  assert.ok(custom.indexOf('await placeOriginalsOverBackground') < custom.indexOf('backgroundImageUrl:d.rejectedBackgroundUrl'));
  const legacy = part.slice(part.indexOf("setMessage('AI Vision analyzing approved background"));
  assert.match(legacy, /await placeOriginalsOverBackground/);
  assert.ok(legacy.indexOf('await placeOriginalsOverBackground') < legacy.indexOf('backgroundImageUrl: d.rejectedBackgroundUrl'));
});

test('Saved thumbnail can be re-laid out by Vision without paying for a second image', () => {
  const relayout = designer.slice(designer.indexOf('const reLayoutWithVision'), designer.indexOf('const approveReviewedBackground'));
  assert.match(relayout, /await placeOriginalsOverBackground/);
  assert.doesNotMatch(relayout, /thumbnail-ai-image/);
  assert.match(designer, /Re-layout with AI Vision/);
  assert.match(designer, /packSlideKey: slide\.key/);
  assert.match(designer, /candidate\.key === target\.packSlideKey/);
});

test('Optional reference layout timeout does not abort paid thumbnail generation', () => {
  const batch = designer.slice(designer.indexOf('const generateReferenceBatch ='), designer.indexOf('const retryBackground ='));
  const refStart = batch.indexOf("if (reference) {");
  const imageStart = batch.indexOf("fetch('/api/thumbnail-ai-image'");
  assert.ok(refStart >= 0 && imageStart > refStart);
  const analysis = batch.slice(refStart, imageStart);
  assert.match(analysis, /try \{/);
  assert.match(analysis, /catch \(error\) \{/);
  assert.match(analysis, /Reference analysis failed/);
  assert.match(analysis, /referenceDesign = \{ graphicMotif: 'blush-brush-ring'/);
  assert.match(batch, /referenceWarning \? ' ' \+ referenceWarning/);
  assert.match(batch, /count: Math\.min\(available\.length, 12\)/);
});

test('Vision client performs local fitting, even when planner produced a layout', () => {
  assert.match(designer, /import \{ fitClipartAroundTypography/);
  assert.match(designer, /const safeFallback = fit\(hintedOriginals, \[slide\.textZone\], \[\]\)/);
  assert.match(designer, /result\.detectedSubtitleZone/);
  assert.match(designer, /const fitted = fit\(selected,/);
  assert.match(planner, /minScale:body\.hierarchy/);
});

test('Reference image controls background, typography and original PNG geometry', () => {
  assert.match(designer, /compositionGuide: result\.layout\.compositionGuide/);
  assert.match(designer, /referenceSlots = result\.layout\.slots \|\| \[\]/);
  assert.match(designer, /referenceHints\[i\]\?\.x \?\? e\.x/);
  assert.match(designer, /const scale = Math\.max\(\.45, Math\.min\(2\.5/);
  assert.match(designer, /await placeOriginalsOverBackground\(/);
  assert.match(planner, /referenceCompositionGuide\?: string/);
  assert.match(planner, /REFERENCE-DRIVEN LAYOUT/);
  assert.match(generator, /REFERENCE COMPOSITION HAS PRIORITY OVER DEFAULT ABSTRACT DECORATION/);
});
