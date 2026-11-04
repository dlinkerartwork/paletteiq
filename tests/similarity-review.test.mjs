import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const moduleText = readFileSync(new URL('../lib/similarity-review.ts', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../app/api/studio/route.ts', import.meta.url), 'utf8');
const batch = readFileSync(new URL('../app/api/image-batches/route.ts', import.meta.url), 'utf8');

test('similarity check compares generated image with selected Etsy references and never treats unknown as passed', () => {
  assert.match(moduleText, /selected Etsy reference images/);
  assert.match(moduleText, /status: 'unverified'/);
  assert.match(moduleText, /flagged \|\|= parsed\.tooSimilar \|\| score >= 75/);
  assert.match(moduleText, /offset < urls\.length; offset \+= 5/);
});

test('single production persists similarity review after saving generated asset', () => {
  assert.match(studio, /character\.similarityReview = await reviewImageSimilarity/);
  assert.match(studio, /similarityReview: character\.similarityReview/);
});

test('batch imports persist similarity checks alongside generated assets', () => {
  assert.match(batch, /item\.similarityReview = await reviewImageSimilarity/);
  assert.match(batch, /similarityReview: item\.similarityReview/);
});
