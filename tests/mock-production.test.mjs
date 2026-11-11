import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceMockJob, inspectMockStorage, mockEligibleIds, mockRetryableIds, mockOutcomeCounts, readMockJobs, writeMockJobs } from '../lib/mock-production.ts';

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

test('corrupt browser history is reported without modifying stored bytes', () => {
  const storage = new Map([['paletteiq-development-mock-jobs-v1', '{broken-json']]);
  const adapter = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const before = storage.get('paletteiq-development-mock-jobs-v1');
  const inspected = inspectMockStorage(adapter, 11000);
  assert.equal(inspected.jobs.length, 0);
  assert.match(inspected.warning, /could not be read/i);
  assert.equal(storage.get('paletteiq-development-mock-jobs-v1'), before);
});

test('invalid or duplicate mock entries are identified while valid jobs remain recoverable', () => {
  const storage = new Map([['paletteiq-development-mock-jobs-v1', JSON.stringify([base, { ...base }, { id: 'bad', characterIds: 'wrong' }])]]);
  const adapter = { getItem: key => storage.get(key) ?? null };
  const inspected = inspectMockStorage(adapter, 11000);
  assert.equal(inspected.jobs.length, 1);
  assert.equal(inspected.jobs[0].status, 'completed');
  assert.match(inspected.warning, /invalid/i);
});

test('mock recovery does not transform an existing failed quota job into a success', () => {
  const quota = advanceMockJob({ ...base, scenario: 'quota_error' }, 11000);
  const storage = new Map([['paletteiq-development-mock-jobs-v1', JSON.stringify([quota])]]);
  const adapter = { getItem: key => storage.get(key) ?? null };
  const restored = readMockJobs(adapter, 60000);
  assert.equal(restored[0].scenario, 'quota_error');
  assert.equal(restored[0].status, 'failed');
});

test('simulated retry selects failed prompts but never requeues successful or pending results', () => {
  const chars = [{ id: 'a', prompt: 'bear' }, { id: 'b', prompt: 'fox' }, { id: 'c', prompt: 'owl', imageUrl: '/api/images/c' }];
  const partial = advanceMockJob({ ...base, scenario: 'partial_failure' }, 11000);
  assert.deepEqual(mockRetryableIds(chars, [partial], 'collection-a'), ['a']);
  const quota = advanceMockJob({ ...base, scenario: 'quota_error' }, 11000);
  assert.deepEqual(mockRetryableIds(chars, [quota], 'collection-a'), ['a', 'b']);
  assert.deepEqual(mockRetryableIds(chars, [base], 'collection-a'), []);
  const retryPending = { ...base, id: 'retry', createdAt: 12000, characterIds: ['a'], total: 1 };
  assert.deepEqual(mockRetryableIds(chars, [quota, retryPending], 'collection-a'), ['b']);
  const retrySuccess = advanceMockJob({ ...retryPending, scenario: 'success' }, 24000);
  assert.deepEqual(mockRetryableIds(chars, [quota, retrySuccess], 'collection-a'), ['b']);
});

test('TEST totals update after retry completion without claiming production assets exist', () => {
  const characters = [
    { id: 'a', status: 'error' },
    { id: 'b', status: 'done', imageUrl: '/api/images/b' },
    { id: 'c', status: 'error' },
  ];
  const failed = advanceMockJob({ ...base, scenario: 'quota_error' }, 11000);
  assert.deepEqual(mockOutcomeCounts(characters, [failed], 'collection-a'), { successful: 1, failed: 2, pending: 0 });
  const retry = advanceMockJob({ ...base, id: 'retry-all', createdAt: 12000, scenario: 'success' }, 23000);
  assert.deepEqual(mockOutcomeCounts(characters, [failed, retry], 'collection-a'), { successful: 2, failed: 1, pending: 0 });
  const waiting = { ...base, id: 'retry-pending', createdAt: 24000, status: 'pending' };
  assert.deepEqual(mockOutcomeCounts(characters, [failed, waiting], 'collection-a'), { successful: 1, failed: 1, pending: 1 });
});
