import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validImageNaming, createImageFileNamer, DEFAULT_IMAGE_NAMING } from '../lib/image-file-naming.ts';

const context = { theme: 'Flowers & Blossoms', collection: 'Spring Garden Set' };

test('legacy default naming stays backward compatible', () => {
  const next = createImageFileNamer(DEFAULT_IMAGE_NAMING, context);
  assert.equal(next('Rose', 0, 'png'), 'flowers_blossoms_001.png');
  assert.equal(next('Rose', 1, 'jpg'), 'flowers_blossoms_002.jpg');
});

test('editable placeholders create meaningful sanitized filenames', () => {
  const next = createImageFileNamer('{collection}_{character}_{number}', context);
  assert.equal(next('Red Rose', 0, 'png'), 'spring_garden_set_red_rose_001.png');
});

test('identical character names never collide in one ZIP', () => {
  const next = createImageFileNamer('{character}', context);
  assert.equal(next('Rose', 0, 'png'), 'rose.png');
  assert.equal(next('Rose', 1, 'png'), 'rose_2.png');
  assert.equal(next('ROSE', 2, 'png'), 'rose_3.png');
});

test('literal or overlong templates cannot cause duplicate ZIP entry names', () => {
  const next = createImageFileNamer('artwork', context);
  const files = Array.from({ length: 110 }, (_, i) => next('Same', i, 'jpg'));
  assert.equal(new Set(files).size, 110);
  assert.equal(files[109], 'artwork_110.jpg');
});

test('unsafe paths and unknown placeholders are rejected', () => {
  for (const pattern of ['../images/{number}', '{unrecognized}', 'folder\\{number}', '', 'x'.repeat(121), '{theme}/{number}']) {
    assert.equal(validImageNaming(pattern), false, pattern);
  }
  assert.equal(validImageNaming('{theme}_{number}'), true);
});

test('ZIP export uses saved preference and resolves versioned Batch assets', () => {
  const source = readFileSync(new URL('../app/api/exports/route.ts', import.meta.url), 'utf8');
  assert.match(source, /createImageFileNamer\(pattern/);
  assert.match(source, /batchAssetKey\(user\.userId/);
  assert.match(source, /imageFileName\(character\.name, index, extension\)/);
});
