import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { validateWorkspace, stripWorkspaceCredentials } = require('../desktop/workspace-backup.cjs');

test('separate restored workspace rejects credentials in the database', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'paletteiq-restore-'));
  try {
    mkdirSync(path.join(directory, 'database'));
    writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ format: 'paletteiq-workspace-backup', version: 1 }));
    const db = new DatabaseSync(path.join(directory, 'database', 'paletteiq.db'));
    db.exec('CREATE TABLE projects (id TEXT); CREATE TABLE image_batches (id TEXT); CREATE TABLE studio_settings (etsy_credential TEXT, openai_credential TEXT)');
    assert.doesNotThrow(() => validateWorkspace(directory));
    db.exec("INSERT INTO studio_settings (openai_credential) VALUES ('encrypted-secret')");
    assert.throws(() => validateWorkspace(directory), /credentials/);
    assert.doesNotThrow(() => validateWorkspace(directory, { requireNoCredentials: false }));
    db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('legacy workspace SQLite credentials are stripped in place without changing collections or preferences', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'paletteiq-legacy-sanitize-'));
  try {
    mkdirSync(path.join(directory, 'database'));
    writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ format: 'paletteiq-workspace-backup', version: 1 }));
    const db = new DatabaseSync(path.join(directory, 'database', 'paletteiq.db'));
    try {
      db.exec('CREATE TABLE projects (id TEXT); CREATE TABLE image_batches (id TEXT); ' +
        'CREATE TABLE studio_settings (owner TEXT, preferences TEXT, etsy_credential TEXT, openai_credential TEXT, gemini_credential TEXT, upscale_credential TEXT)');
      db.prepare('INSERT INTO projects (id) VALUES (?)').run('collection-preserved');
      db.prepare('INSERT INTO studio_settings VALUES (?,?,?,?,?,?)')
        .run('local_seedy', '{"target":120}', 'etsy-encrypted', 'openai-encrypted', 'gemini-encrypted', 'upscale-encrypted');
      assert.throws(() => validateWorkspace(directory), /encrypted API credentials/);
      assert.doesNotThrow(() => validateWorkspace(directory, {requireNoCredentials: false}));
    } finally { db.close(); }
    stripWorkspaceCredentials(directory);
    assert.doesNotThrow(() => validateWorkspace(directory));
    const restored = new DatabaseSync(path.join(directory, 'database', 'paletteiq.db'), {readOnly: true});
    try {
      const row = restored.prepare('SELECT * FROM studio_settings').get();
      assert.deepEqual(
        [row.etsy_credential, row.openai_credential, row.gemini_credential, row.upscale_credential],
        [null, null, null, null],
      );
      assert.equal(row.preferences, '{"target":120}');
      assert.equal(restored.prepare('SELECT id FROM projects').get().id, 'collection-preserved');
    } finally {restored.close();}
  } finally {rmSync(directory,{recursive:true,force:true});}
});
