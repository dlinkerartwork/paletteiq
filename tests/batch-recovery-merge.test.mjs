import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeNewBatchResults } from '../lib/batch-recovery.ts';

test('recovery preserves a newer regenerated image from a previously imported Batch item', () => {
  const characters = [
    { id: 'a', status: 'done', imageUrl: '/api/images/regenerated.png', error: '' },
    { id: 'b', status: 'ready', error: '' },
  ];
  const items = [
    { id: 'a', status: 'done', imageUrl: '/api/images/old-batch.png' },
    { id: 'b', status: 'done', imageUrl: '/api/images/new-batch.png' },
  ];
  const result = mergeNewBatchResults(characters, items, new Set(['b']));
  assert.equal(result[0], characters[0], 'Already-imported item must not overwrite latest regeneration');
  assert.equal(result[0].imageUrl, '/api/images/regenerated.png');
  assert.equal(result[1].imageUrl, '/api/images/new-batch.png');
  assert.equal(result[1].status, 'done');
});

test('recovery changes only newly failed items and never resubmits a Batch', () => {
  const characters = [
    { id: 'a', status: 'done', imageUrl: '/api/images/success.png' },
    { id: 'b', status: 'ready', error: '' },
  ];
  const items = [
    { id: 'a', status: 'done', imageUrl: '/api/images/old.png' },
    { id: 'b', status: 'error', error: 'Quota exhausted' },
  ];
  const result = mergeNewBatchResults(characters, items, new Set(['b']));
  assert.equal(result[0], characters[0]);
  assert.equal(result[1].status, 'error');
  assert.equal(result[1].error, 'Quota exhausted');
  assert.equal(result[1].imageUrl, undefined);
});

test('empty incremental recovery does not rewrite existing character records', () => {
  const characters = [{ id: 'a', imageUrl: '/current', status: 'done' }];
  const items = [{ id: 'a', imageUrl: '/old', status: 'done' }];
  assert.equal(mergeNewBatchResults(characters, items, new Set())[0], characters[0]);
});
