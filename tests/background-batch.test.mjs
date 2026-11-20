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
  assert.match(page, /characters:local\.characters\.map\(char=>/);
  assert.match(page, /\.\.\.char,imageUrl:saved\.imageUrl/);
});


test('finished image batches send through Desktop native SMTP without GPU dependency', () => {
  const notifier = readFileSync(new URL('../lib/image-batch-email.ts', import.meta.url), 'utf8');
  assert.match(route, /notifyEmail: true/);
  assert.match(route, /queueFinishedImageBatchEmail\(savedJob/);
  assert.match(route, /pendingImageBatchNotification\(row\)/);
  assert.match(notifier, /nativeSmtpOperation\(owner/);
  assert.doesNotMatch(notifier, /gpuFetch|upscale-batch-transport/);
  assert.match(notifier, /notificationQueuedAt/);
  assert.match(notifier, /notificationLastAttemptAt/);
  assert.match(notifier, /eq\(imageBatches\.items, job\.items\)/);
});

test('OpenAI completed triggers local SMTP before PNG import without GPU registration', () => {
  const syncJobStart = route.indexOf('async function syncJob(');
  assert.ok(syncJobStart >= 0, 'Image Batch sync function must exist');
  const syncJob = route.slice(syncJobStart);
  // Verify the completion path rather than depending on exact whitespace
  // and indentation of queueFinishedImageBatchEmail's arguments.
  const completion = syncJob.search(/if\s*\(\s*batch\.status\s*===\s*['"]completed['"]/);
  const earlyEmail = syncJob.search(/await\s+queueFinishedImageBatchEmail\s*\(\s*job\s*,\s*owner\b/);
  const outputGuard = syncJob.search(/if\s*\(\s*awaitBatchOutputFiles\s*\(\s*batch\s*\)\s*\)/);
  assert.ok(completion >= 0, 'OpenAI completion must be checked before sending email');
  assert.ok(earlyEmail > completion, 'SMTP notification must be queued after verified completion');
  assert.match(syncJob.slice(completion, earlyEmail), /pendingImageBatchNotification\s*\(\s*job\s*,\s*Date\.now\(\)\s*,\s*true\s*\)/);
  assert.ok(outputGuard > earlyEmail, 'email must be sent before PNG import');
  assert.doesNotMatch(route, /\/v1\/notifications\/image-batches/);
  assert.doesNotMatch(route, /gpuFetch/);
});
