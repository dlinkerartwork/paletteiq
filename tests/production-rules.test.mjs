import assert from 'node:assert/strict';
import test from 'node:test';
import { eligibleForBulk, isActiveBatchStatus, retryableFailedImage, wasPreviouslyGenerated } from '../lib/production-rules.ts';

test('only nonempty prompts without previous results enter bulk generation', () => {
  assert.equal(eligibleForBulk({ prompt: 'watercolor bunny' }), true);
  assert.equal(eligibleForBulk({ prompt: '  ' }), false);
  assert.equal(eligibleForBulk({ prompt: '' }), false);
  assert.equal(eligibleForBulk({ prompt: 'bunny', imageUrl: '/api/images/abc' }), false);
  assert.equal(eligibleForBulk({ prompt: 'bunny', status: 'done' }), false);
  assert.equal(eligibleForBulk({ prompt: 'bunny', status: 'error' }), false);
  assert.equal(eligibleForBulk({ prompt: 'bunny' }, true), false);
  assert.equal(eligibleForBulk({ prompt: 'bunny', status: 'ready' }), true);
});

test('previously generated or failed work is not resubmitted automatically', () => {
  assert.equal(wasPreviouslyGenerated({ status: 'done' }), true);
  assert.equal(wasPreviouslyGenerated({ status: 'error' }), true);
  assert.equal(wasPreviouslyGenerated({ imageUrl: '/api/images/abc' }), true);
  assert.equal(wasPreviouslyGenerated({ status: 'ready' }), false);
});

test('pending and importing batches remain active until fully resolved', () => {
  for (const status of ['validating', 'in_progress', 'finalizing', 'importing']) {
    assert.equal(isActiveBatchStatus(status), true, status);
  }
  for (const status of ['completed', 'completed_with_errors', 'failed', 'cancelled', 'expired']) {
    assert.equal(isActiveBatchStatus(status), false, status);
  }
});

test('collection eligibility is isolated by each collection pending IDs', () => {
  const collectionA = [{ id: 'a1', prompt: 'bear' }, { id: 'a2', prompt: 'fox' }];
  const collectionB = [{ id: 'b1', prompt: 'flower' }, { id: 'b2', prompt: 'rose', status: 'done' }];
  const pendingA = new Set(['a1']);
  const pendingB = new Set();
  assert.deepEqual(collectionA.filter(c => eligibleForBulk(c, pendingA.has(c.id))).map(c => c.id), ['a2']);
  assert.deepEqual(collectionB.filter(c => eligibleForBulk(c, pendingB.has(c.id))).map(c => c.id), ['b1']);
});

test('explicit failed-image retry never includes completed or pending items', () => {
  assert.equal(retryableFailedImage({ prompt: 'bear', status: 'error' }), true);
  assert.equal(retryableFailedImage({ prompt: 'bear', status: 'error', imageUrl: '/api/images/123' }), false);
  assert.equal(retryableFailedImage({ prompt: 'bear', status: 'error' }, true), false);
  assert.equal(retryableFailedImage({ prompt: 'bear', status: 'done' }), false);
  assert.equal(retryableFailedImage({ prompt: 'bear', status: 'ready' }), false);
  assert.equal(retryableFailedImage({ prompt: '  ', status: 'error' }), false);
  assert.equal(eligibleForBulk({ prompt: 'bear', status: 'error' }), false);
});
