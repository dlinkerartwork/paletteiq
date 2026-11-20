#!/usr/bin/env node
/**
 * READ-ONLY recovery inventory. Never modifies, removes, or claims any records.
 *
 * PowerShell (in the original PaletteIQ repository folder):
 *   node scripts/inspect-lost-collections.cjs
 *   node scripts/inspect-lost-collections.cjs --search "C:\old\paletteiq"
 */
const { DatabaseSync } = require('node:sqlite');
const { existsSync, readdirSync, statSync, openSync, readSync, closeSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const workspaceRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const extraPath = args.indexOf('--search') >= 0 ? args[args.indexOf('--search') + 1] : null;
const root = process.cwd();
const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const candidateRoots = [
  path.join(root, '.wrangler'),
  path.join(root, '.sites-runtime'),
  path.join(workspaceRoot, '.wrangler'),
  path.join(workspaceRoot, '.sites-runtime'),
  path.join(appdata, 'PaletteIQ Desktop', 'paletteiq-data', 'database'),
  path.join(appdata, 'PaletteIQ Desktop', 'paletteiq-data', 'restored-workspaces'),
  ...(extraPath ? [path.resolve(extraPath)] : []),
];
const skip = new Set(['node_modules','.git','dist','blob','blobs','tmp','logs','images','cache','cache-data','temp']);
const foundPaths = new Set(), inspected = [];
const maxFiles = 18000;
let visited = 0;

function looksLikeSQLite(filename) {
  let fd;
  try {
    fd = openSync(filename, 'r');
    const buffer = Buffer.alloc(16);
    return readSync(fd, buffer, 0, 16, 0) === 16 &&
      buffer.equals(Buffer.from('SQLite format 3\0', 'utf8'));
  } catch { return false; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function examineDir(folder, depth = 0) {
  if (depth > 12 || visited > maxFiles) return;
  let names;
  try { names = readdirSync(folder, { withFileTypes: true }); } catch { return; }
  for (const entry of names) {
    if (++visited > maxFiles) return;
    const entryPath = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!skip.has(entry.name.toLowerCase())) examineDir(entryPath, depth + 1);
    } else if (entry.isFile() && /\.(?:sqlite3?|db)$/i.test(entry.name)) {
      if (looksLikeSQLite(entryPath)) foundPaths.add(path.resolve(entryPath));
    }
  }
}
for (const candidate of new Set(candidateRoots.map(p => path.resolve(p)))) {
  if (existsSync(candidate)) {
    let stats; try { stats = statSync(candidate); } catch { continue; }
    if (stats.isFile() && looksLikeSQLite(candidate)) foundPaths.add(candidate);
    else if (stats.isDirectory()) examineDir(candidate);
  }
}
console.log('PaletteIQ lost-collections recovery — READ ONLY (no files changed).');
console.log('Project:', root);
let recovered = 0;
for (const filename of [...foundPaths].sort()) {
  let database;
  try {
    database = new DatabaseSync(filename, { readOnly: true });
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
    if (!tables.has('projects')) continue;
    const columns = new Set(database.prepare('PRAGMA table_info(projects)').all().map(r=>r.name));
    if (!columns.has('owner')) continue;
    const rows = database.prepare('SELECT owner, COUNT(*) AS total FROM projects GROUP BY owner ORDER BY total DESC').all();
    if (!rows.length && !tables.has('paletteiq_accounts')) continue;
    console.log('\nDatabase:', filename);
    inspected.push(filename);
    if (rows.length) {
      for (const row of rows) {
        console.log('  Collection owner:', row.owner, '| count:', row.total);
        if (row.owner === 'local_seedy') recovered += Number(row.total);
      }
    } else console.log('  No collection rows found.');
    if (tables.has('image_batches')) {
      try {
        for (const row of database.prepare('SELECT owner, COUNT(*) AS total FROM image_batches GROUP BY owner').all())
          console.log('  Image batches:',row.owner,'| count:',row.total);
      } catch { /* Old schema variant. */ }
    }
    if (tables.has('paletteiq_stores') && tables.has('paletteiq_accounts')) {
      try {
        for (const row of database.prepare(
          'SELECT s.id, s.name, a.email FROM paletteiq_stores s JOIN paletteiq_accounts a ON a.id=s.account_id').all()) {
          console.log('  New store:',row.name, '| store ID:', row.id, '| email:', String(row.email).replace(/^(.{2}).*(@.*)$/, '$1***$2'));
        }
      } catch { /* Keep inspecting. */ }
    }
    if (tables.has('studio_settings')) {
      try {
        const count = database.prepare('SELECT COUNT(*) AS total FROM studio_settings').get().total;
        console.log('  Saved settings rows:', count);
      } catch { /* Optional. */ }
    }
  } catch(e) {
    if (/\bSQLITE_BUSY\b|database is locked/i.test(String(e))) {
      console.log('  SQLite busy; close PaletteIQ and rerun:', filename);
    }
  } finally { try { database?.close(); } catch { /* Read only. */ } }
}
if (inspected.length === 0) console.log('\nNo populated PaletteIQ SQLite databases found in default locations.');
console.log('\nLegacy local_seedy collections found:', recovered);
console.log('No data was modified. Do NOT delete your old .wrangler/state or Desktop data directory.');
console.log('If count is zero, the old data may be in a different repository folder or another .wrangler/state.');
console.log('Use --search "C:\\path\\to\\original\\paletteiq" to inspect another folder without changing it.');
