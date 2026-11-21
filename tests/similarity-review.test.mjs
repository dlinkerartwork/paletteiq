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
  assert.match(moduleText, /flagged \|\|= score > threshold/);
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
  assert.match(reviewQueue, /return reviewImageSimilarity\(apiKey, btoa\(binary\), mime, references, maxSimilarityPercent\)/);
  assert.match(batch, /pendingBatchReviewCount\(items\) \? 'reviewing'/);
  assert.match(batch, /mergeNewBatchResults\(project\.characters, items, changedIds\)/);
  assert.match(recovery, /similarityReview: item\.similarityReview/);
});

test('saved similarity threshold applies throughout image production',()=>{
  const settings=readFileSync(new URL('../app/api/settings/route.ts',import.meta.url),'utf8');
  const prefs=readFileSync(new URL('../components/studio-settings.tsx',import.meta.url),'utf8');
  const flow=readFileSync(new URL('../app/api/full-automation/route.ts',import.meta.url),'utf8');
  const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
  assert.match(settings,/maxReferenceSimilarityPercent: 40/);
  assert.match(settings,/Similarity threshold must be an integer from 0 to 100/);
  assert.match(prefs,/MAXIMUM SIMILARITY WITH REFERENCES/);
  assert.match(page,/MAXIMUM SIMILARITY \\(\\%\\)/);
  assert.match(batch,/references, maxReferenceSimilarityPercent/);
  assert.match(studio,/preferences\.maxReferenceSimilarityPercent \?\? 40/);
  assert.match(flow,/storePrefs\.maxReferenceSimilarityPercent \?\? 40/);
  assert.match(page,/step-success-btn/);
});
