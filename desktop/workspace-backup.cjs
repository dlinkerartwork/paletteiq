const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, renameSync, rmSync, statSync, readdirSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const execFileAsync = promisify(execFile);
const marker = 'paletteiq-workspace-backup';

async function zipCommand(source, destination, extract = false) {
  const command = extract
    ? `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead($env:PALETTEIQ_ZIP_SOURCE); try { if ($z.Entries.Count -gt 20000) { throw 'Too many archive entries' }; $total=[int64]0; foreach($e in $z.Entries) { $n=$e.FullName.Replace('\\','/'); if ($n.StartsWith('/') -or $n.Contains('../') -or $n.Contains('/..') -or $n.Contains(':') -or $n.StartsWith('\\') -or $e.Length -gt 2147483648) { throw 'Invalid archive path or size' }; $total += $e.Length; if ($total -gt 8589934592) { throw 'Archive too large' }; if ($n -and -not ($n -eq 'manifest.json' -or $n -eq 'database/paletteiq.db' -or $n -match '^images/collections/[a-zA-Z0-9_-]{1,120}/[0-9a-f-]{36}\\.(png|jpg)$' -or $n -eq 'database/' -or $n -eq 'images/' -or $n -eq 'images/collections/' -or $n -match '^images/collections/[a-zA-Z0-9_-]{1,120}/$')) { throw 'Unexpected archive entry' } }; [System.IO.Compression.ZipFileExtensions]::ExtractToDirectory($z, $env:PALETTEIQ_ZIP_DEST) } finally { $z.Dispose() }`
    : `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:PALETTEIQ_ZIP_SOURCE, $env:PALETTEIQ_ZIP_DEST, [System.IO.Compression.CompressionLevel]::Optimal, $false)`;
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
    windowsHide: true, timeout: 30 * 60 * 1000, maxBuffer: 1024 * 1024,
    env: { ...process.env, PALETTEIQ_ZIP_SOURCE: source, PALETTEIQ_ZIP_DEST: destination },
  });
}

function validateWorkspace(folder) {
  const manifestPath = path.join(folder, 'manifest.json');
  const dbPath = path.join(folder, 'database', 'paletteiq.db');
  if (!existsSync(manifestPath) || !existsSync(dbPath)) throw new Error('Missing workspace manifest or SQLite database');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.format !== marker || manifest.version !== 1) throw new Error('Unsupported PaletteIQ backup');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    for (const table of ['projects', 'studio_settings', 'image_batches']) {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error(`Missing SQLite table: ${table}`);
    }
    const secretCount = db.prepare('SELECT COUNT(*) AS n FROM studio_settings WHERE etsy_credential IS NOT NULL OR openai_credential IS NOT NULL').get().n;
    if (secretCount) throw new Error('Backup unexpectedly contains encrypted API credentials');
  } finally { db.close(); }
  return manifest;
}

async function backupWorkspace({ directory, database, destination }) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'paletteiq-backup-'));
  try {
    const dbDir = path.join(temporary, 'database');
    mkdirSync(dbDir);
    const snapshot = path.join(dbDir, 'paletteiq.db');
    // VACUUM INTO is a consistent snapshot even while WAL transactions exist.
    database.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
    const safeDb = new DatabaseSync(snapshot);
    try { safeDb.exec('UPDATE studio_settings SET etsy_credential=NULL, openai_credential=NULL'); }
    finally { safeDb.close(); }
    const images = path.join(directory, 'images');
    if (existsSync(images)) cpSync(images, path.join(temporary, 'images'), { recursive: true, dereference: true });
    writeFileSync(path.join(temporary, 'manifest.json'), JSON.stringify({ format: marker, version: 1, createdAt: new Date().toISOString(), credentialsExcluded: true }, null, 2));
    validateWorkspace(temporary);
    await zipCommand(temporary, destination);
    return destination;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

async function restoreWorkspaceSeparate({ source, workspaceRoot }) {
  if (!existsSync(source) || statSync(source).size > 9 * 1024 * 1024 * 1024) throw new Error('Invalid or oversized backup file');
  const restores = path.join(workspaceRoot, 'restored-workspaces');
  mkdirSync(restores, { recursive: true });
  const staging = mkdtempSync(path.join(restores, '.pending-'));
  try {
    await zipCommand(source, staging, true);
    validateWorkspace(staging);
    const destination = path.join(restores, `restored-${Date.now()}-${randomUUID().slice(0, 8)}`);
    renameSync(staging, destination);
    return destination;
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
}

module.exports = { backupWorkspace, restoreWorkspaceSeparate, validateWorkspace };
