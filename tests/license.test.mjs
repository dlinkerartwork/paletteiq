import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PRODUCT, deviceCode, verifyLicense } = require('../desktop/license.cjs');
test('perpetual license is device-bound and signed', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const code = deviceCode('SAMPLE-GUID');
  const payload = { version: 1, product: PRODUCT, type: 'perpetual', deviceCode: code, issuedTo: 'Test' };
  const data = { payload, signature: sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString('base64') };
  assert.equal(verifyLicense(data, publicKey, code).issuedTo, 'Test');
  assert.throws(() => verifyLicense(data, publicKey, deviceCode('OTHER')), /another Windows device/);
  assert.throws(() => verifyLicense({ ...data, payload: { ...payload, issuedTo: 'Altered' } }, publicKey, code), /signature/);
});
