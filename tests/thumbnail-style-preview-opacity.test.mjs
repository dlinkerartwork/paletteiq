import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const designer = readFileSync(new URL('../components/thumbnail-designer.tsx', import.meta.url), 'utf8');
const selector = readFileSync(new URL('../components/thumbnail-style-preview-select.tsx', import.meta.url), 'utf8');
const generator = readFileSync(new URL('../app/api/thumbnail-ai-image/route.ts', import.meta.url), 'utf8');

test('all five controls present examples for every selectable design style', () => {
  for (const [kind, list, label] of [
    ['lettering','LETTERING_EXAMPLES','Artistic lettering composition'],
    ['cover','COVER_EXAMPLES','Custom canvas cover style'],
    ['boldness','BOLDNESS_EXAMPLES','Custom canvas typography boldness'],
    ['background','BACKGROUND_EXAMPLES','Custom canvas background style'],
    ['decoration','DECORATION_EXAMPLES','Custom canvas decoration intensity']
  ]) {
    assert.ok(designer.includes('kind="'+kind+'"'),kind+' miniature missing');
    assert.ok(designer.includes('options={'+list+'}'),kind+' options missing');
    assert.ok(designer.includes('label="'+label+'"'),kind+' label missing');
  }
  assert.equal((designer.match(/<ThumbnailStylePreviewSelect /g) || []).length,5);
  assert.match(selector,/<Miniature kind=\{kind\} variant=\{option\.value\}\/>/);
  assert.match(selector,/options\.map\(option =>/);
  assert.match(selector,/aria-expanded=\{expanded\}/);
  assert.match(selector,/role="listbox"/);
  assert.match(selector,/role="option"/);
  assert.match(selector,/CSS\/SVG/);
  assert.doesNotMatch(selector,/fetch\(|imageUrl=|onGenerate|gpt-image|gemini-/);
});

test('manual overlapping clipart and typography does not block AI generation or move original coordinates', () => {
  const manual = designer.slice(designer.indexOf('  const generateCanvasArtwork = async () => {'),
    designer.indexOf('  // Create the background and artistic lettering FIRST'));
  assert.doesNotMatch(manual,/overlapsType|Move it or change the typography zone/);
  assert.match(manual,/Intentional image\/text overlap is supported/);
  assert.match(manual,/layout: imageLayers\.map/);
  assert.match(manual,/source: 'original' as const/);
  assert.match(generator,/Exact original PNGs may intentionally OVERLAP the lettering/);
  assert.match(designer,/zIndex: 1/);
  assert.match(designer,/opacity: e\.opacity \?\? 1, zIndex: 2/);
});

test('background opacity defaults to 100%, is controlled and persisted independently of clipart', () => {
  assert.match(designer,/backgroundOpacity\?: number/);
  assert.match(designer,/const backgroundAlpha = \(design: ThumbnailDesign\) => clamp\(design\.backgroundOpacity \?\? 1, 0, 1\)/);
  assert.match(designer,/aria-label="Background opacity" type="range" min="0" max="100"/);
  assert.match(designer,/backgroundOpacity: Number\(e\.target\.value\) \/ 100/);
  assert.match(designer,/data-thumbnail-background="true"/);
  assert.match(designer,/data-thumbnail-gallery-background="true"/);
  assert.match(designer,/ctx\.globalAlpha = backgroundAlpha\(target\)/);
  assert.match(designer,/ctx\.drawImage\(backdrop, 0, 0\)/);
  assert.match(designer,/ctx\.restore\(\);\s+for \(const element of target\.elements\)/);
  assert.match(designer,/backgroundOpacity: backgroundAlpha\(item\)/);
  assert.match(designer,/renderedImageUrl: undefined, upscaledImageUrl: undefined/);
});

test('visual selectors are local illustrative previews and their choices still drive generation', () => {
  assert.match(selector,/Contoh ilustratif \(CSS\/SVG\)/);
  assert.match(selector,/onChange\(option\.value\); setExpanded\(false\)/);
  assert.match(designer,/backgroundStyle, backgroundIntensity, designBoldness: packBoldness/);
  assert.match(designer,/coverStyle: packCoverStyle, referenceDesign/);
  assert.match(designer,/letteringStyle: source\.packLetteringStyle \|\| 'auto'/);
});
