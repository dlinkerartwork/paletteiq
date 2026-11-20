import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeNewBatchResults } from '../lib/batch-recovery.ts';

const flagged = {
  id: 'fox', prompt: 'An original soft watercolor fox clipart',
  imageUrl: '/old-fox.png', status: 'done',
  similarityReview: { status: 'needs_review', score: 85, reason: 'Nearly matching pose', checkedAt: 123 },
};

test('successful similarity regeneration replaces only the exact expected old image', () => {
  const next = mergeNewBatchResults([flagged], [{
    id: 'fox', status: 'done', imageUrl: '/new-fox.png',
    replaceFromImageUrl: '/old-fox.png',
    similarityReview: { status: 'clear', score: 27, reason: 'Distinct silhouette', checkedAt: 567 },
  }], new Set(['fox']));
  assert.equal(next[0].imageUrl, '/new-fox.png');
  assert.equal(next[0].similarityReview.status, 'clear');
});

test('stale batch cannot overwrite a newer image submitted from another tab', () => {
  const next = mergeNewBatchResults([{ ...flagged, imageUrl: '/newer-manual-fox.png' }], [{
    id: 'fox', status: 'done', imageUrl: '/stale-fox.png',
    replaceFromImageUrl: '/old-fox.png',
  }], new Set(['fox']));
  assert.equal(next[0].imageUrl, '/newer-manual-fox.png');
});

test('failed similarity regeneration keeps previously paid original PNG and similarity score', () => {
  const next = mergeNewBatchResults([flagged], [{
    id: 'fox', status: 'error', replaceFromImageUrl: '/old-fox.png',
    error: 'OpenAI generation failed',
  }], new Set(['fox']));
  assert.equal(next[0].imageUrl, '/old-fox.png');
  assert.equal(next[0].status, 'done');
  assert.equal(next[0].similarityReview.status, 'needs_review');
});

test('failed first-time image generation still records an actionable error', () => {
  const next = mergeNewBatchResults([{ id:'duck', status:'draft' }], [{
    id:'duck', status:'error', error:'Output missing',
  }], new Set(['duck']));
  assert.equal(next[0].status, 'error');
  assert.equal(next[0].error, 'Output missing');
});
