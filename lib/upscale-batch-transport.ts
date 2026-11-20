import { env } from 'cloudflare:workers';
import { sharedProviderSecret } from '@/lib/store-secrets';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects, studioSettings } from '@/db/schema';
import { nativeAssetBucket } from '@/lib/native-bridge';
import { batchAssetKey } from '@/lib/batch-assets';
import { decryptCredential } from '@/lib/credentials';
import { normalizeUpscaleServerUrl } from '@/lib/upscale-server-url';

const vars = () => env as unknown as Record<string, string | undefined>;
export const upscaleBucket = () => nativeAssetBucket() ?? env.BUCKET;
export type UpscaleBatchItem = { characterId: string; sourceUrl: string; originalUrl: string };
export type StoredUpscaleBatch = {
  id: string; remoteId?: string; status: 'staging' | 'committed' | 'completed' | 'failed';
  items: UpscaleBatchItem[]; model: string; factor: 2|4|6|8;
  cleanup: boolean; cleanupStrength: string; requireTransparency: boolean;
  qc: boolean; createdAt: number; notificationEmail: string; collectionName?: string;
};
export type UpscaleBatchProject = {
  characters: Array<{ id: string; imageUrl?: string; upscaledImageUrl?: string;
    upscaleJob?: { id: string; sourceUrl: string; originalUrl?: string; factor: 2|4|6|8;
      requireTransparency: boolean; qc: boolean; submittedAt: number } }>;
  upscaleBatch?: StoredUpscaleBatch;
  [key: string]: unknown;
};
export type GpuBatchSnapshot = {
  id: string; status: string; expected_files: number; received_files: number;
  completed_files?: number; notification_configured?: boolean;
  notification_status?: string;
  files?: Array<{ client_file_id: string; job_id?: string; status?: string }>;
};
export async function gpuConfig(owner: string) {
  const rows = await getDb().select().from(studioSettings).where(eq(studioSettings.owner, owner)).limit(1);
  const prefs = rows[0]?.preferences ? JSON.parse(rows[0].preferences) as Record<string, unknown> : {};
  const custom = typeof prefs.upscaleServerUrl === 'string' ? prefs.upscaleServerUrl.trim() : '';
  const address = custom || vars().PALETTEIQ_UPSCALE_SERVER_URL?.trim() || '';
  const key = rows[0]?.upscaleCredential
    ? await decryptCredential(rows[0].upscaleCredential, owner)
    : sharedProviderSecret(owner, 'PALETTEIQ_UPSCALE_SERVER_KEY');
  if (!address || !key || key.length < 32) throw Error('Set Remote GPU URL and Key in this store Settings before submitting an upscale batch.');
  const url = new URL(address);
  if (custom && !normalizeUpscaleServerUrl(custom)) throw Error('Invalid Remote GPU URL');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Invalid Remote GPU URL');
  const desktop = vars().PALETTEIQ_DESKTOP === '1';
  const allowHttp = desktop || vars().PALETTEIQ_ALLOW_PRIVATE_HTTP_UPSCALE === '1' || vars().PALETTEIQ_LOCAL_NO_AUTH === '1';
  const privateHost = /^(?:localhost|127\.0\.0\.1|10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(?:\d{1,3}\.)\d{1,3})$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:' && privateHost)) throw Error('GPU Server requires HTTPS, or an explicitly allowed private HTTP network.');
  const accessId = vars().PALETTEIQ_GPU_ACCESS_CLIENT_ID?.trim();
  const accessSecret = vars().PALETTEIQ_GPU_ACCESS_CLIENT_SECRET?.trim();
  if (!!accessId !== !!accessSecret) throw Error('Both GPU tunnel Access credentials are required');
  return { address: url.origin, key, accessId, accessSecret, prefs };
}
export async function gpuFetch(owner: string, path: string, init: RequestInit = {}) {
  const config = await gpuConfig(owner);
  const result = await fetch(config.address + path, {
    ...init, headers: { 'X-API-Key': config.key,
      ...(config.accessId && config.accessSecret ? {
        'CF-Access-Client-Id': config.accessId, 'CF-Access-Client-Secret': config.accessSecret,
      } : {}), ...init.headers },
    cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(120_000),
  });
  if (!result.ok) throw Error('GPU Server HTTP ' + result.status + ': ' + (await result.text()).slice(0, 240));
  return result;
}
export function upscaleSourceKey(owner: string, reference: string) {
  const url = new URL(reference, 'https://paletteiq.invalid');
  const id = url.pathname.match(/^\/api\/images\/([0-9a-f-]{36})$/)?.[1];
  if (!id || url.searchParams.get('format') === 'jpg') throw Error('Remote Upscale requires a stored PNG file');
  const batch = url.searchParams.get('batch');
  if (batch && !/^[0-9a-f-]{36}$/.test(batch)) throw Error('Invalid image Batch reference');
  return batch ? batchAssetKey(owner, id, 'png', batch) : 'generated/' + owner + '/' + id + '.png';
}
export async function ownedUpscaleProject(owner: string, projectId: string) {
  const rows = await getDb().select().from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.owner, owner))).limit(1);
  if (!rows.length) throw Error('Collection not found for this store');
  return { row: rows[0], data: JSON.parse(rows[0].data) as UpscaleBatchProject };
}
