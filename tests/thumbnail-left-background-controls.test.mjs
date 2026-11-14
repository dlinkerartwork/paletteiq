import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const designer = readFileSync(new URL('../components/thumbnail-designer.tsx', import.meta.url), 'utf8');
const generator = readFileSync(new URL('../app/api/thumbnail-ai-image/route.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('Thumbnail Designer uses exactly a left toolbox and central canvas; no right sidebar', () => {
  assert.match(designer, /className="thumbnail-editor-columns"/);
  assert.match(designer, /className="thumbnail-left-settings"/);
  assert.match(css, /grid-template-columns:minmax\(330px,400px\) minmax\(0,1fr\)/);
  assert.doesNotMatch(css, /minmax\(320px,380px\)/);
  const toolbox = designer.indexOf('className="thumbnail-left-settings"');
  const viewport = designer.indexOf('aria-label="Thumbnail canvas viewport"');
  assert.ok(toolbox >= 0 && toolbox < viewport, 'Background settings and layers precede the canvas in the left toolbox');
  for (const item of ['BACKGROUND OPACITY', 'BACKGROUND IMAGE (LOCAL PNG/JPG)', 'Remove background image', 'Design properties', 'Selected element']) {
    const index = designer.indexOf(item);
    assert.ok(index > toolbox && index < viewport, item + ' should be inside left toolbox');
  }
});

test('Canvas and export dimensions stay at fixed 1024 x 1024', () => {
  assert.match(designer, /const THUMBNAIL_SIZE = 1024/);
  assert.match(designer, /width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE/);
  assert.match(designer, /canvas\.width = THUMBNAIL_SIZE; canvas\.height = THUMBNAIL_SIZE/);
  assert.match(designer, /value="1024 × 1024 px"/);
});

test('Badge label included in paid image prompt but exact editable badge is not regenerated', () => {
  assert.match(designer, /badge: hasLettering \? badge : ''/);
  assert.match(generator, /EXACT BADGE CONTENT PROVIDED BY USER/);
  assert.match(generator, /DO NOT render these badge letters/);
  assert.match(generator, /input\.reserveBadgeZone && input\.badge\?\.trim\(\)/);
  assert.match(designer, /const badgeTextLayers = hasLettering \? badgeOverlay\(zone,badge\) : \[\]/);
});

test('Soft background prompt favors near-white ivory over strong pigments', () => {
  assert.match(generator, /At least 85 percent of the image must remain light neutral space/);
  assert.match(generator, /CRITICAL BACKGROUND COLOR RESTRAINT/);
  assert.match(generator, /avoid dense pigment, dark fills, strong colored corner blocks/);
});
