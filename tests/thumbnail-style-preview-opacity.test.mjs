import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const designer = readFileSync(new URL('../components/thumbnail-designer.tsx', import.meta.url), 'utf8');
const selector = readFileSync(new URL('../components/thumbnail-style-preview-select.tsx', import.meta.url), 'utf8');
const generator = readFileSync(new URL('../app/api/thumbnail-ai-image/route.ts', import.meta.url), 'utf8');

test('experimental style and background style controls are hidden and disabled', () => {
  assert.doesNotMatch(designer,/label="Artistic lettering composition"/);
  assert.doesNotMatch(designer,/label="Custom canvas cover style"/);
  assert.doesNotMatch(designer,/label="Custom canvas typography boldness"/);
  assert.doesNotMatch(designer,/label="Custom canvas decoration intensity"/);
  assert.doesNotMatch(designer,/aria-label="Background decoration intensity"/);
  assert.doesNotMatch(designer,/label="Custom canvas background style"/);
  assert.doesNotMatch(designer,/aria-label="Background style"/);
  assert.doesNotMatch(designer,/<ThumbnailStylePreviewSelect /);
  assert.match(designer,/const backgroundStyle = 'paper' as const/);
  assert.match(selector,/options\.map\(option =>/);
});

test('AI mode fits existing originals to reference, while manual mode retains authored positions', () => {
  const method = designer.slice(designer.indexOf('  const generateCanvasArtwork = async () => {'),
    designer.indexOf('  // Create the background and artistic lettering FIRST'));
  assert.match(method,/layoutMode === 'ai' && !reference/);
  assert.match(method,/await placeOriginalsOverBackground/);
  assert.match(method,/if \(!result\.qcRejected && layoutMode === 'ai'\)/);
  assert.match(method,/layout: imageLayers\.map/);
  assert.match(method,/source: 'original' as const/);
  assert.match(generator,/Exact original PNGs may intentionally OVERLAP the lettering/);
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

test('hidden experimental style choices are neutralized in custom generation', () => {
  assert.match(selector,/Contoh ilustratif \(CSS\/SVG\)/);
  assert.match(designer,/letteringStyle: 'auto' as const/);
  assert.match(designer,/backgroundIntensity: 'soft' as const, designBoldness: 'balanced' as const/);
  assert.match(designer,/coverStyle: 'editorial' as const, referenceDesign/);
  assert.match(designer,/boldness: 'balanced', coverStyle: 'editorial', intensity: 'soft'/);
});
