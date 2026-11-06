import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('desktop packaging rebuilds and copies the same web client and server bundles', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const builder = readFileSync('scripts/prepare-desktop-bundle.mjs', 'utf8');
  const main = readFileSync('desktop/main.cjs', 'utf8');
  assert.match(packageJson.scripts['desktop:package:win'], /^npm run build && /);
  assert.match(builder, /cpSync\(path\.join\(root, 'dist', 'client'\)/);
  assert.match(builder, /cpSync\(path\.join\(root, 'dist', 'server'\)/);
  assert.match(main, /config\.assets\.directory = path\.join\(ROOT, 'dist', 'client'\)/);
  assert.match(main, /config\.main = path\.join\(ROOT, 'dist', 'server', 'index\.js'\)/);
});

test('SEO provider and Gemini model visibility are controlled by Settings, not desktop mode', () => {
  const listing = readFileSync('components/etsy-listing-draft.tsx', 'utf8');
  assert.match(listing, /listing-provider-status/);
  assert.match(listing, /GEMINI SEO MODEL/);
  assert.match(listing, /seoProvider === 'gemini'/);
  assert.doesNotMatch(listing, /isDesktop.*GEMINI SEO MODEL/);
});
