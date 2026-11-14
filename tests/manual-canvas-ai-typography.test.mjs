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

test('custom canvas generates graphics only, then Vision fits exact original PNGs to the reference', () => {
  const method = editor.slice(editor.indexOf('  const generateCanvasArtwork = async () => {'),
    editor.indexOf('  // Create the background and artistic lettering FIRST'));
  assert.match(method, /const originalLayers = source\.elements\.filter/);
  assert.match(method, /filterThemeCharacters\(title,characters\)/);
  assert.match(method, /slice\(0,9\)\.map\(\(c,i\)=>newImage\(c,i,'original'\)\)/);
  assert.match(method, /assetMap\.get\(e\.characterId\)\?\.imageUrl/);
  assert.match(method, /layout: imageLayers\.map\(e => \(\{ type: 'image' as const/);
  assert.match(method, /mode: hasLettering \? 'background-with-typography'/);
  assert.match(method, /referenceSlots = result\.layout\.slots \|\| \[\]/);
  assert.match(method, /referenceDesign = \{ graphicMotif: result\.layout\.graphicMotif/);
  assert.match(method, /await placeOriginalsOverBackground\(/);
  assert.match(method, /elements: \[\.\.\.positioned, \.\.\.badgeTextLayers\]/);
  assert.match(method, /source: 'original' as const/);
  assert.match(method, /reserveBadgeZone: Boolean\(hasLettering && badge\)/);
});

test('reference-guided generation requires a selected reference and blocks paid generation on analysis failure', () => {
  const method = editor.slice(editor.indexOf('  const generateCanvasArtwork = async () => {'),
    editor.indexOf('  // Create the background and artistic lettering FIRST'));
  assert.match(method, /layoutMode === 'ai' && !reference/);
  assert.match(method, /Reference analysis failed; no paid background generated/);
  assert.match(method, /result\.layout\.texts \|\| \[\]/);
  assert.match(method, /compositionGuide: result\.layout\.compositionGuide/);
});

test('QC review still adjusts exact originals and restores badge text after approval', () => {
  const review = editor.slice(editor.indexOf('  const approveReviewedBackground = async'),editor.indexOf('  const onReferenceUpload'));
  assert.match(review, /target\.packSlideKey === 'custom-canvas'/);
  assert.match(review, /await placeOriginalsOverBackground/);
  assert.match(review, /badgeOverlay\(zone,target\.packBadge \|\| ''\)/);
  assert.match(review, /source: 'original' as const/);
});

test('Badge text is overlaid exactly, never guessed by an image model', () => {
  assert.match(editor, /const badgeOverlay = \(zone: ThumbnailBox, copy: string\)/);
  assert.match(editor, /\.\.\.newText\(copy\.trim\(\)\)/);
  assert.match(editor, /badge: '',/);
  assert.match(api, /NO BADGE TEXT:/);
});

test('AI image backend accepts optional badge and honors absence of badges', () => {
  assert.match(api, /badge\?: string/);
  assert.match(api, /input\.badge\?\.trim\(\)/);
  assert.match(api, /NO BADGE: do not invent a badge/);
  assert.match(api, /\(input\.badge \|\| ''\)\.length > 60/);
  assert.doesNotMatch(api, /mode !== 'full-thumbnail' && input\.provider !== 'openai'/);
});

test('empty canvas can generate an exact-asset reference-based composition', () => {
  assert.match(editor, /layoutMode === 'ai' && characters\.some\(c => c\.imageUrl\)/);
  assert.match(editor, /currentDesign\.elements\.some\(e => e\.type === 'image'\)/);
  assert.match(editor, /: imageLayers\)/);
  assert.match(editor, /const badgeTextLayers = hasLettering \? badgeOverlay\(zone,badge\) : \[\]/);
});
