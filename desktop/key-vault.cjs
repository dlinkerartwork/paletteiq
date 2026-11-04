const { existsSync, readFileSync, writeFileSync, renameSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const path = require('node:path');

function ensureEncryptionAvailable(safeStorage) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable. API credentials were not changed.');
}

/** Windows user-bound encrypted storage for the stable API-credential master key. */
function loadOrCreateKey(directory, safeStorage) {
  ensureEncryptionAvailable(safeStorage);
  const filename = path.join(directory, 'desktop-secrets.json');
  const store = value => {
    const protectedKey = safeStorage.encryptString(value).toString('base64');
    const replacement = `${filename}.new`;
    writeFileSync(replacement, JSON.stringify({ version: 2, protectedKey }), { mode: 0o600, flag: 'w' });
    renameSync(replacement, filename);
  };

  if (!existsSync(filename)) {
    const generated = randomBytes(32).toString('hex');
    store(generated);
    return generated;
  }
  const settings = JSON.parse(readFileSync(filename, 'utf8'));
  if (settings.version === 2 && typeof settings.protectedKey === 'string') {
    const key = safeStorage.decryptString(Buffer.from(settings.protectedKey, 'base64'));
    if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('Protected credential key is invalid');
    return key;
  }
  // Upgrade from the developer-preview plaintext master key WITHOUT generating
  // another key. The existing encrypted Etsy/OpenAI credentials remain readable.
  if (typeof settings.encryptionKey === 'string' && /^[a-f0-9]{64}$/i.test(settings.encryptionKey)) {
    store(settings.encryptionKey);
    return settings.encryptionKey;
  }
  throw new Error('Unrecognized credential key format. Restore the original backup instead of resetting this file.');
}

module.exports = { loadOrCreateKey };
