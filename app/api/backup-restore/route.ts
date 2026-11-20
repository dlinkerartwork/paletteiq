import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { paletteStores, projects, studioSettings } from '@/db/schema';
import { getAccountSession, createOwnedStore, listOwnedStores, assertSameOrigin } from '@/lib/palette-accounts';
import { validStoreName, scopeForStore } from '@/lib/store-identity';
import { MAX_BACKUP_BYTES, readPortableBackup, restorePlan, backupSummary, nonSecretPreferences, type RestoreMode } from '@/lib/backup-restore';

const reply = (error: string, status = 400) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
const noCache = { 'Cache-Control': 'no-store' };
const isMode = (value: unknown): value is RestoreMode => value === 'skip' || value === 'replace' || value === 'keep-both';
type RestoreRequest = { action?: unknown; backup?: unknown; storeId?: unknown; mode?: unknown; importPreferences?: unknown; name?: unknown };

export async function GET(req: Request) {
  const session = await getAccountSession();
  if (!session) return reply('Sign in to restore a backup', 401);
  const backupId = new URL(req.url).searchParams.get('snapshot');
  if (!backupId) return Response.json({
    stores: await listOwnedStores(session.accountId), activeStoreId: session.activeStoreId,
  }, { headers: noCache });
  if (!/^[0-9a-f-]{36}$/.test(backupId)) return reply('Invalid snapshot identifier');
  const storeId = new URL(req.url).searchParams.get('storeId');
  if (!storeId) return reply('Destination store is required');
  const owned = await getDb().select({ id: paletteStores.id }).from(paletteStores)
    .where(and(eq(paletteStores.id, storeId), eq(paletteStores.accountId, session.accountId))).limit(1);
  if (!owned.length) return reply('Store is not part of this account', 403);
  const bucket = env.BUCKET;
  if (!bucket) return reply('Web backup storage is unavailable', 503);
  const owner = scopeForStore(session.accountId, storeId);
  const object = await bucket.get(`backups/${owner}/pre-restore/${backupId}.json`);
  if (!object) return reply('Safety snapshot not found', 404);
  return new Response(object.body, { headers: {
    ...noCache, 'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="paletteiq-before-restore-${backupId}.json"`,
  } });
}

