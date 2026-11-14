import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const notice = readFileSync(new URL('../components/auto-dismiss-notice.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const designer = readFileSync(new URL('../components/thumbnail-designer.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('main and thumbnail notifications float at top and dismiss automatically in ten seconds', () => {
  assert.match(notice, /10_000/);
  assert.match(notice, /window\.setTimeout/);
  assert.match(notice, /window\.clearTimeout/);
  assert.match(notice, /\[message\]/);
  assert.match(notice, /aria-label="Close notification"/);
  assert.match(notice, /role="status"/);
  assert.match(page, /<AutoDismissNotice message=\{message\} onClose=\{\(\) => setMessage\(''\)\} \/>/);
  assert.match(designer, /<AutoDismissNotice message=\{message\} onClose=\{\(\) => setMessage\(''\)\} \/>/);
  assert.match(css, /\.floating-top-notice \{ position:fixed; top:88px/);
  assert.match(css, /z-index:2000/);
});

test('background style controls are absent from thumbnail panels', () => {
  assert.doesNotMatch(designer, /label="Custom canvas background style"/);
  assert.doesNotMatch(designer, /aria-label="Background style"/);
  assert.match(designer, /const backgroundStyle = 'paper' as const/);
});

test('reference analysis timeout falls back without generating fake collection artwork', () => {
  const canvas = designer.slice(designer.indexOf('const generateCanvasArtwork ='), designer.indexOf('// Create the background and artistic lettering FIRST'));
  assert.match(canvas, /Reference analysis unavailable/);
  assert.match(canvas, /referenceSlots = imageLayers\.map/);
  assert.match(canvas, /referenceWarning \? ' ' \+ referenceWarning/);
  assert.match(canvas, /await placeOriginalsOverBackground/);
  assert.match(canvas, /source: 'original' as const/);
  assert.doesNotMatch(canvas, /Reference analysis failed; no paid background generated/);
});
