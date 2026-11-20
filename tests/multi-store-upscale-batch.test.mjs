import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  scopeForStore, normalizeEmail, validAccountEmail, validPassword, validStoreName,
} from '../lib/store-identity.ts';
import { isIsolatedStoreOwner, mayUseSharedProviderKey } from '../lib/store-secret-policy.ts';

const file = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const account = file('lib/palette-accounts.ts');
const auth = file('app/chatgpt-auth.ts');
const route = file('app/api/account/route.ts');
const batch = file('app/api/upscale-batches/route.ts');
const view = file('components/image-production.tsx');
const ui = file('components/account-workspace.tsx');
const project = file('app/api/studio/route.ts');

test('store-scoped owners differ across stores and accounts, without exceeding native asset path constraints', () => {
  const a = '13aa2e6e-f5fa-4fba-9011-fc8ec9d01fb8';
  const b = 'c7e873d2-4b65-41c6-8daa-61a66ae3d13f';
  const c = 'c8e5dca6-3475-4481-850a-42fda172dcc1';
  const one = scopeForStore(a, b), two = scopeForStore(a, c), three = scopeForStore(c, b);
  assert.notEqual(one, two);
  assert.notEqual(one, three);
  assert.ok(one.length < 120 && /^[\w-]+$/.test(one));
  assert.throws(() => scopeForStore(a, '../shared'));
});

test('account input checks enforce normalized email and 12-character password minimum', () => {
  assert.equal(normalizeEmail('  STORE@Example.COM '), 'store@example.com');
  assert.equal(validAccountEmail('store@example.com'), true);
  assert.equal(validAccountEmail('not-an-email'), false);
  assert.equal(validPassword('twelve-long-passphrase'), true);
  assert.equal(validPassword('short'), false);
  assert.equal(validStoreName('My Animal Etsy Shop'), true);
  assert.equal(validStoreName(' '), false);
});

test('passwords use salted PBKDF2, sessions are hashed and HttpOnly with SameSite Strict', () => {
  assert.match(account, /const PASSWORD_ROUNDS = 310000/);
  assert.match(account, /crypto\.subtle\.deriveBits/);
  assert.match(account, /crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
  assert.match(account, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(account, /const tokenHash = await sha256\(token\)/);
  assert.match(account, /httpOnly: true/);
  assert.match(account, /sameSite: 'strict'/);
  assert.match(account, /failedLogins: failures >= 5/);
  assert.match(auth, /userId: account\.owner/);
  assert.match(auth, /PALETTEIQ_TRUST_CHATGPT_HEADERS/);
  assert.doesNotMatch(auth, /PALETTEIQ_LOCAL_NO_AUTH|local_seedy/);
});

test('store switching and store creation are authorized by account ownership', () => {
  assert.match(account, /eq\(paletteStores\.accountId, session\.accountId\)/);
  assert.match(account, /eq\(paletteSessions\.tokenHash, session\.tokenHash\)/);
  assert.match(account, /eq\(paletteStores\.accountId, accountId\)/);
  assert.match(route, /assertSameOrigin\(req\)/);
  assert.match(route, /input\.action === 'create-store'/);
  assert.match(route, /input\.action === 'switch-store'/);
  assert.match(route, /input\.action === 'rename-store'/);
  assert.match(route, /input\.action === 'logout'/);
  assert.match(ui, /create-store/);
});

test('migration is supported on native Desktop SQLite and Cloudflare D1', () => {
  const ddl = file('drizzle/0005_accounts_and_stores.sql');
  for (const table of ['paletteiq_accounts','paletteiq_stores','paletteiq_sessions'])
    assert.ok(ddl.includes('CREATE TABLE IF NOT EXISTS ' + table), table);
  assert.match(file('desktop/native-storage.cjs'), /0005_accounts_and_stores\.sql/);
  assert.match(file('drizzle/meta/_journal.json'), /0005_accounts_and_stores/);
  assert.match(file('app/layout.tsx'), /<AccountWorkspaceGate>/);
  assert.match(file('app/page.tsx'), /<StoreSwitcher\/>/);
});

test('selected GPU images are submitted as one resumable Batch using authenticated account email', () => {
  assert.match(batch, /notification_email: job\.notificationEmail/);
  assert.match(batch, /notificationEmail: user\.email/);
  assert.match(batch, /store_name: session\?\.storeName/);
  assert.match(batch, /client_batch_id: job\.id/);
  assert.match(batch, /expected_files: job\.items\.length/);
  assert.match(batch, /export async function PUT\(req: Request\)/);
  assert.match(batch, /X-Content-SHA256/);
  assert.match(batch, /export async function PATCH\(req: Request\)/);
  assert.match(batch, /\/commit'/);
  assert.match(batch, /importAcceptedJobs/);
  assert.match(project, /incoming as typeof incoming & \{ upscaleBatch\?: unknown \}/);
  const start = view.indexOf('  const runCloudUpscale = async');
  const end = view.indexOf('  const cancelRemoteUpscale = async', start);
  const submit = view.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(submit, /characterIds: targets\.map\(c => c\.id\)/);
  assert.match(submit, /\/api\/upscale-batches/);
  assert.match(submit, /method: 'PUT'/);
  assert.match(submit, /method: 'PATCH'/);
  assert.doesNotMatch(submit, /['"]\/api\/upscale['"]/);
  assert.match(view, /Resume GPU Batch/);
  assert.match(view, /notificationConfigured/);
});


test('new email/password stores cannot silently spend global paid API credentials', () => {
  const a='66e55bd8-e8b9-4d8e-81ac-597d41b93938', b='a764b097-d836-4eb9-8430-a644cd0f986e';
  const scoped=scopeForStore(a,b);
  assert.equal(isIsolatedStoreOwner(scoped),true);
  assert.equal(mayUseSharedProviderKey(scoped,false),false);
  assert.equal(mayUseSharedProviderKey(scoped,true),true);
  assert.equal(mayUseSharedProviderKey('legacy-trusted-gateway',false),true);
  const wrapper=file('lib/store-secrets.ts');
  assert.match(wrapper,/PALETTEIQ_ALLOW_SHARED_PROVIDER_KEYS === '1'/);
  for(const path of [
    'app/api/research-jobs/route.ts','app/api/prompt-jobs/route.ts',
    'app/api/image-batches/route.ts','app/api/settings/route.ts',
    'app/api/studio/route.ts','app/api/upscale/route.ts','lib/upscale-batch-transport.ts',
    'lib/seo-provider.ts','app/api/thumbnail-ai-image/route.ts',
    'app/api/listing-image-studio/route.ts','app/api/thumbnail-layout/route.ts',
    'app/api/thumbnail-categories/route.ts','app/api/thumbnail-upscale/route.ts',
    'app/api/thumbnail-art-direction/route.ts','app/api/listing-style-analysis/route.ts',
  ]){
    const code=file(path);
    assert.match(code,/sharedProviderSecret/,path);
    assert.equal(code.includes('.OPENAI_API_KEY'), false, path);
  }
});
