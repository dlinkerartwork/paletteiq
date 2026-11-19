import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const moduleText = readFileSync(new URL('../lib/similarity-review.ts', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../app/api/studio/route.ts', import.meta.url), 'utf8');
const batch = readFileSync(new URL('../app/api/image-batches/route.ts', import.meta.url), 'utf8');
const recovery = readFileSync(new URL('../lib/batch-recovery.ts', import.meta.url), 'utf8');

test('similarity check compares generated image with selected Etsy references and never treats unknown as passed', () => {
  assert.match(moduleText, /selected Etsy reference images/);
  assert.match(moduleText, /status: 'unverified'/);
  assert.match(moduleText, /flagged \|\|= parsed\.tooSimilar \|\| score >= 75/);
  assert.match(moduleText, /offset < urls\.length; offset \+= 10/);
  assert.match(moduleText, /Promise\.all\(offsets\.map\(compareGroup\)\)/);
  assert.match(moduleText, /index < urls\.length/);
});

test('single production persists similarity review after saving generated asset', () => {
  assert.match(studio, /similarityReview = await reviewImageSimilarity/);
  assert.match(studio, /current\.similarityReview = similarityReview/);
});

test('batch imports persist similarity checks alongside generated assets', () => {
  const reviewQueue = readFileSync(new URL('../lib/image-review-queue.ts', import.meta.url), 'utf8');
  assert.match(batch, /item\.similarityReview = await reviewStoredBatchImage/);
  assert.match(reviewQueue, /return reviewImageSimilarity\(apiKey, btoa\(binary\), mime, references\)/);
  assert.match(batch, /pendingBatchReviewCount\(items\) \? 'reviewing'/);
  assert.match(batch, /mergeNewBatchResults\(project\.characters, items, changedIds\)/);
  assert.match(recovery, /similarityReview: item\.similarityReview/);
});
