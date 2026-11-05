import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { applySeoLimits, normalizeListing } from '../lib/etsy-listing.ts';

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
  assert.match(route, /generateSeoJson\(user\.userId, instruction, seoConfig\.seoProvider\)/);
  assert.match(route, /generateSeoJson\(user\.userId, prompt, seoConfig\.seoProvider\)/);
  assert.match(provider, /gemini-flash-latest:generateContent/);
  assert.match(provider, /responseMimeType: 'application\/json'/);
});

test('ZIP export follows generaltheme_imagenumber convention', () => {
  const route = readFileSync(new URL('../app/api/exports/route.ts', import.meta.url), 'utf8');
  assert.match(route, /fileTheme\(project\.theme \|\| project\.name\)/);
  assert.match(route, /padStart\(3, '0'\)/);
});
