import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadOrCreateKey } = require('../desktop/key-vault.cjs');
const fakeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(`protected:${value}`, 'utf8'),
  decryptString: bytes => bytes.toString('utf8').replace(/^protected:/, ''),
};

test('master key is protected at rest and remains stable after restart', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paletteiq-vault-test-'));
  try {
    const key = loadOrCreateKey(directory, fakeStorage);
    assert.match(key, /^[a-f0-9]{64}$/);
    const stored = readFileSync(path.join(directory, 'desktop-secrets.json'), 'utf8');
    assert.ok(!stored.includes(key));
    assert.equal(loadOrCreateKey(directory, fakeStorage), key);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('previous plaintext key is migrated without breaking existing encrypted credentials', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paletteiq-vault-test-'));
  try {
    const original = 'b'.repeat(64);
    writeFileSync(path.join(directory, 'desktop-secrets.json'), JSON.stringify({ encryptionKey: original }));
    assert.equal(loadOrCreateKey(directory, fakeStorage), original);
    const persisted = JSON.parse(readFileSync(path.join(directory, 'desktop-secrets.json'), 'utf8'));
    assert.equal(persisted.version, 2);
    assert.ok(!('encryptionKey' in persisted));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('unavailable secure storage refuses to generate a weaker replacement key', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paletteiq-vault-test-'));
  try { assert.throws(() => loadOrCreateKey(directory, { isEncryptionAvailable: () => false }), /unavailable/); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});
