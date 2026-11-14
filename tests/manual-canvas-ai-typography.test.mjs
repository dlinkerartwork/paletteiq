import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../components/thumbnail-designer.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../app/api/thumbnail-ai-image/route.ts', import.meta.url), 'utf8');

test('Etsy Listing Draft is exactly the fifth production pipeline step', () => {
  const steps = page.match(/^const steps = (\[[^\n]+\]);/m)?.[1] || '';
  const ids = [...steps.matchAll(/id: '([^']+)'/g)].map(x => x[1]);
  assert.deepEqual(ids.slice(0, 7), [
    'analysis', 'characters', 'prompts', 'production', 'listing', 'thumbnails', 'listing-images'
  ]);
});

test('Reference & Assets uses a manual canvas workflow instead of showing either automatic pack panel', () => {
  assert.doesNotMatch(editor, />Generate Etsy Listing Pack</);
  assert.doesNotMatch(editor, />15-Image Etsy Listing Studio</);
  assert.match(editor, /Generate AI Background & Typography/);
  assert.match(editor, /Create blank canvas/);
  assert.match(editor, /Canvas main title/);
  assert.match(editor, /Canvas subtitle/);
  assert.match(editor, /Canvas badge text/);
  assert.match(editor, /Design reference template/);
  assert.match(editor, /Typography zone /);
  assert.match(editor, /Reserved AI typography zone/);
});

test('generation sends only original image coordinates, preserving manually created layers', () => {
  const method = editor.slice(editor.indexOf('  const generateCanvasArtwork = async () => {'),
    editor.indexOf('  // Create the background and artistic lettering FIRST'));
  assert.match(method, /const imageLayers = source\.elements\.filter/);
  assert.match(method, /assetMap\.get\(e\.characterId\)\?\.imageUrl/);
  assert.match(method, /layout: imageLayers\.map\(e => \(\{ type: 'image' as const/);
  assert.match(method, /background-with-typography/);
  assert.match(method, /packSlideKey: 'custom-canvas'/);
  assert.match(method, /source: 'original' as const/);
  assert.match(method, /const exactLayers = currentDesign\.elements\.filter/);
  assert.doesNotMatch(method, /placeOriginalsOverBackground/);
  assert.doesNotMatch(method, /overlapsType/);
  assert.match(method, /Intentional image\/text overlap is supported/);
  assert.match(method, /textZone: zone/);
  assert.match(method, /badge,/);
});

test('reference analysis uses style cues but never substitutes model-selected original artwork', () => {
  const method = editor.slice(editor.indexOf('  const generateCanvasArtwork = async () => {'),
    editor.indexOf('  // Create the background and artistic lettering FIRST'));
  assert.match(method, /if \(result\.layout\) referenceDesign/);
  assert.doesNotMatch(method, /result\.layout\.slots/);
});

test('flagged background review cannot automatically reposition a custom canvas', () => {
  assert.match(editor, /if \(target\.packSlideKey === 'custom-canvas'\) \{/);
  assert.match(editor, /no AI re-layout is applied/);
  assert.match(editor, /source: 'original' as const/);
});

test('AI image backend accepts optional badge and honors absence of badges', () => {
  assert.match(api, /badge\?: string/);
  assert.match(api, /input\.badge\?\.trim\(\)/);
  assert.match(api, /NO BADGE: do not invent a badge/);
  assert.match(api, /\(input\.badge \|\| ''\)\.length > 60/);
  assert.doesNotMatch(api, /mode !== 'full-thumbnail' && input\.provider !== 'openai'/);
});
