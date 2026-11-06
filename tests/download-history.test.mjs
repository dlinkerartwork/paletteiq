import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('ZIP receipt accepts normal collection identifiers and retains the download fields', () => {
  const source = readFileSync('app/api/studio/route.ts', 'utf8');
  const receipt = source.split("if (body.action === 'mark-download') {")[1]?.split("if (body.action === 'save') {")[0] || '';
  assert.ok(receipt, 'Download receipt handler must exist');
  assert.ok(receipt.includes(String.raw`/^[\w-]{8,80}$/`), 'Collection ID validation must use a single regex escape');
  assert.equal(receipt.includes(String.raw`/^[\\w-]{8,80}$/`), false, 'Double escaped regex would reject UUID collection IDs');
  assert.match(receipt, /lastDownloadImageCount/);
  assert.match(receipt, /downloadedImageIds/);
  assert.match(receipt, /downloadCount/);
});

test('both Etsy package and Image Production ZIP exports record download receipts', () => {
  const listing = readFileSync('components/etsy-listing-draft.tsx', 'utf8');
  const production = readFileSync('components/image-production.tsx', 'utf8');
  const collections = readFileSync('app/page.tsx', 'utf8');
  assert.match(listing, /action: 'mark-download'/);
  assert.match(production, /action: 'mark-download'/);
  assert.match(listing, /onDownloaded\(/);
  assert.match(production, /onDownloaded\(/);
  assert.match(collections, /lastDownloadImageCount/);
});
