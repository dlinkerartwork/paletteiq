import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGeminiKeyring, serializeGeminiKeyring, isGeminiQuotaExhausted, isGeminiModelUnavailable, geminiKeyCycle, isGeminiQuotaResponse } from '../lib/gemini-keyring.ts';

test('legacy single Gemini key remains first when upgrading to encrypted keyring', () => {
  assert.deepEqual(parseGeminiKeyring('AIza-legacy'), ['AIza-legacy']);
  assert.deepEqual(parseGeminiKeyring(serializeGeminiKeyring(['AIza-legacy', 'AIza-second'])), ['AIza-legacy', 'AIza-second']);
  assert.deepEqual(parseGeminiKeyring(null), []);
  assert.deepEqual(parseGeminiKeyring(serializeGeminiKeyring(['one', 'one', 'two'])), ['one', 'two']);
});

test('Gemini only rotates on quota exhaustion, not unavailable models or provider outages', () => {
  assert.equal(isGeminiQuotaExhausted(429, 'RESOURCE_EXHAUSTED'), true);
  assert.equal(isGeminiQuotaExhausted(403, 'RESOURCE_EXHAUSTED'), true);
  assert.equal(isGeminiQuotaExhausted(503, 'UNAVAILABLE'), false);
  assert.equal(isGeminiQuotaExhausted(404, 'NOT_FOUND'), false);
  assert.equal(isGeminiModelUnavailable(404, 'This model is no longer available to new users'), true);
  assert.equal(isGeminiModelUnavailable(429, 'RESOURCE_EXHAUSTED'), false);
});

test('Gemini key rotation makes exactly one full circular pass and revisits the first key', () => {
  const owner = 'rotation-test-store';
  const keys = ['key-one', 'key-two', 'key-three'];
  assert.deepEqual(geminiKeyCycle(owner, keys), ['key-one', 'key-two', 'key-three']);
  assert.deepEqual(geminiKeyCycle(owner, keys), ['key-two', 'key-three', 'key-one']);
  assert.deepEqual(geminiKeyCycle(owner, keys), ['key-three', 'key-one', 'key-two']);
  assert.deepEqual(geminiKeyCycle(owner, keys), ['key-one', 'key-two', 'key-three']);
  assert.deepEqual(geminiKeyCycle('another-store', keys), keys);
  assert.deepEqual(geminiKeyCycle(owner, ['key-one', 'key-one', 'key-two']), ['key-one', 'key-two']);
  assert.deepEqual(geminiKeyCycle(owner, []), []);
});

test('Gemini quota response detection ignores permission, unavailable model, and service outage', () => {
  assert.equal(isGeminiQuotaResponse(429, '{}'), true);
  assert.equal(isGeminiQuotaResponse(403, JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } })), true);
  assert.equal(isGeminiQuotaResponse(403, JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Access denied' } })), false);
  assert.equal(isGeminiQuotaResponse(404, 'Model not found'), false);
  assert.equal(isGeminiQuotaResponse(503, JSON.stringify({ error: { status: 'UNAVAILABLE' } })), false);
});
