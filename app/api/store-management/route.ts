import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { imageBatches, paletteStores, projects, studioSettings } from '@/db/schema';
import { assertSameOrigin, getAccountSession, listOwnedStores } from '@/lib/palette-accounts';
import { scopeForStore } from '@/lib/store-identity';
import { nonSecretPreferences } from '@/lib/backup-restore';

const noCache = { 'Cache-Control': 'no-store' };
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: noCache });
const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function GET(req: Request) {
  const session = await getAccountSession();
  if (!session) return fail('Please sign in', 401);
  const params = new URL(req.url).searchParams;
  const deletedStore = params.get('deletedStore');
  const snapshot = params.get('snapshot');
  if (deletedStore || snapshot) {
    if (!isUuid(deletedStore) || !isUuid(snapshot)) return fail('Invalid archive reference');
    const bucket = env.BUCKET;
    if (!bucket) return fail('Archive storage is unavailable', 503);
    // Authenticated account ID is baked into the R2 namespace. A deleted
    // store is no longer in paletteiq_stores, so scope derives from session.
    const key = `backups/${scopeForStore(session.accountId, deletedStore)}/deleted-stores/${snapshot}.json`;
    const object = await bucket.get(key);
    if (!object) return fail('Delete safety archive not found', 404);
    return new Response(object.body, { headers: {
      ...noCache, 'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="paletteiq-deleted-store-${deletedStore}.json"`,
    } });
  }
  const stores = await listOwnedStores(session.accountId);
  const allProjects = await getDb().select({ id: projects.id, owner: projects.owner }).from(projects);
  const batches = await getDb().select({ id: imageBatches.id, owner: imageBatches.owner, status: imageBatches.status }).from(imageBatches);
  return Response.json({
    activeStoreId: session.activeStoreId,
    stores: stores.map(store => {
      const owner = scopeForStore(session.accountId, store.id);
      const jobs = batches.filter(job => job.owner === owner);
      return { ...store, collections: allProjects.filter(project => project.owner === owner).length,
        batches: jobs.length, activeJobs: jobs.filter(job => !['completed','failed','cancelled','expired','completed_with_errors'].includes(job.status)).length };
    }),
  }, { headers: noCache });
}

export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return fail('Cross-site request denied', 403);
  const session = await getAccountSession();
  if (!session) return fail('Please sign in', 401);
  if ((env as unknown as Record<string, string | undefined>).PALETTEIQ_DESKTOP === '1')
    return fail('Store deletion is available in Web only until native storage safety backups are implemented', 501);
  let body: { action?: unknown; storeId?: unknown; storeName?: unknown; confirmation?: unknown };
  try { body = await req.json() as typeof body; } catch { return fail('Invalid request body'); }
  if (body.action !== 'delete-store' || !isUuid(body.storeId)) return fail('Invalid store deletion request');
  const db = getDb();
  const owned = await db.select().from(paletteStores)
    .where(and(eq(paletteStores.id, body.storeId), eq(paletteStores.accountId, session.accountId))).limit(1);
  const target = owned[0];
  if (!target) return fail('Store not found in your account', 403);
  if (target.id === session.activeStoreId) return fail('Switch to another store before deleting the active store.', 409);
  if (body.storeName !== target.name || body.confirmation !== 'DELETE STORE')
    return fail('Type the exact store name and DELETE STORE to confirm', 400);
  const stores = await listOwnedStores(session.accountId);
  if (stores.length < 2) return fail('Cannot delete your last store. Create another store first.', 409);

  const owner = scopeForStore(session.accountId, target.id);
  const existing = await db.select().from(projects).where(eq(projects.owner, owner));
  const batches = await db.select().from(imageBatches).where(eq(imageBatches.owner, owner));
  const active = batches.filter(job => !['completed','failed','cancelled','expired','completed_with_errors'].includes(job.status));
  if (active.length) return fail('This store has active image batches. Finish or cancel them before deletion.', 409);
  const preferences = await db.select({ preferences: studioSettings.preferences }).from(studioSettings)
    .where(eq(studioSettings.owner, owner)).limit(1);
  const fallback = stores.find(row => row.id !== target.id)!;
  // The original R2 PNGs are deliberately preserved for recovery. The
  // metadata safety archive is mandatory and verified before SQL deletion.
  const bucket = env.BUCKET;
  const database = env.DB;
  if (!bucket || !database) return fail('D1/R2 safety backup storage unavailable; deletion refused.', 503);
  let prefs: Record<string, unknown> = {};
  try { prefs = JSON.parse(preferences[0]?.preferences || '{}') as Record<string, unknown>; } catch {}
  const archive = {
    format: 'paletteiq-backup', version: 1, exportedAt: new Date().toISOString(),
    deletedStore: { id: target.id, name: target.name, accountId: session.accountId },
    preferences: nonSecretPreferences(prefs),
    projects: existing.map(row => JSON.parse(row.data) as unknown),
    imageBatches: batches, // internal metadata retained for forensic recovery
    warning: 'Snapshot does not include PNG/JPG image binaries or API keys.',
  };
  const snapshot = crypto.randomUUID();
  const key = `backups/${owner}/deleted-stores/${snapshot}.json`;
  try {
    await bucket.put(key, JSON.stringify(archive), { httpMetadata: { contentType: 'application/json' } });
    if (!await bucket.head(key)) return fail('Safety archive could not be verified; store was not deleted', 503);
    // D1.batch is transactional, so all store-specific rows and session
    // switches move together. Object storage is intentionally untouched.
    await database.batch([
      database.prepare('UPDATE paletteiq_sessions SET active_store_id=? WHERE account_id=? AND active_store_id=?')
        .bind(fallback.id, session.accountId, target.id),
      database.prepare('DELETE FROM projects WHERE owner=?').bind(owner),
      database.prepare('DELETE FROM image_batches WHERE owner=?').bind(owner),
      database.prepare('DELETE FROM studio_settings WHERE owner=?').bind(owner),
      database.prepare('DELETE FROM paletteiq_stores WHERE id=? AND account_id=?').bind(target.id,session.accountId),
    ]);
    return Response.json({ ok: true, deletedStore: target.name, deletedStoreId: target.id,
      snapshot, fallbackStoreId: fallback.id, collections: existing.length,
      warning: 'Store and collection metadata removed. Original R2 image files were kept for recovery; JSON archive is available for download.' },
      { headers: noCache });
  } catch (cause) {
    console.error('[PaletteIQ store deletion]', cause);
    return fail('Store deletion failed. Original R2 images remain untouched. Check server logs.', 500);
  }
}
