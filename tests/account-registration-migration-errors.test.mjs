import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
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
