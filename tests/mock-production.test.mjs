import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceMockJob, mockEligibleIds, readMockJobs, writeMockJobs } from '../lib/mock-production.ts';

const base = {
  id: 'test-job', projectId: 'collection-a', model: 'TEST model', createdAt: 1000,
  status: 'pending', characterIds: ['a', 'b'], total: 2, completed: 0, failed: 0,
  imported: 0, assets: [], scenario: 'success',
};

test('mock success progresses without network or production state', () => {
  assert.equal(advanceMockJob(base, 1000).status, 'pending');
  assert.equal(advanceMockJob(base, 3000).status, 'in_progress');
  const final = advanceMockJob(base, 11000);
  assert.equal(final.status, 'completed');
  assert.equal(final.completed, 2);
  assert.equal(final.imported, 2);
  assert.equal(final.assets.length, 2);
});

test('mock partial failure is reported per item', () => {
  const final = advanceMockJob({ ...base, scenario: 'partial_failure' }, 11000);
  assert.equal(final.status, 'completed_with_errors');
  assert.equal(final.completed, 1);
  assert.equal(final.failed, 1);
  assert.equal(final.assets.filter(item => item.status === 'error').length, 1);
});

test('mock quota error never creates an image asset', () => {
  const final = advanceMockJob({ ...base, scenario: 'quota_error' }, 11000);
  assert.equal(final.status, 'failed');
  assert.match(final.warning, /SIMULATED insufficient_quota/);
  assert.equal(final.assets.some(item => item.status === 'done'), false);
});

test('simulated jobs survive browser-local persistence and block duplicate submissions', () => {
  const storage = new Map();
  const adapter = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  writeMockJobs(adapter, [base]);
  const restored = readMockJobs(adapter, 11000);
  assert.equal(restored[0].status, 'completed');
  assert.deepEqual(mockEligibleIds([{ id: 'a', prompt: 'bear' }, { id: 'b', prompt: 'fox' }, { id: 'c', prompt: 'owl' }], restored, 'collection-a'), ['c']);
  assert.deepEqual(mockEligibleIds([{ id: 'a', prompt: 'new collection bear' }], restored, 'collection-b'), ['a']);
});
