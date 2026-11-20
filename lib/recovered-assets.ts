import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { paletteStores } from '@/db/schema';

/**
 * Only an administrator-run OFFLINE migration can attach the old local
 * "local_seedy" asset namespace to one authenticated store. The original
 * R2 objects are never moved or deleted by recovery.
 */
const scoped = /^generated\/(user_([0-9a-f]{32})_store_([0-9a-f]{32}))\//;
const restoreUuid = (part: string) =>
  part.slice(0,8)+'-'+part.slice(8,12)+'-'+part.slice(12,16)+'-'+part.slice(16,20)+'-'+part.slice(20);
function validateKey(key: string) {
  return scoped.exec(key);
}
async function inheritedKey(key: string): Promise<string | null> {
  const match = validateKey(key);
  if (!match) return null; // Ignore malformed or non-owned keys.
  const accountId = restoreUuid(match[2]);
  const storeId = restoreUuid(match[3]);
  const row = await getDb().select({ legacy: paletteStores.legacyAssetOwner }).from(paletteStores)
    .where(and(eq(paletteStores.id, storeId), eq(paletteStores.accountId, accountId))).limit(1);
  if (row[0]?.legacy !== 'local_seedy') return null;
  return 'generated/local_seedy/' + key.slice(match[0].length);
}
export async function getRecoverableAsset(bucket: R2Bucket | null | undefined, key: string) {
  if (!bucket) return null;
  const direct = await bucket.get(key);
  if (direct) return direct;
  const previous = await inheritedKey(key);
  return previous ? await bucket.get(previous) : null;
}
export async function headRecoverableAsset(bucket: R2Bucket | null | undefined, key: string) {
  if (!bucket) return null;
  const direct = await bucket.head(key);
  if (direct) return direct;
  const previous = await inheritedKey(key);
  return previous ? await bucket.head(previous) : null;
}
