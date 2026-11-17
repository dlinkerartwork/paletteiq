import { cookies } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { paletteAccounts, paletteSessions, paletteStores } from '@/db/schema';
import { normalizeEmail, validAccountEmail, validPassword, validStoreName, scopeForStore } from '@/lib/store-identity';

export const PALETTEIQ_SESSION_COOKIE = 'paletteiq_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const PASSWORD_ROUNDS = 310000;
const encoder = new TextEncoder();
const asHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const hexBytes = (value: string) => Uint8Array.from(value.match(/.{2}/g) || [], byte => parseInt(byte, 16));
const newId = () => crypto.randomUUID();

async function sha256(text: string) {
  return asHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}
async function derivePassword(password: string, salt: string) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexBytes(salt), iterations: PASSWORD_ROUNDS, hash: 'SHA-256' }, base, 256);
  return asHex(new Uint8Array(derived));
}
function constantTimeEqual(a: string, b: string) {
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}
export function assertSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return false;
  return req.headers.get('sec-fetch-site') !== 'cross-site';
}
export type StoreSummary = { id: string; name: string };
export type AccountSession = {
  accountId: string; email: string; activeStoreId: string;
  storeName: string; owner: string; tokenHash: string;
};

export async function getAccountSession(): Promise<AccountSession | null> {
  const jar = await cookies();
  const token = jar.get(PALETTEIQ_SESSION_COOKIE)?.value;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = await sha256(token);
  const db = getDb();
  const found = await db.select().from(paletteSessions).where(eq(paletteSessions.tokenHash, tokenHash)).limit(1);
  const session = found[0];
  if (!session || session.expiresAt < Date.now()) return null;
  const [users, stores] = await Promise.all([
    db.select().from(paletteAccounts).where(eq(paletteAccounts.id, session.accountId)).limit(1),
    db.select().from(paletteStores).where(and(eq(paletteStores.id, session.activeStoreId), eq(paletteStores.accountId, session.accountId))).limit(1),
  ]);
  if (!users[0] || !stores[0]) return null;
  return {
    accountId: users[0].id, email: users[0].email,
    activeStoreId: stores[0].id, storeName: stores[0].name,
    owner: scopeForStore(users[0].id, stores[0].id), tokenHash,
  };
}
export async function listOwnedStores(accountId: string): Promise<StoreSummary[]> {
  const rows = await getDb().select().from(paletteStores).where(eq(paletteStores.accountId, accountId));
  return rows.map(row => ({ id: row.id, name: row.name }));
}
/**
 * Fail before inserting anything if a prior installation has not applied the
 * account/store migration. An absent session cookie alone cannot test that.
 */
export async function verifyAccountsSchema() {
  const db = getDb();
  await db.select({ id: paletteAccounts.id }).from(paletteAccounts).limit(1);
  await db.select({ id: paletteStores.id }).from(paletteStores).limit(1);
  await db.select({ tokenHash: paletteSessions.tokenHash }).from(paletteSessions).limit(1);
}

export async function createAccount(emailInput: unknown, password: unknown) {
  const email = normalizeEmail(emailInput);
  if (!validAccountEmail(email) || !validPassword(password))
    throw Error('Enter a valid email and password of 12–128 characters.');
  await verifyAccountsSchema();
  const db = getDb(), id = newId(), storeId = newId(), now = Date.now();
  const salt = asHex(crypto.getRandomValues(new Uint8Array(16)));
  const passwordHash = await derivePassword(password, salt);
  // Preserve the underlying SQLite/D1 error so the route can distinguish a
  // real unique-email violation from missing tables or storage failures.
  await db.insert(paletteAccounts).values({ id, email, passwordSalt: salt, passwordHash, createdAt: now });
  try {
    await db.insert(paletteStores).values({ id: storeId, accountId: id, name: 'My Etsy Store', createdAt: now });
  } catch (cause) {
    // Do not leave a login account with no store if the second insert fails.
    // The UUID is server generated; deletion cannot affect another account.
    try { await db.delete(paletteAccounts).where(eq(paletteAccounts.id, id)); }
    catch { /* The initial database error is more helpful than rollback noise. */ }
    throw cause;
  }
  return { accountId: id, storeId };
}
export async function authenticateAccount(emailInput: unknown, password: unknown) {
  const email = normalizeEmail(emailInput);
  if (!validAccountEmail(email) || typeof password !== 'string' || password.length > 128)
    throw Error('Email or password is incorrect.');
  const db = getDb();
  const users = await db.select().from(paletteAccounts).where(eq(paletteAccounts.email, email)).limit(1);
  const user = users[0];
  if (!user) throw Error('Email or password is incorrect.');
  if (user.lockedUntil > Date.now()) throw Error('Too many sign-in attempts. Try again in 15 minutes.');
  const actual = await derivePassword(password, user.passwordSalt);
  if (!constantTimeEqual(actual, user.passwordHash)) {
    const failures = user.failedLogins + 1;
    await db.update(paletteAccounts).set({
      failedLogins: failures >= 5 ? 0 : failures,
      lockedUntil: failures >= 5 ? Date.now() + LOCK_MS : 0,
    }).where(eq(paletteAccounts.id, user.id));
    throw Error('Email or password is incorrect.');
  }
  await db.update(paletteAccounts).set({ failedLogins: 0, lockedUntil: 0 }).where(eq(paletteAccounts.id, user.id));
  const stores = await listOwnedStores(user.id);
  if (!stores.length) throw Error('This account has no store. Contact the administrator.');
  return { accountId: user.id, storeId: stores[0].id };
}
export async function beginAccountSession(accountId: string, storeId: string, req: Request) {
  const token = asHex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token), now = Date.now();
  await getDb().insert(paletteSessions).values({
    tokenHash, accountId, activeStoreId: storeId, createdAt: now, expiresAt: now + SESSION_MS,
  });
  const jar = await cookies();
  jar.set(PALETTEIQ_SESSION_COOKIE, token, {
    httpOnly: true, secure: new URL(req.url).protocol === 'https:',
    sameSite: 'strict', path: '/', maxAge: SESSION_MS / 1000,
  });
}
export async function endAccountSession() {
  const current = await getAccountSession();
  if (current) await getDb().delete(paletteSessions).where(eq(paletteSessions.tokenHash, current.tokenHash));
  const jar = await cookies();
  jar.delete(PALETTEIQ_SESSION_COOKIE);
}
export async function createOwnedStore(accountId: string, name: string) {
  if (!validStoreName(name)) throw Error('Store name must contain 2–90 characters.');
  const id = newId();
  await getDb().insert(paletteStores).values({
    id, accountId, name: name.trim(), createdAt: Date.now(),
  });
  return { id, name: name.trim() };
}
export async function changeActiveStore(session: AccountSession, storeId: string) {
  const db = getDb();
  const stores = await db.select().from(paletteStores)
    .where(and(eq(paletteStores.id, storeId), eq(paletteStores.accountId, session.accountId))).limit(1);
  if (!stores[0]) throw Error('Store not found or not owned by this account.');
  await db.update(paletteSessions).set({ activeStoreId: storeId })
    .where(and(eq(paletteSessions.tokenHash, session.tokenHash), eq(paletteSessions.accountId, session.accountId)));
  return { id: stores[0].id, name: stores[0].name };
}
