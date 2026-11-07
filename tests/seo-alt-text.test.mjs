import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSeoAlt, hasTargetSeoAltLength } from '../lib/seo-alt-text.ts';

test('short 250-character Gemini alt is rejected for automatic expansion', () => {
  assert.equal(hasTargetSeoAltLength('A'.repeat(250)), false);
});

test('detailed English alt between 460 and 500 characters is accepted', () => {
  assert.equal(hasTargetSeoAltLength('A'.repeat(470)), true);
  assert.equal(hasTargetSeoAltLength('A'.repeat(500)), true);
});

test('overlong alt text is safely shortened at a word boundary', () => {
  const generated = 'A detailed illustrated bouquet with natural colors and soft textures. '.repeat(11);
  const normalized = normalizeSeoAlt(generated);
  assert.ok(normalized.length >= 460 && normalized.length <= 500);
  assert.ok(!normalized.endsWith(' '));
});

test('invalid Gemini alt output remains unaccepted', () => {
  assert.equal(hasTargetSeoAltLength(undefined), false);
  assert.equal(hasTargetSeoAltLength(''), false);
});
