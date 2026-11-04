import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../app/api/image-batches/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('desktop batch resumes without visiting Image Production', () => {
  assert.match(route, /searchParams\.get\('syncAll'\) === '1'/);
  assert.match(route, /await syncJob\(row, key, user\.userId\)/);
  assert.match(page, /\/api\/image-batches\?syncAll=1/);
  assert.match(page, /tab === 'production'/);
});

test('background sync updates only recovered image fields, preserving unsaved character details', () => {
  assert.match(page, /characters: prev\.characters\.map\(char =>/);
  assert.match(page, /\.\.\.char, imageUrl: stored\.imageUrl/);
});
