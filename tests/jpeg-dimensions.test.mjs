import test from 'node:test';
import assert from 'node:assert/strict';
import { jpegDimensions } from '../lib/jpeg-dimensions.ts';

const jpeg = marker => Uint8Array.from([
  0xff,0xd8, 0xff,0xe0,0,4,1,2, // SOI and APP metadata
  0xff,marker,0,11,8,0x10,0,0x18,0,1,1,0x11,0,
  0xff,0xd9,
]);

test('reads baseline and progressive JPEG dimensions past metadata', () => {
  for (const marker of [0xc0,0xc2]) {
    assert.deepEqual(jpegDimensions(jpeg(marker)), { width: 6144, height: 4096 });
  }
});

test('rejects PNG, truncated metadata, missing SOF and zero dimensions', () => {
  for (const data of [new Uint8Array(), Uint8Array.from([137,80,78,71]), jpeg(0xc0).slice(0,12), Uint8Array.from([255,216,255,217])]) {
    assert.throws(() => jpegDimensions(data), /valid JPEG/);
  }
  const zero = jpeg(0xc0); zero[15] = 0;
  assert.throws(() => jpegDimensions(zero), /valid JPEG/);
});
