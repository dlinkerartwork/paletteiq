#!/usr/bin/env node
/**
 * Explicit OFFLINE migration of old anonymous Desktop assets into an owned store.
 * Close PaletteIQ Desktop first and back up its data folder.
 *
 * node scripts/migrate-legacy-desktop-to-store.cjs --email me@example.com --store-id STORE_UUID --confirm
 */
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync, existsSync, renameSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const args = process.argv.slice(2);
function arg(key) { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; }
function die(reason) { process.stderr.write('Legacy migration refused: ' + reason + '\n'); process.exit(1); }
const email = (arg('--email') || '').trim().toLowerCase();
const storeId = arg('--store-id');
if (!args.includes('--confirm')) die('Add --confirm after backing up and closing PaletteIQ Desktop.');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die('Provide the exact registered --email.');
if (!/^[0-9a-f-]{36}$/.test(storeId || '')) die('Provide a valid store UUID (--store-id).');
const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const workspace = path.resolve(arg('--workspace') || path.join(base, 'PaletteIQ Desktop', 'paletteiq-data'));
const dbPath = path.join(workspace, 'database', 'paletteiq.db');
if (!existsSync(dbPath)) die('Desktop SQLite database not found: ' + dbPath);
const db = new DatabaseSync(dbPath);
try {
  const account = db.prepare('SELECT id FROM paletteiq_accounts WHERE email=?').get(email);
  if (!account) die('No registered PaletteIQ account with this email. Sign in once first.');
  const store = db.prepare('SELECT id,name FROM paletteiq_stores WHERE id=? AND account_id=?').get(storeId, account.id);
  if (!store) die('Store ID does not belong to the specified account.');
  const owner = 'user_' + account.id.replace(/-/g, '') + '_store_' + store.id.replace(/-/g, '');
  const legacy = 'local_seedy';
  const count = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner=?').get(legacy).n;
  const settings = db.prepare('SELECT preferences FROM studio_settings WHERE owner=?').get(legacy);
  if (!count && !settings) die('No anonymous legacy workspace to migrate.');
  const source = path.join(workspace, 'images', 'collections', legacy);
  const destination = path.join(workspace, 'images', 'collections', owner);
  if (existsSync(destination)) die('Target store already has an image directory. Create a fresh empty store.');
  const colliding = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner=? AND id IN (SELECT id FROM projects WHERE owner=?)').get(owner, legacy).n;
  if (colliding) die('Target collection ID collision.');
  const backup = path.join(workspace, 'database', 'upgrade-backups', 'before-legacy-claim-' + Date.now() + '-' + randomUUID() + '.db');
  mkdirSync(path.dirname(backup), { recursive: true });
  db.prepare('VACUUM main INTO ?').run(backup);
  let imagesMoved = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    if (existsSync(source)) {
      mkdirSync(path.dirname(destination), { recursive: true });
      renameSync(source, destination);
      imagesMoved = true;
    }
    db.prepare('UPDATE projects SET owner=? WHERE owner=?').run(owner, legacy);
    db.prepare('UPDATE image_batches SET owner=? WHERE owner=?').run(owner, legacy);
    if (settings) {
      const present = db.prepare('SELECT 1 FROM studio_settings WHERE owner=?').get(owner);
      if (!present) db.prepare('INSERT INTO studio_settings (owner,preferences,etsy_credential,openai_credential,gemini_credential,upscale_credential,updated_at) VALUES (?, ?, NULL,NULL,NULL,NULL,?)').run(owner, settings.preferences, Date.now());
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (imagesMoved) renameSync(destination, source);
    throw err;
  }
  process.stdout.write('Migrated ' + count + ' legacy collections into "' + store.name + '".\n');
  process.stdout.write('Backup: ' + backup + '\n');
  process.stdout.write('Re-enter store API keys in Settings (legacy secrets are NOT moved).\n');
} finally { db.close(); }
