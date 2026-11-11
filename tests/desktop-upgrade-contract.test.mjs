import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { openNativeDb } = require('../desktop/native-storage.cjs');
const migrationDir = path.resolve('drizzle');

test('desktop installer identity and persistent workspace location remain stable across releases', () => {
  const installer = readFileSync('electron-builder.yml', 'utf8');
  const main = readFileSync('desktop/main.cjs', 'utf8');
  assert.match(installer, /^appId: com\.dlinkerartwork\.paletteiq$/m);
  assert.match(installer, /^productName: PaletteIQ Desktop$/m);
  assert.match(main, /app\.setName\('PaletteIQ Desktop'\)/);
  assert.match(main, /path\.join\(app\.getPath\('userData'\), 'paletteiq-data'\)/);
  assert.doesNotMatch(main, /rmSync\(\s*workspaceRoot\(/);
});

test('failed desktop migration preserves old records and a readable pre-upgrade backup', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'paletteiq-migration-failure-'));
  const brokenMigrations = path.join(temp, 'broken-migrations');
  let database;
  try {
    const dbDir = path.join(temp, 'database');
    mkdirSync(dbDir, { recursive: true });
    mkdirSync(brokenMigrations);
    const original = new DatabaseSync(path.join(dbDir, 'paletteiq.db'));
    try {
      original.exec('CREATE TABLE __paletteiq_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
      for (const file of ['0000_slippery_pyro.sql', '0001_big_bedlam.sql', '0002_fine_red_hulk.sql']) {
        original.exec(readFileSync(path.join(migrationDir, file), 'utf8'));
        original.prepare('INSERT INTO __paletteiq_migrations (name, applied_at) VALUES (?, ?)').run(file, 1000);
      }
      original.prepare('INSERT INTO projects (id, owner, name, data, updated_at) VALUES (?, ?, ?, ?, ?)').run('retained', 'owner', 'Do not lose me', '{}', 10);
    } finally { original.close(); }
    // Deliberately fail after executing the first statement inside the transaction.
    writeFileSync(path.join(brokenMigrations, '0003_gemini_seo.sql'), 'ALTER TABLE studio_settings ADD gemini_credential text; THIS IS NOT VALID SQL;');
    assert.throws(() => openNativeDb(temp, brokenMigrations));
    database = new DatabaseSync(path.join(dbDir, 'paletteiq.db'));
    assert.equal(database.prepare('SELECT name FROM projects WHERE id=?').get('retained').name, 'Do not lose me');
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM __paletteiq_migrations WHERE name='0003_gemini_seo.sql'").get().total, 0);
    assert.equal(database.prepare('PRAGMA table_info(studio_settings)').all().some(column => column.name === 'gemini_credential'), false);
    const backups = readdirSync(path.join(dbDir, 'upgrade-backups'));
    assert.equal(backups.length, 1);
    const snapshot = new DatabaseSync(path.join(dbDir, 'upgrade-backups', backups[0]));
    try { assert.equal(snapshot.prepare('SELECT name FROM projects WHERE id=?').get('retained').name, 'Do not lose me'); }
    finally { snapshot.close(); }
  } finally {
    if (database) database.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
