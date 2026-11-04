import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { validateWorkspace } = require('../desktop/workspace-backup.cjs');

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
    db.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
