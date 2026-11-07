import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('New Collection detects duplicate Etsy listing IDs before loading images', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /etsyListingId\(sourceUrl\)/);
  assert.match(page, /item\.id !== project\.id && etsyListingId\(item\.url\) === referenceId/);
  assert.match(page, /setDuplicateListing\(\{ url: sourceUrl\.trim\(\), collections:/);
});

test('duplicate reference warning lets the user cancel or continue', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /role="alertdialog"/);
  assert.match(page, /setDuplicateListing\(null\)/);
  assert.match(page, /loadListingImages\(true\)/);
});
