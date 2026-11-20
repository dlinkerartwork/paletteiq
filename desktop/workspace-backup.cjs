const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, renameSync, rmSync, statSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const execFileAsync = promisify(execFile);
const marker = 'paletteiq-workspace-backup';

async function zipCommand(source, destination, extract = false) {
  const command = extract
    ? `Add-Type -AssemblyName System.IO.Compression.FileSystem;
$z=[System.IO.Compression.ZipFile]::OpenRead($env:PALETTEIQ_ZIP_SOURCE);
try {
 if ($z.Entries.Count -gt 20000) { throw 'Too many archive entries' };
 $total=[int64]0;
 foreach ($e in $z.Entries) {
   $n=$e.FullName.Replace([string][char]92,'/');
   if ($n.StartsWith('/') -or $n.Contains('../') -or $n.Contains('/..') -or $n.Contains(':') -or
       $e.Length -gt 2147483648) { throw 'Invalid archive path or size' };
   $total += $e.Length;
   if ($total -gt 8589934592) { throw 'Archive too large' };
   $valid = ($n -eq 'manifest.json' -or $n -eq 'database/paletteiq.db' -or
      $n -eq 'database/' -or $n -eq 'images/' -or $n -eq 'images/collections/' -or
      $n -match '^images/collections/[a-zA-Z0-9_-]{1,120}/(?:batches/[0-9a-f-]{36}/)?[0-9a-f-]{36}[.](png|jpg)$' -or
      $n -match '^images/collections/[a-zA-Z0-9_-]{1,120}/(?:batches/(?:[0-9a-f-]{36}/)?)?$');
   if ($n -and -not $valid) { throw 'Unexpected archive entry: ' + $n };
 }
 [System.IO.Compression.ZipFileExtensions]::ExtractToDirectory($z,$env:PALETTEIQ_ZIP_DEST);
} finally { $z.Dispose() }`
    : `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:PALETTEIQ_ZIP_SOURCE, $env:PALETTEIQ_ZIP_DEST, [System.IO.Compression.CompressionLevel]::Optimal, $false)`;
  // Keep the base64 command out of user-facing errors. PowerShell exceptions
  // must be turned into concise stderr before Node's execFile formats them.
  const script = `$ErrorActionPreference = 'Stop'; try {\n${command}\n} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 30 * 60 * 1000, maxBuffer: 1024 * 1024,
      env: { ...process.env, PALETTEIQ_ZIP_SOURCE: source, PALETTEIQ_ZIP_DEST: destination },
    });
  } catch (error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const stdout = typeof error.stdout === 'string' ? error.stdout.trim() : '';
    // Prefer the actual ZIP/PowerShell error over the multi-kilobyte -EncodedCommand.
    const detail = stderr || stdout ||
      (error.code === 'ENOENT' ? 'Windows PowerShell could not be found' :
      error.killed ? 'PowerShell timed out while processing the archive' :
      `PowerShell exited with code ${error.code ?? 'unknown'}`);
    throw new Error(`Workspace ZIP ${extract ? 'extraction' : 'creation'} failed: ${detail.slice(0, 900)}`);
  }
}

function validateWorkspace(folder, { requireNoCredentials = true } = {}) {
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
    const fields = db.prepare('PRAGMA table_info(studio_settings)').all().map(column => column.name);
    const sensitive = ['etsy_credential','openai_credential','gemini_credential','upscale_credential'].filter(field=>fields.includes(field));
    const secretCount = sensitive.length ? db.prepare('SELECT COUNT(*) AS n FROM studio_settings WHERE '+sensitive.map(field=>field+' IS NOT NULL').join(' OR ')).get().n : 0;
    if (requireNoCredentials && secretCount) throw new Error('Backup unexpectedly contains encrypted API credentials');
  } finally { db.close(); }
  return manifest;
}

/**
 * Legacy Desktop ZIPs may contain credentials encrypted with an old
 * workspace-specific key. They cannot be safely reused after restoration.
 * Sanitize only the extracted SQLite copy, never the ZIP or live database.
 */
function stripWorkspaceCredentials(folder) {
  const databasePath = path.join(folder, 'database', 'paletteiq.db');
  const database = new DatabaseSync(databasePath);
  try {
    const columns = new Set(database.prepare('PRAGMA table_info(studio_settings)').all().map(row => row.name));
    const sensitive = ['etsy_credential', 'openai_credential', 'gemini_credential', 'upscale_credential']
      .filter(name => columns.has(name));
    if (!sensitive.length) return;
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec('UPDATE studio_settings SET ' + sensitive.map(name => name + '=NULL').join(', '));
      database.exec('COMMIT');
    } catch (cause) {
      database.exec('ROLLBACK');
      throw cause;
    }
  } finally {
    database.close();
  }
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
    try { const available = safeDb.prepare('PRAGMA table_info(studio_settings)').all().map(row=>row.name);
      const sensitive = ['etsy_credential','openai_credential','gemini_credential','upscale_credential'].filter(field=>available.includes(field));
      if (sensitive.length) safeDb.exec('UPDATE studio_settings SET '+sensitive.map(field=>field+'=NULL').join(', ')); }
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
    // Historic ZIP backups were created before credential-scrubbing was
    // enforced. Validate the source structure, remove secrets from the
    // extracted copy, and *then* require the safe modern backup contract.
    validateWorkspace(staging, { requireNoCredentials: false });
    stripWorkspaceCredentials(staging);
    validateWorkspace(staging);
    const destination = path.join(restores, `restored-${Date.now()}-${randomUUID().slice(0, 8)}`);
    renameSync(staging, destination);
    return destination;
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
}

async function prepareWorkspaceStoreImport({ source, workspaceRoot }) {
  if (!existsSync(source) || !statSync(source).isFile() || statSync(source).size > 9 * 1024 * 1024 * 1024)
    throw new Error('Invalid or oversized workspace ZIP');
  const imports = path.join(workspaceRoot, 'workspace-imports');
  mkdirSync(imports, { recursive: true });
  const staging = mkdtempSync(path.join(imports, '.pending-'));
  try {
    await zipCommand(source, staging, true);
    // The original ZIP is immutable. Scrub its extracted SQLite copy so
    // historic credentials never linger in the temporary import workspace.
    validateWorkspace(staging, { requireNoCredentials: false });
    stripWorkspaceCredentials(staging);
    validateWorkspace(staging);
    return staging;
  } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
}

module.exports = { backupWorkspace, restoreWorkspaceSeparate, validateWorkspace, prepareWorkspaceStoreImport, stripWorkspaceCredentials };