export async function POST(req: Request) {
  if (!assertSameOrigin(req)) return reply('Cross-site restore request denied', 403);
  const session = await getAccountSession();
  if (!session) return reply('Sign in to restore a backup', 401);
  // This endpoint is deliberately Web-only. The Desktop native storage bridge
  // does not expose the same transactional D1.batch/R2 snapshot operations.
  if ((env as unknown as Record<string, string | undefined>).PALETTEIQ_DESKTOP === '1')
    return reply('Use the Web version for this restore workflow', 501);
  if (Number(req.headers.get('content-length') || 0) > MAX_BACKUP_BYTES + 1_000_000)
    return reply('Backup request exceeds the 10 MB JSON limit', 413);
  let body: RestoreRequest;
  try {
    const source = await req.text();
    if (new TextEncoder().encode(source).length > MAX_BACKUP_BYTES + 1_000_000)
      return reply('Backup request exceeds the 10 MB JSON limit', 413);
    body = JSON.parse(source) as RestoreRequest;
  } catch { return reply('Invalid JSON request'); }

  if (body.action === 'create-store') {
    if (!validStoreName(body.name)) return reply('Enter a store name of 2–90 characters');
    try {
      const created = await createOwnedStore(session.accountId, body.name as string);
      return Response.json({ store: created, stores: await listOwnedStores(session.accountId) }, { headers: noCache });
    } catch (cause) { return reply(cause instanceof Error ? cause.message : 'Could not create store'); }
  }

  if (body.action !== 'preview' && body.action !== 'restore') return reply('Unknown restore action');
  if (typeof body.storeId !== 'string' || !isMode(body.mode) ||
      typeof body.importPreferences !== 'boolean') return reply('Choose a destination store and restore options');
  const db = getDb();
  const owned = await db.select().from(paletteStores).where(and(
    eq(paletteStores.id, body.storeId), eq(paletteStores.accountId, session.accountId),
  )).limit(1);
  if (!owned[0]) return reply('Destination store does not belong to this account', 403);

  try {
    const backup = readPortableBackup(body.backup);
    if (new TextEncoder().encode(JSON.stringify(backup)).length > MAX_BACKUP_BYTES)
      return reply('Backup file exceeds 10 MB', 413);
    const owner = scopeForStore(session.accountId, owned[0].id);
    const existing = await db.select({ id: projects.id, owner: projects.owner }).from(projects);
    const plan = restorePlan(backup, existing, owner, body.mode);
    const counts = {
      create: plan.filter(p => p.action === 'create').length,
      replace: plan.filter(p => p.action === 'replace').length,
      skip: plan.filter(p => p.action === 'skip').length,
      keepBoth: plan.filter(p => p.action === 'keep-both').length,
      blocked: plan.filter(p => p.action === 'blocked').length,
    };
    const summary = backupSummary(backup);
    if (body.action === 'preview') {
      return Response.json({ destination: { id: owned[0].id, name: owned[0].name },
        counts, summary, hasLegacyAlias: owned[0].legacyAssetOwner === 'local_seedy',
        warning: 'Original image binaries are NOT in the JSON. Restore copies metadata and image URL references only; missing PNGs are not re-created.',
      }, { headers: noCache });
    }
    if (counts.blocked) return reply('Some collection IDs belong to another store. Choose Keep Both or Skip; Replace cannot overwrite another store.', 409);
    const bucket = env.BUCKET;
    const database = env.DB;
    if (!bucket || !database) return reply('Web D1 or R2 backup storage unavailable. No data was changed.', 503);

    // Snapshot ALL existing destination metadata BEFORE any mutation.
    // Credentials are intentionally excluded, and no images are ever deleted.
    const oldProjects = await db.select().from(projects).where(eq(projects.owner, owner));
    const oldSettings = await db.select({ preferences: studioSettings.preferences }).from(studioSettings)
      .where(eq(studioSettings.owner, owner)).limit(1);
    let currentPreferences: Record<string, unknown> = {};
    try { currentPreferences = JSON.parse(oldSettings[0]?.preferences || '{}') as Record<string, unknown>; }
    catch { /* Preserve even a malformed original as an empty portable settings object. */ }
    const snapshot = {
      format: 'paletteiq-backup', version: 1,
      exportedAt: new Date().toISOString(),
      projects: oldProjects.map(row => JSON.parse(row.data) as unknown),
      preferences: nonSecretPreferences(currentPreferences),
    };
    const snapshotId = crypto.randomUUID();
    const key = `backups/${owner}/pre-restore/${snapshotId}.json`;
    await bucket.put(key, JSON.stringify(snapshot), { httpMetadata: { contentType: 'application/json' } });
    if (!await bucket.head(key)) return reply('Safety snapshot verification failed. No collections changed.', 503);

    // D1.batch commits all SQL statements transactionally. Never write a
    // collection ID owned by a different account/store.
    const statements: D1PreparedStatement[] = [];
    const reserved = new Set(existing.map(x => x.id));
    const restored: Array<{ from: string; to: string; action: string }> = [];
    const now = Date.now();
    for (const row of plan) {
      if (row.action === 'skip') continue;
      const original = row.project;
      let id = original.id;
      if (row.action === 'keep-both') {
        do { id = crypto.randomUUID(); } while (reserved.has(id));
      }
      reserved.add(id);
      const imported = id === original.id ? original : { ...original, id, name: original.name.slice(0, 135) + ' (restored)' };
      const data = JSON.stringify(imported);
      if (data.length > 700_000) return reply('A collection exceeds the 700 KB limit after renaming. No collections changed.', 413);
      statements.push(database.prepare(
        'INSERT INTO projects (id,owner,name,data,updated_at) VALUES (?,?,?,?,?) ' +
        'ON CONFLICT(id) DO UPDATE SET name=excluded.name,data=excluded.data,updated_at=excluded.updated_at ' +
        'WHERE projects.owner=excluded.owner',
      ).bind(id, owner, imported.name.slice(0, 160), data, now));
      restored.push({ from: original.id, to: id, action: row.action });
    }
    if (body.importPreferences) {
      const preferences = nonSecretPreferences(backup.preferences);
      statements.push(database.prepare(
        'INSERT INTO studio_settings (owner,preferences,updated_at) VALUES (?,?,?) ' +
        'ON CONFLICT(owner) DO UPDATE SET preferences=excluded.preferences,updated_at=excluded.updated_at',
      ).bind(owner, JSON.stringify(preferences), now));
    }
    if (statements.length) await database.batch(statements);
    return Response.json({
      ok: true, destination: { id: owned[0].id, name: owned[0].name },
      snapshotId, counts, restored, summary,
      message: 'Metadata restore finished. Existing image binaries were not changed. Verify old image URLs against the current R2 store.',
    }, { headers: noCache });
  } catch (cause) {
    console.error('[PaletteIQ Web backup restore]', cause);
    return reply(cause instanceof Error ? cause.message.slice(0, 240) : 'Restore failed; see server logs', 400);
  }
}
