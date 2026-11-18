import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../app/api/image-batches/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('desktop batch resumes without visiting Image Production', () => {
  assert.match(route, /searchParams\.get\('syncAll'\) === '1'/);
  assert.match(route, /await syncJob\(row, key, user\.userId, user\.email, user\.displayName\)/);
  assert.match(page, /\/api\/image-batches\?syncAll=1/);
  assert.match(page, /tab === 'production'/);
});

test('background sync updates only recovered image fields, preserving unsaved character details', () => {
  assert.match(page, /characters: prev\.characters\.map\(char =>/);
  assert.match(page, /\.\.\.char, imageUrl: stored\.imageUrl/);
});


test('finished image batches enqueue a durable email receipt using the GPU server SMTP relay', () => {
  const notifier = readFileSync(new URL('../lib/image-batch-email.ts', import.meta.url), 'utf8');
  assert.match(route, /notifyEmail: true/);
  assert.match(route, /queueFinishedImageBatchEmail\(savedJob/);
  assert.match(route, /pendingImageBatchNotification\(row\)/);
  assert.match(notifier, /\/v1\/notifications\/image-batches/);
  assert.match(notifier, /notificationQueuedAt/);
  assert.match(notifier, /notificationLastAttemptAt/);
  assert.match(notifier, /eq\(imageBatches\.items, job\.items\)/);
});

test('OpenAI completed triggers email before PNG import and registers webhooks', () => {
  const completion = route.indexOf("batch.status === 'completed'");
  const earlyEmail = route.indexOf('queueFinishedImageBatchEmail(\n        job, owner');
  const outputGuard = route.indexOf('if (awaitBatchOutputFiles(batch))');
  assert.ok(completion >= 0 && earlyEmail > completion);
  assert.ok(outputGuard > earlyEmail, 'email must be sent before PNG import');
  assert.match(route, /\/v1\/notifications\/image-batches\/register/);
  assert.match(route, /openai_batch_id: job\.id/);
  assert.match(route, /signal: AbortSignal\.timeout\(5000\)/);
});
