import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGeminiKeyring, serializeGeminiKeyring, isGeminiQuotaExhausted, isGeminiModelUnavailable } from '../lib/gemini-keyring.ts';

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
