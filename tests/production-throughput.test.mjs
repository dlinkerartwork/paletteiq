import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runBoundedQueue } from '../lib/standard-bulk-queue.ts';

const batch = readFileSync(new URL('../app/api/image-batches/route.ts', import.meta.url), 'utf8');
const standard = readFileSync(new URL('../app/api/studio/route.ts', import.meta.url), 'utf8');
const frontend = readFileSync(new URL('../components/image-production.tsx', import.meta.url), 'utf8');
const queue = readFileSync(new URL('../lib/image-review-queue.ts', import.meta.url), 'utf8');
const automation = readFileSync(new URL('../app/api/full-automation/route.ts', import.meta.url), 'utf8');

test('50 and 100 Standard Bulk jobs never exceed 3–5 workers or duplicate a request', async () => {
  for (const count of [50, 100]) {
    for (const workers of [3, 5]) {
      let active = 0; let peak = 0;
      const calls = new Map();
      const ticks = [];
      const started = performance.now();
      const result = await runBoundedQueue(
        Array.from({ length: count }, (_, i) => i), workers,
        async index => {
          active++; peak = Math.max(peak, active);
          calls.set(index, (calls.get(index) || 0) + 1);
          await new Promise(resolve => setTimeout(resolve, 2));
          active--;
        }, (done, total) => { ticks.push(done); assert.equal(total, count); });
      const elapsedMs = performance.now() - started;
      assert.equal(result.completed, count);
      assert.equal(result.failed, 0);
      assert.equal(calls.size, count);
      assert.ok([...calls.values()].every(n => n === 1));
      assert.equal(peak, workers);
      assert.deepEqual(ticks, Array.from({ length: count }, (_, i) => i + 1));
      assert.ok(elapsedMs < 2000, 'simulated queue should not stall');
    }
  }
});

test('Standard Bulk marks failures without secretly repeating billed attempts', async () => {
  const calls = new Map();
  const result = await runBoundedQueue(Array.from({ length: 100 }, (_, i) => i), 5, async n => {
    calls.set(n, (calls.get(n) || 0) + 1);
    if (n % 11 === 0) throw Error('Simulated intermittent API failure');
  });
  assert.equal(result.completed, 100);
  assert.equal(result.failed, 10);
  assert.ok([...calls.values()].every(n => n === 1));
  await assert.rejects(runBoundedQueue([1], 6, async () => {}), /between 1 and 5/);
});

test('Batch import and QC remain separate, resumable, and safe for Full Automation', () => {
  assert.match(batch, /handled >= BATCH_IMPORT_LIMIT/);
  assert.match(queue, /BATCH_IMPORT_LIMIT = 12/);
  assert.match(queue, /BATCH_REVIEW_LIMIT = 4/);
  assert.match(batch, /reviewStoredBatchImage\(/);
  assert.match(batch, /Promise\.all\(reviewQueue\.map\(async item =>/);
  assert.match(batch, /pendingBatchReviewCount\(items\) \? 'reviewing'/);
  assert.match(batch, /mergeNewBatchResults\(project\.characters, items, changedIds\)/);
  assert.match(automation, /isActiveBatchStatus\(row\.status\)/);
  assert.match(frontend, /runBoundedQueue\(selected, bulkWorkers/);
  assert.match(standard, /eq\(projects\.updatedAt, latest\.updatedAt\)/);
});
