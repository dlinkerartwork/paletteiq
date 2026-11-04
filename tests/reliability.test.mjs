import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

async function load(source) {
  const code = ts.transpileModule(readFileSync(new URL(source, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

test('only never-generated prompts enter bulk generation', async () => {
  const { eligibleForBulk, wasPreviouslyGenerated, isActiveBatchStatus } = await load('../lib/production-rules.ts');
  assert.equal(eligibleForBulk({ prompt: 'flower', status: 'ready' }), true);
  assert.equal(eligibleForBulk({ prompt: '' }), false);
  assert.equal(eligibleForBulk({ prompt: 'flower', status: 'done' }), false);
  assert.equal(eligibleForBulk({ prompt: 'flower', status: 'error' }), false);
  assert.equal(eligibleForBulk({ prompt: 'flower', status: 'ready', imageUrl: '/api/images/foo' }), false);
  assert.equal(eligibleForBulk({ prompt: 'flower', status: 'ready' }, true), false);
  assert.equal(wasPreviouslyGenerated({ status: 'error' }), true);
  assert.equal(isActiveBatchStatus('in_progress'), true);
  assert.equal(isActiveBatchStatus('importing'), true);
  assert.equal(isActiveBatchStatus('completed_with_errors'), false);
  assert.equal(isActiveBatchStatus('failed'), false);
});

test('ZIP output has valid CRC32 and central directory for multiple files', async () => {
  const { zipStream } = await load('../lib/zip-stream.ts');
  const bytes = new TextEncoder();
  const file = (name, content) => ({ name, stream: async () => new ReadableStream({ start(c) { c.enqueue(bytes.encode(content)); c.close(); } }) });
  const parts = [];
  for await (const part of zipStream([file('first.txt', '123456789'), file('second.txt', 'hello')])) parts.push(Buffer.from(part));
  const archive = Buffer.concat(parts);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  assert.equal(archive.readUInt16LE(archive.length - 12), 2);
  assert.equal(archive.includes(Buffer.from([0x26, 0x39, 0xf4, 0xcb])), true); // CRC32 123456789
  assert.equal(archive.includes(Buffer.from('first.txt')), true);
  assert.equal(archive.includes(Buffer.from('second.txt')), true);
});

test('SEO editorial audit highlights missing fields without pretending to be Etsy search data', async () => {
  const { auditSeo } = await load('../lib/seo-intelligence.ts');
  const empty = { title: '', description: '', tags: [], primaryKeyword: '', categorySuggestion: '', attributes: { style: '', primaryColor: '' }, digitalFiles: [], licenseNotes: '', photoPlan: [] };
  const start = auditSeo(empty);
  assert.equal(start.score, 0);
  assert.equal(start.checks.find(c => c.id === 'tags-count').passed, false);
  const improved = auditSeo({ ...empty, title: 'Watercolor Wildflower Clipart Bundle', primaryKeyword: 'watercolor wildflower', description: 'Watercolor wildflower clipart artwork for creative projects. Includes a curated collection of botanical subjects. Please confirm file formats and use rights.', tags: Array.from({ length: 13 }, (_, i) => `flower ${i + 1}`), categorySuggestion: 'Digital clipart', attributes: { style: 'watercolor', primaryColor: 'pink' }, digitalFiles: ['confirm-pack.zip'], licenseNotes: 'Confirm license', photoPlan: ['Cover preview'] });
  assert.equal(improved.score, 100);
});
