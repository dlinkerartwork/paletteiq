import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { classifyAccountStorageFailure } from '../lib/account-storage-errors.ts';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('brand new account on a database missing 0005 reports a migration error, never a duplicate', () => {
  for (const detail of [
    'D1_ERROR: no such table: paletteiq_accounts: SQLITE_ERROR',
    'Desktop storage: 500 no such table: paletteiq_stores',
    'SQLITE_ERROR: no such table: paletteiq_sessions',
  ]) {
    const result = classifyAccountStorageFailure(new Error(detail));
    assert.equal(result.issue, 'schema_missing');
    assert.equal(result.status, 503);
    assert.match(result.message, /0005_accounts_and_stores\.sql/);
    assert.match(result.message, /setup-local\.ps1 -SkipInstall/);
    assert.doesNotMatch(result.message, /already registered|already in use/);
  }
});

test('only an actual unique email constraint is reported as an existing email', () => {
  const duplicate = classifyAccountStorageFailure(new Error('D1_ERROR: UNIQUE constraint failed: paletteiq_accounts.email: SQLITE_CONSTRAINT'));
  assert.equal(duplicate.issue, 'email_taken');
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.message, /already registered/);
  for (const failure of [
    'constraint failed: NOT NULL constraint failed: paletteiq_accounts.password_salt',
    'SQL error while executing: insert into paletteiq_accounts',
    'Internal error: request failed',
  ]) {
    const result = classifyAccountStorageFailure(new Error(failure));
    assert.notEqual(result.issue, 'email_taken');
    assert.doesNotMatch(result.message, /already registered/);
  }
});

test('offline or broken SQLite reports unavailable storage without exposing bound data', () => {
  const result = classifyAccountStorageFailure(new Error('database is locked: UNIQUE parameter password=secret'));
  assert.equal(result.issue, 'storage_unavailable');
  assert.equal(result.status, 503);
  assert.doesNotMatch(result.message, /password=secret/);
});

test('GET checks all three account tables even before the first login cookie exists', () => {
  const accounts = read('lib/palette-accounts.ts');
  const route = read('app/api/account/route.ts');
  assert.match(accounts, /export async function verifyAccountsSchema\(\)/);
  assert.match(accounts, /db\.select\(\{ id: paletteAccounts\.id \}\)/);
  assert.match(accounts, /db\.select\(\{ id: paletteStores\.id \}\)/);
  assert.match(accounts, /db\.select\(\{ tokenHash: paletteSessions\.tokenHash \}\)/);
  assert.match(accounts, /await verifyAccountsSchema\(\)/);
  assert.match(route, /export async function GET\(\)[\s\S]*?await verifyAccountsSchema\(\)/);
  assert.match(route, /classifyAccountStorageFailure\(cause\)/);
  assert.doesNotMatch(accounts, /Could not register this email address\. It might already be in use/);
  assert.match(accounts, /await db\.delete\(paletteAccounts\)/);
});

test('0005 is idempotent on SQLite and does not delete existing collections', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY, owner TEXT NOT NULL)');
    db.prepare('INSERT INTO projects VALUES (?,?)').run('collection-one', 'local_seedy');
    const ddl = read('drizzle/0005_accounts_and_stores.sql');
    db.exec(ddl);
    db.exec(ddl);
    const userId = '23bcb387-905a-42b5-a3bd-95e25a88d35e';
    const storeId = '5c59b357-1657-48b7-b165-4d0e7335f07f';
    const insertedAt = Date.now();
    db.prepare('INSERT INTO paletteiq_accounts(id,email,password_salt,password_hash,created_at) VALUES (?,?,?,?,?)')
      .run(userId, 'first@example.com', 'aabbccdd', 'hashed-value', insertedAt);
    db.prepare('INSERT INTO paletteiq_stores(id,account_id,name,created_at) VALUES (?,?,?,?)')
      .run(storeId, userId, 'My Etsy Store', insertedAt);
    db.prepare('INSERT INTO paletteiq_sessions(token_hash,account_id,active_store_id,expires_at,created_at) VALUES (?,?,?,?,?)')
      .run('hash', userId, storeId, insertedAt+100000, insertedAt);
    assert.equal(db.prepare('SELECT count(*) AS total FROM paletteiq_accounts').get().total, 1);
    assert.equal(db.prepare('SELECT count(*) AS total FROM paletteiq_stores').get().total, 1);
    assert.equal(db.prepare('SELECT count(*) AS total FROM paletteiq_sessions').get().total, 1);
    assert.equal(db.prepare('SELECT owner FROM projects WHERE id=?').get('collection-one').owner, 'local_seedy');
    assert.throws(() => db.prepare('INSERT INTO paletteiq_accounts(id,email,password_salt,password_hash,created_at) VALUES (?,?,?,?,?)')
      .run('different-id','first@example.com','salt','hash',insertedAt), /UNIQUE constraint failed: paletteiq_accounts.email/);
  } finally { db.close(); }
});
