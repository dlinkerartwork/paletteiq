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

test('Gemini alt model is visible on desktop and SEO review provider remains configurable', () => {
  const listing = readFileSync('components/etsy-listing-draft.tsx', 'utf8');
  assert.match(listing, /listing-provider-status/);
  assert.match(listing, /SEO MODEL/);
  assert.match(listing, /selectedProvider === 'gemini' \? selectedGeminiModel : selectedOpenaiModel/);
  assert.match(listing, /geminiModels\.map\(/);
  assert.match(listing, /selectedProvider === 'gemini'/);
  assert.match(listing, /SEO PROVIDER/);
  assert.doesNotMatch(listing, /isDesktop.*SEO MODEL/);
});
