'use strict';

const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const { sendSmtpMessage, validateSmtpConfig, completionMessage } = require('./smtp-mailer.cjs');

const ADDRESS = /^[^\s@<>"()[\],;:]{1,64}@[A-Za-z0-9.-]{1,189}$/;
// Matches the authenticated store namespace created by scopeForStore(accountId, storeId).
const OWNER = /^user_[0-9a-f]{32}_store_[0-9a-f]{32}$/i;
const BATCH = /^[0-9a-f-]{36}$/i;
const SAFE_ID = /^batch_[a-z0-9_-]{1,120}$/i;

function createNativeSmtpService(db, options = {}) {
  const defaults = options.smtpDefaults || {};
  const key = Buffer.from(options.smtpEncryptionKey || '', 'hex');
  if (key.length !== 32) throw new Error('Native SMTP requires the encrypted workspace key');
  const deliver = options.sendMail || sendSmtpMessage;
  const ongoing = new Set();
  db.exec('CREATE TABLE IF NOT EXISTS desktop_smtp_settings (' +
    'owner TEXT PRIMARY KEY, host TEXT NOT NULL, port INTEGER NOT NULL,' +
    'username TEXT NOT NULL, sender TEXT NOT NULL,' +
    'encrypted_password TEXT NOT NULL, updated_at INTEGER NOT NULL);' +
    'CREATE TABLE IF NOT EXISTS desktop_smtp_mail (' +
    'owner TEXT NOT NULL, batch_id TEXT NOT NULL, recipient TEXT NOT NULL,' +
    'store_name TEXT NOT NULL, collection_name TEXT NOT NULL,' +
    'status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,' +
    'created_at INTEGER NOT NULL, sent_at INTEGER,' +
    'PRIMARY KEY(owner,batch_id));');

  function encrypt(password, owner) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(owner));
    const data = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), data.toString('base64'),
      cipher.getAuthTag().toString('base64')].join('.');
  }
  function decrypt(value, owner) {
    const [version, iv, payload, tag] = value.split('.');
    if (version !== 'v1') throw new Error('SMTP password encryption format is unsupported');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(owner));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload, 'base64')), decipher.final()]).toString('utf8');
  }
  const lookup = owner => db.prepare('SELECT * FROM desktop_smtp_settings WHERE owner=?').get(owner);
  function config(owner) {
    const row = lookup(owner);
    if (!row) return validateSmtpConfig(defaults);
    return validateSmtpConfig({
      host: row.host, port: row.port, username: row.username,
      sender: row.sender, password: decrypt(row.encrypted_password, owner),
    });
  }
  function status(owner) {
    const row = lookup(owner);
    let usable = true;
    try { config(owner); } catch { usable = false; }
    let bundled = true;
    try { validateSmtpConfig(defaults); } catch { bundled = false; }
    return {
      available: true, configured: usable, source: row ? 'store' : 'installer-env',
      hasOverride: Boolean(row), bundledConfigured: bundled,
      host: row?.host || defaults.host || '',
      port: row?.port || defaults.port || 587,
      username: row?.username || defaults.username || '',
      sender: row?.sender || defaults.sender || '',
      passwordConfigured: usable,
    };
  }
  function save(owner, input) {
    const old = lookup(owner);
    const password = typeof input.password === 'string' && input.password.trim()
      ? input.password.trim()
      : old ? decrypt(old.encrypted_password, owner)
        : (String(input.username || '').trim().toLowerCase() === String(defaults.username || '').trim().toLowerCase() &&
           String(input.host || '').trim().toLowerCase() === String(defaults.host || '').trim().toLowerCase()
           ? defaults.password : '');
    const settings = validateSmtpConfig({
      host: input.host, port: input.port,
      username: input.username, sender: input.sender, password,
    });
    const sealed = encrypt(settings.password, owner);
    db.prepare('INSERT INTO desktop_smtp_settings ' +
        '(owner,host,port,username,sender,encrypted_password,updated_at) ' +
        'VALUES(?,?,?,?,?,?,?) ' +
        'ON CONFLICT(owner) DO UPDATE SET host=excluded.host,port=excluded.port,' +
          'username=excluded.username,sender=excluded.sender,' +
          'encrypted_password=excluded.encrypted_password,updated_at=excluded.updated_at')
      .run(owner, settings.host, settings.port, settings.username,
        settings.sender, sealed, Date.now());
    return status(owner);
  }
  function reset(owner) {
    db.prepare('DELETE FROM desktop_smtp_settings WHERE owner=?').run(owner);
    return status(owner);
  }

  async function notify(owner, payload) {
    const id = payload.batchId;
    if (!BATCH.test(id || '') || !SAFE_ID.test(payload.openaiBatchId || '') ||
        !ADDRESS.test(payload.recipient || '') ||
        typeof payload.storeName !== 'string' || !payload.storeName.trim() ||
        payload.storeName.length > 90 ||
        typeof payload.collectionName !== 'string' || !payload.collectionName.trim() ||
        payload.collectionName.length > 160)
      throw new Error('Invalid image batch email metadata');
    const total = payload.total;
    const completed = payload.completed;
    const failed = payload.failed;
    if (!Number.isSafeInteger(total) || total < 1 || total > 120 ||
        !Number.isSafeInteger(completed) || !Number.isSafeInteger(failed) ||
        !((completed === -1 && failed === -1) ||
          (completed >= 0 && failed >= 0 && completed + failed === total)))
      throw new Error('Invalid image batch counts');
    const pendingKey = owner + ':' + id;
    if (ongoing.has(pendingKey)) throw new Error('Batch notification is already sending');
    const existing = db.prepare('SELECT * FROM desktop_smtp_mail WHERE owner=? AND batch_id=?').get(owner, id);
    if (existing && (existing.recipient !== payload.recipient ||
        existing.store_name !== payload.storeName ||
        existing.collection_name !== payload.collectionName))
      throw new Error('Batch email identity does not match the saved request');
    if (existing?.status === 'sent') return { accepted: true, alreadySent: true };
    if (existing && existing.attempts >= 8) throw new Error('Batch email retry limit reached');
    if (!existing && db.prepare('SELECT COUNT(*) AS n FROM desktop_smtp_mail WHERE owner=? AND created_at>?')
      .get(owner, Date.now() - 86_400_000).n >= 100) throw new Error('Daily SMTP notification limit reached');
    const settings = config(owner);
    ongoing.add(pendingKey);
    let claimed = false;
    try {
      db.prepare('INSERT INTO desktop_smtp_mail ' +
          '(owner,batch_id,recipient,store_name,collection_name,status,attempts,created_at) ' +
          "VALUES(?,?,?,?,?,'sending',1,?) " +
          "ON CONFLICT(owner,batch_id) DO UPDATE SET status='sending',attempts=attempts+1")
        .run(owner, id, payload.recipient, payload.storeName, payload.collectionName, Date.now());
      claimed = true;
      await deliver(settings, completionMessage(payload));
      db.prepare("UPDATE desktop_smtp_mail SET status='sent',sent_at=? WHERE owner=? AND batch_id=?")
        .run(Date.now(), owner, id);
      return { accepted: true, alreadySent: false };
    } catch (error) {
      if (claimed) db.prepare("UPDATE desktop_smtp_mail SET status='retry' WHERE owner=? AND batch_id=?")
        .run(owner, id);
      throw error;
    } finally { ongoing.delete(pendingKey); }
  }

  async function handle(body) {
    const owner = body?.owner;
    if (typeof owner !== 'string' || !OWNER.test(owner))
      return { status: 400, body: { error: 'Invalid store ID' } };
    try {
      if (body.action === 'status') return { status: 200, body: status(owner) };
      if (body.action === 'save') return { status: 200, body: save(owner, body) };
      if (body.action === 'reset') return { status: 200, body: reset(owner) };
      if (body.action === 'test') {
        if (!ADDRESS.test(body.recipient || '')) throw new Error('Invalid test recipient');
        const settings = config(owner);
        await deliver(settings, {
          recipient: body.recipient, subject: 'PaletteIQ Desktop SMTP test',
          body: 'Your PaletteIQ Desktop SMTP settings work.\n\n' +
            'OpenAI Batch completion emails are sent directly from this Windows computer.\n',
        });
        return { status: 200, body: { accepted: true } };
      }
      if (body.action === 'send') return { status: 200, body: await notify(owner, body) };
      return { status: 400, body: { error: 'Unsupported SMTP operation' } };
    } catch (error) {
      return { status: 422, body: { error: error instanceof Error ? error.message.slice(0,180) : 'SMTP operation failed' } };
    }
  }
  return { handle, status, encrypt, decrypt };
}

module.exports = { createNativeSmtpService };
