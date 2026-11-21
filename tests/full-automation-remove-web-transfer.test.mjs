import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const at = p => new URL('../' + p, import.meta.url);
const read = p => readFileSync(at(p), 'utf8');

test('Web to Desktop ZIP transfer feature and its helper routes have been removed', () => {
  for (const path of [
    'app/api/web-workspace-export/route.ts',
    'components/web-workspace-export-panel.tsx',
    'lib/web-workspace-portable.ts',
    'desktop/web-workspace-archive.cjs',
    'docs/web-workspace-zip-to-desktop.md',
    'tests/web-workspace-zip-to-desktop.test.mjs',
  ]) {
    assert.equal(existsSync(at(path)), false, path + ' must not ship');
  }
  const settings = read('components/studio-settings.tsx');
  assert.doesNotMatch(settings, /WebWorkspaceExportPanel|Export current Web store — ZIP with PNGs/);
  const gate = read('components/shared-local-workspace-gate.tsx');
  assert.doesNotMatch(gate, /webExport/);
  const backup = read('desktop/workspace-backup.cjs');
  assert.doesNotMatch(backup, /materializeWebArchive|web-collections\.json/);
  const importer = read('desktop/workspace-store-import.cjs');
  assert.doesNotMatch(importer, /sourceType|importedFromWeb|webImportReport|Web localhost/);
});

test('Unrelated Desktop backup and restore, JSON store backup and shared UI remain intact', () => {
  const settings = read('components/studio-settings.tsx');
  assert.match(settings, /Export current store \(\.json\)/);
  assert.match(settings, /<DesktopWorkspaceImportPanel\/>/);
  assert.match(settings, /<RestoreBackupPanel\/>/);
  const desktopPanel = read('components/desktop-workspace-import.tsx');
  assert.match(desktopPanel, /Desktop Workspace ZIP → Selected Store/);
  assert.match(desktopPanel, /Choose workspace ZIP/);
  assert.match(desktopPanel, /Restore ZIP to selected store/);
  const backup = read('desktop/workspace-backup.cjs');
  assert.match(backup, /async function backupWorkspace/);
  assert.match(backup, /async function prepareWorkspaceStoreImport/);
  const importer = read('desktop/workspace-store-import.cjs');
  assert.match(importer, /function applyWorkspaceStoreImport/);
  assert.match(importer, /VACUUM INTO/);
  const shared = read('components/shared-local-workspace-gate.tsx');
  assert.match(shared, /Use shared Desktop workspace/);
});

test('CI workflows no longer reference removed Web migration tests and files', () => {
  for (const path of [
    '.github/workflows/full-automation-parallel-ci.yml',
    '.github/workflows/desktop-workspace-restore.yml',
  ]) {
    const workflow=read(path);
    assert.doesNotMatch(workflow, /web-workspace-zip-to-desktop|web-workspace-archive|web-workspace-portable|web-workspace-export/);
  }
});
