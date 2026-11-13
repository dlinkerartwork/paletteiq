import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildThumbnailDesignBrief } from '../lib/thumbnail-design-brief.ts';

const designer = readFileSync(new URL('../components/thumbnail-designer.tsx', import.meta.url),'utf8');
const generator = readFileSync(new URL('../app/api/thumbnail-ai-image/route.ts', import.meta.url),'utf8');
const page = readFileSync(new URL('../app/page.tsx', import.meta.url),'utf8');

const settings = {
  layoutMode: 'ai', scope: 'single', slide: 'Hero Cover',
  headline: 'Asian Food', subtitle: 'CLIPART COLLECTION',
  typography: 'ai-artwork', boldness: 'balanced', hierarchy: 'dramatic',
  coverStyle: 'watercolor', quality: 'medium', backgroundStyle: 'watercolor',
  intensity: 'soft', referenceInterpretation: 'similar', hasReference: true,
  analysisProvider: 'openai', analysisModel: 'gpt-4.1-mini', imageModel: 'gpt-image-1-mini',
  collectionStyle: 'Hand-painted watercolor', collectionPalette: 'Ivory, blush, forest green',
  collectionTexture: 'Natural pigment granulation'
};

test('Thumbnail design prompt includes all Reference & Assets selections and collection aesthetics', () => {
  const prompt = buildThumbnailDesignBrief(settings);
  for (const word of [
    'ai', 'single', 'Hero Cover', 'Asian Food', 'CLIPART COLLECTION',
    'ai-artwork', 'balanced', 'dramatic', 'watercolor', 'medium', 'soft',
    'similar', 'openai', 'gpt-4.1-mini', 'gpt-image-1-mini',
    'Hand-painted watercolor', 'Ivory, blush, forest green', 'Natural pigment granulation'
  ]) assert.ok(prompt.includes(word), 'Missing brief value: ' + word);
  assert.match(prompt, /STRICTLY FORBIDDEN: generate, redraw, imitate/);
  assert.match(prompt, /placed by PaletteIQ after AI Vision analysis/);
});

test('Editable lettering mode requests no image-generated text', () => {
  const prompt = buildThumbnailDesignBrief({ ...settings, typography: 'editable', hasReference: false });
  assert.match(prompt, /NO text; editable typography will be composited separately/);
  assert.match(prompt, /Reference: none/);
});

test('Legacy analyze/apply layout and AI full-raster generation controls are gone', () => {
  assert.doesNotMatch(designer, /Analyze & apply layout/);
  assert.doesNotMatch(designer, /const analyze = async/);
  assert.doesNotMatch(designer, /generateAiThumbnail/);
  assert.doesNotMatch(designer, /Generate AI thumbnail/);
  assert.match(designer, /Generate 1 Thumbnail from Prompt/);
  assert.match(designer, /Thumbnail design prompt preview/);
  assert.match(designer, /designBriefSettings: currentBriefSettings\(slide\)/);
});

test('Background API consumes controlled design-brief settings without receiving original clipart identities', () => {
  assert.match(generator, /buildThumbnailDesignBrief/);
  assert.match(generator, /mode === 'full-thumbnail' \|\| !brief \? ''/);
  assert.match(generator, /REFERENCE & ASSETS SETTINGS/);
  assert.match(generator, /collectionPalette: \(collection as/);
  assert.match(page, /collectionVisualSettings=\{\{ style: project\.style, palette: project\.palette, texture: project\.texture \}\}/);
});
