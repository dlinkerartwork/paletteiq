import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { createNativeSmtpService } = require('../desktop/native-smtp-service.cjs');
const { validateSmtpConfig, completionMessage, smtpBody } = require('../desktop/smtp-mailer.cjs');
const { formatDesktopSmtpForBundle, parseDotEnv } = require('../desktop/smtp-config.cjs');

const owner = '00000000-0000-4000-8000-000000000001';
const batchId = '11111111-1111-4111-8111-111111111111';
const defaults = {
  host: 'smtp.gmail.com', port: 587, username: 'artist@gmail.com',
  sender: 'artist@gmail.com', password: 'test-app-password',
};
function setup(sendMail = async () => {}) {
  const db = new DatabaseSync(':memory:');
  const service = createNativeSmtpService(db, {
    smtpDefaults: defaults, smtpEncryptionKey: 'a'.repeat(64), sendMail,
  });
  return { db, service };
}
const payload = {
  action: 'send', owner, batchId, openaiBatchId: 'batch_abc123',
  recipient: 'storeowner@example.com', storeName: 'Blush Safari Shop',
  collectionName: 'Baby Safari Animals', total: 2, completed: 2, failed: 0,
};

test('installer SMTP configuration extracts only allowlisted .env values', () => {
  const env = [
    '# .env with private unrelated service credentials',
    'OPENAI_API_KEY=do-not-package-me',
    'PALETTEIQ_UPSCALE_SERVER_KEY=also-do-not-package',
    'PALETTEIQ_SMTP_HOST=smtp.gmail.com',
    'PALETTEIQ_SMTP_PORT=587',
    'PALETTEIQ_SMTP_USERNAME=artist@gmail.com',
    'PALETTEIQ_SMTP_PASSWORD=example-app-password',
    'PALETTEIQ_SMTP_FROM=artist@gmail.com',
  ].join('\n');
  const subset = formatDesktopSmtpForBundle(env);
  assert.match(subset, /PALETTEIQ_SMTP_PASSWORD=example-app-password/);
  assert.doesNotMatch(subset, /OPENAI_API_KEY|UP S CALE|UPSALE|UP S CALE|PALETTEIQ_UPSCALE_SERVER_KEY/);
  assert.equal(parseDotEnv(subset).PALETTEIQ_SMTP_HOST, 'smtp.gmail.com');
  assert.equal(formatDesktopSmtpForBundle('PALETTEIQ_SMTP_HOST=smtp.gmail.com'), '');
});

test('only encrypted per-store SMTP overrides are saved; default remains available', async () => {
  const { db, service } = setup();
  try {
    const first = await service.handle({ owner, action: 'status' });
    assert.equal(first.status, 200);
    assert.equal(first.body.configured, true);
    assert.equal(first.body.source, 'installer-env');
    const updated = await service.handle({
      owner, action: 'save', host: 'smtp.gmail.com', port: 465,
      username: 'different@gmail.com', sender: 'different@gmail.com',
      password: 'another-secret',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.source, 'store');
    assert.equal(updated.body.host, 'smtp.gmail.com');
    assert.equal(updated.body.password, undefined);
    const record = db.prepare('SELECT encrypted_password FROM desktop_smtp_settings WHERE owner=?').get(owner);
    assert.ok(record.encrypted_password.startsWith('v1.'));
    assert.doesNotMatch(record.encrypted_password, /another-secret/);
    assert.equal(service.decrypt(record.encrypted_password, owner), 'another-secret');
    const restored = await service.handle({ owner, action: 'reset' });
    assert.equal(restored.body.source, 'installer-env');
    assert.equal(restored.body.configured, true);
  } finally { db.close(); }
});

test('desktop sends once per batch, to saved owner only, with completed before PNG import', async () => {
  const delivered = [];
  const { db, service } = setup(async (settings, message) => {
    delivered.push({ settings, message });
  });
  try {
    const result = await service.handle(payload);
    assert.equal(result.status, 200);
    assert.equal(result.body.accepted, true);
    assert.equal((await service.handle(payload)).body.alreadySent, true);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].settings.username, 'artist@gmail.com');
    assert.match(delivered[0].message.body, /Batch is completed/);
    assert.match(delivered[0].message.body, /Collection: Baby Safari Animals/);
    assert.match(delivered[0].message.body, /PNG images may still be importing/);
    assert.equal(db.prepare('SELECT status FROM desktop_smtp_mail').get().status, 'sent');
    const mutated = await service.handle({ ...payload, recipient: 'other@example.com' });
    assert.equal(mutated.status, 422);
    assert.equal(delivered.length, 1);
    const testEmail = await service.handle({
      action: 'test', owner, recipient: 'storeowner@example.com',
    });
    assert.equal(testEmail.body.accepted, true);
    assert.equal(delivered.length, 2);
  } finally { db.close(); }
});

test('failed SMTP retry does not mark batch sent; Gmail password is never logged', async () => {
  let count = 0;
  const { db, service } = setup(async () => {
    if (++count === 1) throw new Error('SMTP rejected request (535)');
  });
  try {
    const first = await service.handle(payload);
    assert.equal(first.status, 422);
    assert.equal(first.body.error, 'SMTP rejected request (535)');
    assert.equal(db.prepare('SELECT status FROM desktop_smtp_mail').get().status, 'retry');
    assert.equal((await service.handle(payload)).body.accepted, true);
    assert.equal(count, 2);
  } finally { db.close(); }
});

test('SMTP mail construction validates addresses and prevents header injection', () => {
  assert.throws(() => validateSmtpConfig({ ...defaults, sender: 'other@gmail.com' }),
    /must match/);
  assert.throws(() => validateSmtpConfig({ ...defaults, port: 25 }), /465 or STARTTLS/);
  const text = smtpBody({
    sender: defaults.sender, recipient: 'shop@example.com',
    subject: 'PaletteIQ Completed\r\nBcc: attacker@example.com',
    body: 'Hello watercolor!',
  });
  assert.doesNotMatch(text, /\r\nBcc:/);
  assert.match(text, /Content-Transfer-Encoding: base64/);
  const notification = completionMessage({
    ...payload, completed: -1, failed: -1,
  });
  assert.match(notification.body, /not yet available/);
});
