import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { startNativeStorage } = require('../desktop/native-storage.cjs');

test('native SQLite persists records and stores clipart as files in user directory', async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'paletteiq-native-test-'));
  const migrationDir = path.resolve('drizzle');
  const secret = 'test-secret';
  let first;
  try {
    first = await startNativeStorage({ directory: temp, migrationsDir: migrationDir, token: secret });
    const url = `http://127.0.0.1:${first.port}`;
    const auth = { Authorization: `Bearer ${secret}` };
    const forbidden = await fetch(`${url}/sql`, { method: 'POST', body: '{}' });
    assert.equal(forbidden.status, 401);
    const create = await fetch(`${url}/sql`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'INSERT INTO projects (id, owner, name, data, updated_at) VALUES (?, ?, ?, ?, ?)', params: ['a1', 'local_seedy', 'Sample', '{}', 10] }) });
    assert.equal(create.status, 200);
    const read = await fetch(`${url}/sql`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT name FROM projects WHERE id = ?', params: ['a1'] }) });
    assert.deepEqual((await read.json()).results, [{ name: 'Sample' }]);
    const legacy = await fetch(`${url}/legacy-import`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ table: 'projects', rows: [{ id: 'a2', owner: 'local_seedy', name: 'Imported', data: '{}', updated_at: 12 }] }) });
    assert.equal(legacy.status, 200);
    assert.equal(first.database.prepare('SELECT name FROM projects WHERE id=?').get('a2').name, 'Imported');
    const key = 'generated/local_seedy/00000000-0000-4000-8000-000000000001.png';
    const image = Uint8Array.from([137,80,78,71]);
    assert.equal((await fetch(`${url}/assets/${key}`, { method: 'PUT', headers: auth, body: image })).status, 200);
    const result = await fetch(`${url}/assets/${key}`, { headers: auth });
    assert.deepEqual(new Uint8Array(await result.arrayBuffer()), image);
    assert.ok(existsSync(path.join(temp, 'database', 'paletteiq.db')));
    assert.ok(existsSync(path.join(temp, 'images', 'collections', 'local_seedy', '00000000-0000-4000-8000-000000000001.png')));
    first.server.close(); first.database.close(); first = null;
    const second = await startNativeStorage({ directory: temp, migrationsDir: migrationDir, token: secret });
    assert.equal(second.database.prepare('SELECT name FROM projects WHERE id=?').get('a1').name, 'Sample');
    second.server.close(); second.database.close();
  } finally { if (first) { first.server.close(); first.database.close(); } rmSync(temp, { recursive: true, force: true }); }
});
