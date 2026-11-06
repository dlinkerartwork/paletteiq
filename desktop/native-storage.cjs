const { createServer } = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync, readFileSync, writeFileSync, existsSync, createReadStream, statSync, openSync, fsyncSync, closeSync, renameSync, unlinkSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const TABLES = ['projects', 'studio_settings', 'image_batches'];
const assetKey = /^generated\/([\w-]{1,120})\/([0-9a-f-]{36})\.(png|jpg)$/;

function openNativeDb(directory, migrationsDir) {
  const dbDir = path.join(directory, 'database');
  mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'paletteiq.db');
  const existingDatabase = existsSync(dbPath) && statSync(dbPath).size > 0;
  const database = new DatabaseSync(dbPath);
  try {
    database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    database.exec('CREATE TABLE IF NOT EXISTS __paletteiq_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const migrations = ['0000_slippery_pyro.sql', '0001_big_bedlam.sql', '0002_fine_red_hulk.sql', '0003_gemini_seo.sql'];
    const pending = migrations.filter(file => !database.prepare('SELECT 1 FROM __paletteiq_migrations WHERE name=?').get(file));
    if (existingDatabase && pending.length) {
      // VACUUM INTO makes a consistent SQLite snapshot even when WAL is active.
      // Keep this outside the data directory's live database filename and never overwrite a backup.
      const backupDir = path.join(dbDir, 'upgrade-backups');
      mkdirSync(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, `before-${Date.now()}-${randomUUID()}.db`);
      database.prepare('VACUUM main INTO ?').run(backupPath);
    }
    for (const file of pending) {
      database.exec('BEGIN IMMEDIATE');
      try {
        // A previous version may have added this column before the migration
        // ledger was introduced. Reconcile the ledger without altering data.
        const alreadyHasGemini = file === '0003_gemini_seo.sql'
          && database.prepare('PRAGMA table_info(studio_settings)').all().some(column => column.name === 'gemini_credential');
        if (!alreadyHasGemini) database.exec(readFileSync(path.join(migrationsDir, file), 'utf8'));
        database.prepare('INSERT INTO __paletteiq_migrations (name, applied_at) VALUES (?, ?)').run(file, Date.now());
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function insertLegacyRows(database, table, rows) {
  if (!TABLES.includes(table)) throw new Error('Invalid legacy table');
  if (!Array.isArray(rows) || !rows.length) return;
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const keys = Object.keys(row);
      if (!keys.length || keys.some(key => !/^[a-z_]+$/.test(key))) throw new Error('Invalid legacy columns');
      const columns = keys.map(key => `"${key}"`).join(',');
      const placeholders = keys.map(() => '?').join(',');
      database.prepare(`INSERT OR IGNORE INTO ${table} (${columns}) VALUES (${placeholders})`).run(...keys.map(key => row[key]));
    }
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

function readPayload(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const buffers = []; let length = 0;
    req.on('data', chunk => { length += chunk.length; if (length > limit) { reject(new Error('Request too large')); req.destroy(); } else buffers.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(buffers)));
    req.on('error', reject);
  });
}

function startNativeStorage({ directory, migrationsDir, token }) {
  const database = openNativeDb(directory, migrationsDir);
  const imagesRoot = path.join(directory, 'images', 'collections');
  mkdirSync(imagesRoot, { recursive: true });
  const server = createServer(async (req, res) => {
    const finish = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${token}`) return finish(401, { error: 'Unauthorized' });
    try {
      if (req.method === 'POST' && req.url === '/sql') {
        const body = JSON.parse((await readPayload(req)).toString('utf8'));
        if (typeof body.sql !== 'string' || body.sql.length > 50_000 || !Array.isArray(body.params) || body.params.length > 1000) return finish(400, { error: 'Invalid SQL request' });
        const statement = database.prepare(body.sql);
        const params = body.params.map(value => value === undefined ? null : value);
        // Node's DatabaseSync StatementSync has columns(), but no readonly
        // property. SELECT statements expose result columns; INSERT/UPDATE don't.
        if (statement.columns().length) return finish(200, { results: statement.all(...params) });
        const run = statement.run(...params);
        return finish(200, { results: [], success: true, meta: { changes: Number(run.changes), last_row_id: Number(run.lastInsertRowid) } });
      }
      if (req.method === 'GET' && req.url === '/legacy-count') {
        const totals = Object.fromEntries(TABLES.map(table => [table, database.prepare(`SELECT count(*) AS total FROM ${table}`).get().total]));
        return finish(200, totals);
      }
      if (req.method === 'POST' && req.url === '/legacy-import') {
        const { table, rows } = JSON.parse((await readPayload(req)).toString('utf8'));
        insertLegacyRows(database, table, rows);
        return finish(200, { success: true });
      }
      const match = /^\/assets\/(.*)$/.exec(req.url || '');
      if (match && assetKey.test(match[1])) {
        const [, owner, id, extension] = match[1].match(assetKey);
        const folder = path.join(imagesRoot, owner);
        const filename = path.join(folder, `${id}.${extension}`);
        if (req.method === 'PUT') {
          mkdirSync(folder, { recursive: true });
          const content = await readPayload(req);
          // Never truncate the visible image in place. A crash during writing
          // must leave the previously saved image intact.
          const temporary = path.join(folder, `.${id}.${randomUUID()}.tmp`);
          let file;
          try {
            file = openSync(temporary, 'wx');
            writeFileSync(file, content);
            fsyncSync(file);
            closeSync(file);
            file = undefined;
            renameSync(temporary, filename);
          } finally {
            if (file !== undefined) closeSync(file);
            if (existsSync(temporary)) unlinkSync(temporary);
          }
          return finish(200, { success: true });
        }
        if (!existsSync(filename)) return finish(404, { error: 'Not found' });
        if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Length': statSync(filename).size }); return res.end(); }
        if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': extension === 'jpg' ? 'image/jpeg' : 'image/png' }); return createReadStream(filename).pipe(res); }
      }
      return finish(404, { error: 'Not found' });
    } catch (error) { return finish(500, { error: String(error instanceof Error ? error.message : error) }); }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve({ database, server, port: server.address().port });
    });
  });
}

module.exports = { startNativeStorage, openNativeDb, insertLegacyRows };
