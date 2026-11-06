import test from 'node:test';
import assert from 'node:assert/strict';
import { batchAssetKey, batchAssetUrl } from '../lib/batch-assets.ts';
import { mergeNewBatchResults } from '../lib/batch-recovery.ts';

const character = '11111111-1111-4111-8111-111111111111';
const older = '22222222-2222-4222-8222-222222222222';
const newer = '33333333-3333-4333-8333-333333333333';

test('delayed Batch outputs use different immutable object keys', () => {
  assert.notEqual(batchAssetKey('owner', character, 'png', older), batchAssetKey('owner', character, 'png', newer));
  assert.equal(batchAssetKey('owner', character, 'png', older), `generated/owner/batches/${older}/${character}.png`);
  assert.equal(batchAssetUrl(character, 'png', older), `/api/images/${character}?format=png&batch=${older}`);
});

test('Batch assets cannot overwrite legacy single-image generation object', () => {
  assert.notEqual(batchAssetKey('owner', character, 'jpg', older), `generated/owner/${character}.jpg`);
});

test('invalid Batch identifiers are rejected before object lookup', () => {
  assert.throws(() => batchAssetKey('owner', character, 'png', '../escape'));
  assert.throws(() => batchAssetUrl(character, 'png', '../escape'));
});

test('replay after restart is idempotent and keeps latest regeneration', () => {
  const oldResult = [{ id: character, status: 'done', imageUrl: batchAssetUrl(character, 'png', older) }];
  const initial = [{ id: character, status: 'ready', imageUrl: '' }];
  const imported = mergeNewBatchResults(initial, oldResult, new Set([character]));
  assert.equal(imported[0].imageUrl, oldResult[0].imageUrl);
  assert.equal(mergeNewBatchResults(imported, oldResult, new Set())[0], imported[0]);
  const regenerated = [{ ...imported[0], imageUrl: '/api/images/regenerated.png' }];
  assert.equal(mergeNewBatchResults(regenerated, oldResult, new Set([character]))[0], regenerated[0]);
});
