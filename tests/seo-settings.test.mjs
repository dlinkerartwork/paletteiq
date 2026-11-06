import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { applySeoLimits, normalizeListing } from '../lib/etsy-listing.ts';
import { createImageFileNamer, DEFAULT_IMAGE_NAMING } from '../lib/image-file-naming.ts';

const draft = () => normalizeListing({
  title: 'Watercolor Flowers and Blossoms Clipart Bundle for Creative Digital Projects and Beautiful Botanical Invitations',
  description: 'This is a watercolor floral bundle.',
  imageAltTexts: Array.from({ length: 12 }, (_, i) => 'Alt ' + i + ': ' + 'a'.repeat(490)),
});

test('SEO title limit defaults can be applied to 120 characters', () => {
  const limited = applySeoLimits(draft(), 120, 10);
  assert.ok(limited.title.length <= 120);
  assert.equal(limited.imageAltTexts.length, 10);
  assert.ok(limited.imageAltTexts.every(text => text.length <= 450));
});

test('custom smaller title and alt count are respected', () => {
  const limited = applySeoLimits(draft(), 60, 3);
  assert.ok(limited.title.length <= 60);
  assert.equal(limited.imageAltTexts.length, 3);
  assert.ok(limited.imageAltTexts.every(text => text.length <= 450));
});

test('server routes honor configured provider and generation limits', () => {
  const route = readFileSync(new URL('../app/api/studio/route.ts', import.meta.url), 'utf8');
  const provider = readFileSync(new URL('../lib/seo-provider.ts', import.meta.url), 'utf8');
  assert.match(route, /generateSeoJson\(user\.userId, instruction, seoConfig\.seoProvider, seoConfig\.seoGeminiModel\)/);
  assert.match(route, /generateSeoJson\(user\.userId, prompt, seoConfig\.seoProvider, seoConfig\.seoGeminiModel\)/);
  assert.match(provider, /models\/\$\{model\}:generateContent/);
  assert.match(provider, /thinkingBudget: 0/);
  assert.match(provider, /responseMimeType: 'application\/json'/);
});

test('ZIP export preserves legacy default naming and supports saved custom patterns', () => {
  const route = readFileSync(new URL('../app/api/exports/route.ts', import.meta.url), 'utf8');
  const defaultName = createImageFileNamer(DEFAULT_IMAGE_NAMING, { theme: 'Flowers & Blossoms', collection: 'Spring' });
  assert.equal(defaultName('Rose', 0, 'png'), 'flowers_blossoms_001.png');
  assert.equal(defaultName('Lily', 1, 'png'), 'flowers_blossoms_002.png');
  assert.match(route, /createImageFileNamer\(pattern/);
  assert.match(route, /imageFileName\(character\.name, index, extension\)/);
});
