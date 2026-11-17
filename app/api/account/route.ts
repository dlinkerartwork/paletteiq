import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { paletteStores } from '@/db/schema';
import {
  assertSameOrigin, authenticateAccount, beginAccountSession, changeActiveStore,
  createAccount, createOwnedStore, endAccountSession, getAccountSession,
  listOwnedStores,
} from '@/lib/palette-accounts';
import { validStoreName } from '@/lib/store-identity';
import { getChatGPTUser } from '@/app/chatgpt-auth';

const error = (message: string, status = 400) => Response.json({ error: message }, { status });
const status = async () => {
  const session = await getAccountSession();
  if (!session) {
    // Optional legacy trusted OAuth gateway is not a local email/password account.
    const legacy = await getChatGPTUser();
    return Response.json(legacy ? {
      authenticated: true, mode: 'trusted-gateway', email: legacy.email,
      stores: [{ id: 'trusted', name: 'Existing workspace' }], activeStoreId: 'trusted',
    } : { authenticated: false, stores: [] });
  }
  return Response.json({
    authenticated: true, mode: 'email-password', email: session.email,
    stores: await listOwnedStores(session.accountId), activeStoreId: session.activeStoreId,
  });
};

export async function GET() {
  try { return await status(); }
  catch (e) { return error('Accounts database unavailable. Apply migration 0005_accounts_and_stores.sql and retry. ' + (e instanceof Error ? e.message.slice(0, 160) : ''), 503); }
}
export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return error('Cross-site account operation denied', 403);
  let input: { action?: string; email?: unknown; password?: unknown; name?: unknown; storeId?: unknown };
  try { input = await req.json() as typeof input; } catch { return error('Invalid request JSON'); }
  try {
    if (input.action === 'register') {
      const created = await createAccount(input.email, input.password);
      await beginAccountSession(created.accountId, created.storeId, req);
      return status();
    }
    if (input.action === 'login') {
      const signedIn = await authenticateAccount(input.email, input.password);
      await beginAccountSession(signedIn.accountId, signedIn.storeId, req);
      return status();
    }
    const session = await getAccountSession();
    if (!session) return error('Please sign in to manage stores', 401);
    if (input.action === 'logout') {
      await endAccountSession();
      return Response.json({ authenticated: false });
    }
    if (input.action === 'create-store') {
      if (!validStoreName(input.name)) return error('Store name must contain 2–90 characters');
      const created = await createOwnedStore(session.accountId, input.name as string);
      await changeActiveStore(session, created.id);
      return status();
    }
    if (input.action === 'switch-store') {
      if (typeof input.storeId !== 'string') return error('Choose a store');
      await changeActiveStore(session, input.storeId);
      return status();
    }
    if (input.action === 'rename-store') {
      if (!validStoreName(input.name) || typeof input.storeId !== 'string')
        return error('Choose an owned store and enter a valid name');
      const db = getDb();
      const changed = await db.update(paletteStores).set({ name: (input.name as string).trim() })
        .where(and(eq(paletteStores.accountId, session.accountId), eq(paletteStores.id, input.storeId)))
        .returning({ id: paletteStores.id });
      if (!changed.length) return error('Store not found', 404);
      return status();
    }
    return error('Unknown account action');
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Account operation failed';
    const statusCode = /incorrect|sign-in attempts/i.test(message) ? 401 :
      /no such table|table .* does not exist/i.test(message) ? 503 : 400;
    return error(message.slice(0, 250), statusCode);
  }
}
