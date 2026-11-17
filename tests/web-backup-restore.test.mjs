import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  readPortableBackup, backupSummary, restorePlan, nonSecretPreferences,
} from '../lib/backup-restore.ts';

const a = 'fa130c1f-e13e-41d6-ada9-4fae28871603';
const b = '0e68a78c-418e-43b0-a67e-dfab20dccf8a';
const old = 'user_a_store_b';
const owner = 'user_active_store_current';
function backup() {
  return {
    format: 'paletteiq-backup', version: 1,
    preferences: { target: 120, seoTitleMaxLength: 120, openaiCredential: 'do-not-import', upscaleProvider: 'remote' },
    projects: [
      { id: a, name: 'Dinosaur Collection', characters: [
        { id: b, name: 'Baby Dinosaur', imageUrl: '/api/images/'+b+'?format=png', upscaledImageUrl: '/api/images/'+a+'?format=png' },
      ], thumbnails: [{id:a}], listingImages: [{id:a}] },
      { id: b, name: 'Whale Collection', characters: [] },
    ],
  };
}
test('accepts real legacy UUIDs, preserves metadata, reports image links without claiming to embed pixels', () => {
  const original = backup();
  const parsed = readPortableBackup(original);
  assert.equal(parsed.projects.length, 2);
  assert.deepEqual(parsed.projects, original.projects);
  assert.deepEqual(backupSummary(parsed), {
    collections: 2, characters: 1, completed: 1, upscaleReferences: 1, thumbnails: 1, listingImages: 1,
    note: 'JSON contains image URLs and metadata, NOT PNG/JPG binaries. Old images require existing accessible storage.',
  });
});
test('rejects malformed, duplicate, oversize and non-PaletteIQ backup data', () => {
  assert.throws(() => readPortableBackup({ format: 'else', version: 1, projects: [], preferences: {} }));
  assert.throws(() => readPortableBackup({ ...backup(), projects: [{ ...backup().projects[0], id: 'invalid!' }] }));
  assert.throws(() => readPortableBackup({ ...backup(), projects: [backup().projects[0], backup().projects[0]] }));
  assert.throws(() => readPortableBackup({ ...backup(), projects: [{ ...backup().projects[0], notes:'z'.repeat(701_000) }] }));
});
test('skip, replace, and keep-both honor other-store ownership', () => {
  const data = readPortableBackup(backup());
  const existing = [{ id:a, owner }, { id:b, owner:old }];
  assert.deepEqual(restorePlan(data,existing,owner,'skip').map(x=>x.action),['skip','skip']);
  assert.deepEqual(restorePlan(data,existing,owner,'replace').map(x=>x.action),['replace','blocked']);
  assert.deepEqual(restorePlan(data,existing,owner,'keep-both').map(x=>x.action),['keep-both','keep-both']);
  assert.deepEqual(restorePlan(data,[],owner,'keep-both').map(x=>x.action),['create','create']);
  assert.throws(() => restorePlan(data,existing,owner,'overwrite-everything'));
});
test('importing preferences excludes credential material and keeps current SEO title policy', () => {
  const safe = nonSecretPreferences(backup().preferences);
  assert.equal(safe.target,120);
  assert.equal(safe.seoTitleMaxLength,140);
  assert.equal(safe.upscaleProvider,'remote');
  assert.equal('openaiCredential' in safe,false);
});
test('Web restore route requires account ownership, cross-site denial and verified safety snapshot before transactional write', () => {
  const route = readFileSync(new URL('../app/api/backup-restore/route.ts', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../components/restore-backup-panel.tsx', import.meta.url), 'utf8');
  const settings = readFileSync(new URL('../components/studio-settings.tsx', import.meta.url), 'utf8');
  assert.match(route,/assertSameOrigin\(req\)/);
  assert.match(route,/getAccountSession\(\)/);
  assert.match(route,/paletteStores\.accountId/);
  assert.match(route,/PALETTEIQ_DESKTOP/);
  assert.match(route,/await bucket\.put\(key/);
  assert.match(route,/await bucket\.head\(key\)/);
  assert.ok(route.indexOf('await bucket.head(key)') < route.indexOf('await database.batch(statements)'));
  assert.match(route,/WHERE projects\.owner=excluded\.owner/);
  assert.match(route,/nonSecretPreferences/);
  assert.match(ui,/Preview restore/);
  assert.match(ui,/Restore to selected store/);
  assert.match(ui,/Keep both/);
  assert.match(ui,/JSON backups do not contain image binaries/);
  assert.match(settings,/<RestoreBackupPanel\/>/);
  assert.doesNotMatch(settings,/importBackup\(/);
});
