import { env } from 'cloudflare:workers';
import { sharedProviderSecret } from '@/lib/store-secrets';
import { and, asc, count, desc, eq, notInArray } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { imageBatches, projects, studioSettings } from '@/db/schema';
import { userCredential } from '@/lib/credentials';
import { eligibleForBulk, retryableFailedImage, isActiveBatchStatus } from '@/lib/production-rules';
import { originalImagePrompt } from '@/lib/originality';
import type { SimilarityReview } from '@/lib/similarity-review';
import { BATCH_IMPORT_LIMIT, BATCH_REVIEW_LIMIT, needsBatchReview, pendingBatchReviewCount, reviewStoredBatchImage } from '@/lib/image-review-queue';
import { nativeAssetBucket } from '@/lib/native-bridge';
import { acquireProductionLocks } from '@/lib/production-locks';
import { mergeNewBatchResults } from '@/lib/batch-recovery';
import { batchAssetKey, batchAssetUrl } from '@/lib/batch-assets';
import { awaitBatchOutputFiles } from '@/lib/batch-status';
import { pendingImageBatchNotification, queueFinishedImageBatchEmail, type EmailBatchItem } from '@/lib/image-batch-email';

import { isImageBatchModel, imageBatchModelError } from '@/lib/image-batch-models';
const syncingJobIds = new Set<string>();
// A different Batch within the same collection must not concurrently write
// a stale project snapshot and erase already imported images.
const syncingProjectIds = new Set<string>();
const IMAGE_BATCH_SYNC_PER_COLLECTION = 4;
type BatchItem = EmailBatchItem & { imageUrl?: string; error?: string; similarityReview?: SimilarityReview; replaceFromImageUrl?: string };
type OpenAIBatch = { id: string; status: string; output_file_id?: string | null; error_file_id?: string | null; request_counts?: { total: number; completed: number; failed: number } };
const fail = (message: string, code = 400) => Response.json({ error: message }, { status: code });
const openai = async (key: string, path: string, init: RequestInit = {}) => {
  const res = await fetch(`https://api.openai.com/v1/${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, ...init.headers } });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 240)}`);
  return res;
};
const safeJob = (job: typeof imageBatches.$inferSelect) => ({
  id: job.id, status: job.status, model: job.model, createdAt: job.createdAt,
  characterIds: (JSON.parse(job.items) as BatchItem[]).map(i => i.id),
  total: job.total, completed: job.completed, failed: job.failed,
  imported: (JSON.parse(job.items) as BatchItem[]).filter(i => i.status === 'done').length,
  assets: (JSON.parse(job.items) as BatchItem[]).filter(i => i.status !== 'pending'),
});

// A batch can be submitted once, and OpenAI continues processing even if the tab closes.
export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return fail('Sign in required', 401);
  const data = await req.json() as { projectId?: string; characterIds?: string[]; model?: string; quality?: string; regenerate?: boolean };
  if (!data.projectId || !Array.isArray(data.characterIds) || !data.characterIds.length || data.characterIds.length > 20 || !['low','medium','high'].includes(data.quality || '')) return fail('Select 1–20 characters per Image Batch, a Batch model, and quality.');
  if (!isImageBatchModel(data.model)) return fail(imageBatchModelError(data.model), 422);
  if (new Set(data.characterIds).size !== data.characterIds.length) return fail('Duplicate characters are not allowed.');
  const release = acquireProductionLocks(user.userId, data.projectId, data.characterIds);
  if (!release) return fail('A generation request for one of these characters is already being submitted.', 409);
  try {
  const db = getDb();
  const saved = await db.select().from(projects).where(and(eq(projects.id, data.projectId), eq(projects.owner, user.userId))).limit(1);
  if (!saved.length) return fail('Save the collection before submitting a batch.', 404);
  const project = JSON.parse(saved[0].data) as { characters?: Array<{ id: string; prompt: string; status?: string; imageUrl?: string; similarityReview?: SimilarityReview }> };
  const selected = data.characterIds.map(id => project.characters?.find(c => c.id === id));
  const retryAllowed = (c: NonNullable<typeof selected[number]>) =>
    retryableFailedImage(c) || (c.similarityReview?.status === 'needs_review' && !!c.imageUrl) ||
    (data.characterIds!.length === 1 && !!c.imageUrl);
  if (data.regenerate && selected.some(c => !c || !retryAllowed(c)))
    return fail('Regeneration accepts review-flagged images, failed images, or one explicitly selected existing image.');
  if (selected.some(c => !c?.prompt || (!data.regenerate && !eligibleForBulk(c))))
    return fail('Batch accepts only never-generated prompts unless regeneration is explicitly requested.');
  const previous = await db.select().from(imageBatches).where(and(eq(imageBatches.owner, user.userId), eq(imageBatches.projectId, data.projectId)));
  const activeIds = new Set(previous.filter(b => isActiveBatchStatus(b.status) || ['submitting','uncertain'].includes(b.status) || b.openaiBatchId.startsWith('pending:')).flatMap(b => (JSON.parse(b.items) as BatchItem[]).filter(i => i.status === 'pending').map(i => i.id)));
  if (data.characterIds.some(id => activeIds.has(id))) return fail('Some characters already have a pending Batch job.');
  // Validate output storage before creating a chargeable OpenAI Batch.
  if (!(nativeAssetBucket() ?? env.BUCKET)) return fail('Image storage is unavailable. Batch was not submitted to OpenAI.', 503);
  const secret = sharedProviderSecret(user.userId, 'OPENAI_API_KEY');
  const key = await userCredential(user.userId, 'openai') || secret;
  if (!key) return fail('Configure an OpenAI API key in Settings first.', 503);
  const settings = await db.select().from(studioSettings).where(eq(studioSettings.owner, user.userId)).limit(1);
  const prefs = settings[0] ? JSON.parse(settings[0].preferences) as { output?: string; background?: string; maxReferenceSimilarityPercent?: number } : {};
  const format = prefs.output === 'jpg' ? 'jpeg' : 'png';
  const background = prefs.background === 'opaque' || format === 'jpeg' ? 'opaque' : 'transparent';
  const lines = selected.map(c => JSON.stringify({ custom_id: c!.id, method: 'POST', url: '/v1/images/generations', body: { model: data.model, prompt: originalImagePrompt(c!.prompt, c!.id, '', prefs.maxReferenceSimilarityPercent ?? 40), quality: data.quality, size: '1024x1024', background, output_format: format, n: 1 } })).join('\n') + '\n';
  // Reserve the exact character IDs BEFORE reaching a billable Batch
  // endpoint. If the worker dies after OpenAI acceptance, the reserved row
  // persists and prevents the scheduler from charging the same IDs again.
  const now = Date.now();
  const reservationId = crypto.randomUUID();
  const record = {
    id: reservationId, owner: user.userId, projectId: data.projectId,
    openaiBatchId: 'pending:' + reservationId, model: data.model!, format,
    status: 'submitting', total: selected.length, completed: 0, failed: 0,
    items: JSON.stringify(data.characterIds.map((id, index) => ({ id, status: 'pending',
      ...(data.regenerate && selected[index]?.imageUrl ? { replaceFromImageUrl: selected[index]!.imageUrl } : {}),
      ...(index === 0 ? { notifyEmail: true, notificationRecipient: user.email,
        notificationStoreName: user.displayName, notificationCollectionName: saved[0].name } : {})
    }))), outputFileId: null, errorFileId: null, createdAt: now, updatedAt: now,
  };
  await db.insert(imageBatches).values(record);
  // This second check closes the cross-worker race where two independent
  // Cloudflare isolates passed the earlier overlap check simultaneously.
  const reservations = await db.select().from(imageBatches)
    .where(and(eq(imageBatches.owner,user.userId),eq(imageBatches.projectId,data.projectId)));
  const others = reservations.filter(other => other.id !== reservationId &&
    (isActiveBatchStatus(other.status) || ['submitting','uncertain'].includes(other.status) ||
      other.openaiBatchId.startsWith('pending:')) &&
    (JSON.parse(other.items) as BatchItem[]).some(item => data.characterIds!.includes(item.id) && item.status === 'pending'));
  if (others.length) {
    await db.update(imageBatches).set({status:'cancelled',updatedAt:Date.now()})
      .where(and(eq(imageBatches.id,reservationId),eq(imageBatches.owner,user.userId)));
    return fail('Another Batch reservation already covers these characters. No paid request was sent.',409);
  }
  try {
    const form = new FormData();
    form.set('purpose', 'batch');
    form.set('file', new Blob([lines], { type: 'application/jsonl' }), 'paletteiq-batch.jsonl');
    const uploaded = await (await openai(key, 'files', { method: 'POST', body: form })).json() as { id: string };
    if (!uploaded.id) throw Error('OpenAI file upload did not return a tracking ID');
    const job = await (await openai(key, 'batches', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input_file_id: uploaded.id, endpoint: '/v1/images/generations',
        completion_window: '24h', metadata: { application: 'paletteiq', project: data.projectId,
          reservation: reservationId } }) })).json() as OpenAIBatch;
    if (!job.id) throw Error('OpenAI Batch response was missing its ID');
    const persisted = await db.update(imageBatches).set({
      openaiBatchId:job.id,status:job.status||'validating',updatedAt:Date.now(),
    }).where(and(eq(imageBatches.id,reservationId),eq(imageBatches.owner,user.userId)))
      .returning({id:imageBatches.id});
    if (!persisted.length) throw Error('Remote Batch accepted but the reservation could not be updated');
    return Response.json({ job: safeJob({ ...record, openaiBatchId:job.id,
      status:job.status||'validating' }) });
  } catch (error) {
    // Do not erase the reservation or perform an automatic cancellation:
    // either would make an interrupted acceptance look safe to resubmit.
    await db.update(imageBatches).set({status:'uncertain',updatedAt:Date.now()})
      .where(and(eq(imageBatches.id,reservationId),eq(imageBatches.owner,user.userId)))
      .catch(()=>{});
    return fail('Image Batch submission is uncertain and reserved against paid retry. '+
      (error instanceof Error ? error.message : String(error)).slice(0,210)+
      '. Review OpenAI Batch activity before any resubmission.',503);
  }
  } finally { release(); }
}

// Decode large PNG/JPG payloads in bounded windows; atob(b64) for the entire
// image temporarily allocates another huge V8 string in addition to the JSON
// line and the final byte array.
function decodeImageBase64(b64: string): Uint8Array {
  if (b64.length % 4 !== 0 || b64.length > 60_000_000)
    throw Error('Batch image base64 payload has an invalid or excessive size');
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(b64.length / 4 * 3 - padding);
  let index = 0;
  for (let offset = 0; offset < b64.length; offset += 65536) {
    const fragment = atob(b64.slice(offset, offset + 65536));
    for (let i = 0; i < fragment.length; i++) bytes[index++] = fragment.charCodeAt(i);
  }
  return bytes;
}

async function* jsonlLines(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1);
        if (line.trim()) yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield buffer;
  } finally { await reader.cancel().catch(() => {}); }
}

async function syncJob(job: typeof imageBatches.$inferSelect, key: string, owner: string, userEmail: string, storeName: string) {
  if (syncingJobIds.has(job.id) || syncingProjectIds.has(job.projectId)) return job;
  syncingJobIds.add(job.id);
  syncingProjectIds.add(job.projectId);
  try {
  const db = getDb();
  const savedProject = await db.select().from(projects).where(and(eq(projects.id, job.projectId), eq(projects.owner, owner))).limit(1);
  const reviewSources = savedProject.length ? JSON.parse(savedProject[0].data) as { selectedImageUrls?: string[]; images?: string[] } : {};
  const references = reviewSources.selectedImageUrls ?? reviewSources.images ?? [];
  const settingsRows=await db.select({ preferences:studioSettings.preferences }).from(studioSettings).where(eq(studioSettings.owner,owner)).limit(1);
  let maxReferenceSimilarityPercent = 40;
  try { const value=Number(JSON.parse(settingsRows[0]?.preferences||'{}').maxReferenceSimilarityPercent); if(Number.isInteger(value) && value>=0 && value<=100) maxReferenceSimilarityPercent=value; } catch { /* retain default */ }
  const batch = await (await openai(key, `batches/${encodeURIComponent(job.openaiBatchId)}`)).json() as OpenAIBatch;
  // Email is triggered by OpenAI's verified completed status, not by the
  // later PNG download, similarity review or collection import. OpenAI may
  // mark a Batch completed before its output files are available.
  if (batch.status === 'completed' && savedProject.length &&
      pendingImageBatchNotification(job, Date.now(), true)) {
    try {
      await queueFinishedImageBatchEmail(
        job, owner, userEmail, storeName, savedProject[0].name, batch.request_counts ?? {},
      );
    } catch { /* SMTP relay errors cannot prevent recovering paid image assets. */ }
  }
  // The completion receipt was stored in items, so reload that version before
  // rewriting imported image URLs. Otherwise import could erase the receipt
  // and cause duplicate emails on the next sync.
  const persisted = await db.select().from(imageBatches)
    .where(and(eq(imageBatches.id, job.id), eq(imageBatches.owner, owner))).limit(1);
  if (awaitBatchOutputFiles(batch)) throw new Error('Batch completed at OpenAI, but result files are not yet available. Recovery will retry automatically.');
  const items = JSON.parse(persisted[0]?.items ?? job.items) as BatchItem[];
  const byId = new Map(items.map(i => [i.id, i]));
  const changedIds = new Set<string>();
  const isTerminal = ['completed', 'expired', 'cancelled', 'failed'].includes(batch.status);
  const bucket = nativeAssetBucket() ?? env.BUCKET;
  // Never mark a terminal Batch as imported when its image storage is offline.
  // Leave its item records pending so the next recovery attempt can succeed.
  if (isTerminal && !bucket) throw new Error('Batch recovery paused: image storage is unavailable. Retry when storage is restored.');
  if (isTerminal && bucket) {
    let handled = 0;
    let interrupted = false;
    for (const fileId of [batch.output_file_id, batch.error_file_id].filter((x): x is string => !!x)) {
      const result = await openai(key, `files/${encodeURIComponent(fileId)}/content`);
      if (!result.body) continue;
      for await (const line of jsonlLines(result.body)) {
        let record: { custom_id?: string; response?: { body?: { data?: Array<{ b64_json?: string }>; error?: { message?: string } } }; error?: { message?: string } };
        try { record = JSON.parse(line); } catch { continue; }
        const item = record.custom_id ? byId.get(record.custom_id) : undefined;
        if (!item || item.status !== 'pending') continue;
        const b64 = record.response?.body?.data?.[0]?.b64_json as string | undefined;
        if (b64) {
          const extension = job.format === 'jpeg' ? 'jpg' : 'png';
          await bucket.put(batchAssetKey(owner, record.custom_id!, extension, job.id), decodeImageBase64(b64), { httpMetadata: { contentType: extension === 'jpg' ? 'image/jpeg' : 'image/png' } });
          item.status = 'done'; item.imageUrl = batchAssetUrl(record.custom_id!, extension, job.id);
          // Save the paid image first. The independent review queue will read it
          // from durable storage on later syncs, without blocking PNG import.
        } else { item.status = 'error'; item.error = String(record.error?.message || record.response?.body?.error?.message || 'Batch item failed').slice(0, 260); }
        changedIds.add(item.id);
        handled++;
        if (handled >= BATCH_IMPORT_LIMIT) { interrupted = true; break; }
      }
      if (handled >= BATCH_IMPORT_LIMIT) break;
    }
    // If the OpenAI output is complete but we stopped due to the safe import
    // budget, leave unhandled rows pending for another recovery cycle.
    if (!interrupted) for (const item of items) if (item.status === 'pending') {
      item.status = 'error'; item.error = 'No output returned by OpenAI for this item.'; changedIds.add(item.id);
    }
  }
  // Review at most two already-persisted images per sync, independently of
  // the import budget. Keep the Batch active as "reviewing" until every saved
  // asset has a verdict; Full Automation must not treat unchecked as clear.
  // Recovery after a PC restart prioritizes saving every already-paid PNG.
  // Visual similarity checks can be slow/expensive; begin them only after all
  // Batch output rows have been imported. This never skips the checks.
  if (bucket && isTerminal && items.every(item => item.status !== 'pending')) {
    const reviewQueue = items.filter(needsBatchReview).slice(0, BATCH_REVIEW_LIMIT);
    await Promise.all(reviewQueue.map(async item => {
      const extension = job.format === 'jpeg' ? 'jpg' : 'png';
      try {
        item.similarityReview = await reviewStoredBatchImage(
          bucket, batchAssetKey(owner, item.id, extension, job.id),
          extension === 'jpg' ? 'image/jpeg' : 'image/png', key, references, maxReferenceSimilarityPercent);
      } catch (error) {
        item.similarityReview = { status: 'unverified',
          reason: 'Similarity review failed: ' +
            (error instanceof Error ? error.message.slice(0,180) : 'unknown error'),
          checkedAt: Date.now() };
      }
      changedIds.add(item.id);
    }));
  }
  const newCompleted = items.filter(i => i.status === 'done').length;
  const newFailed = items.filter(i => i.status === 'error').length;
  const importedAll = isTerminal && items.every(i => i.status !== 'pending');
  const status = importedAll
    ? pendingBatchReviewCount(items) ? 'reviewing' : (newFailed ? 'completed_with_errors' : 'completed')
    : isTerminal ? 'importing' : batch.status;
  const requestCompleted = batch.request_counts?.completed || 0;
  const requestFailed = batch.request_counts?.failed || 0;
  // Persist asset references in the collection BEFORE advancing job bookkeeping.
  // If this write fails, the job remains retriable rather than incorrectly marked complete.
  if (changedIds.size) {
    let committed = false;
    for (let attempt = 0; attempt < 5 && !committed; attempt++) {
      const saved = await db.select().from(projects).where(and(eq(projects.id, job.projectId), eq(projects.owner, owner))).limit(1);
      if (!saved.length) throw new Error('Batch import paused: original collection missing; job remains recoverable.');
      const project = JSON.parse(saved[0].data) as { characters?: Array<{ id: string; imageUrl?: string; status?: string; error?: string; similarityReview?: SimilarityReview }> };
      project.characters = project.characters ? mergeNewBatchResults(project.characters, items, changedIds) : undefined;
      const result = await db.update(projects).set({
        data: JSON.stringify(project), updatedAt: Math.max(Date.now(),saved[0].updatedAt+1),
      }).where(and(eq(projects.id,job.projectId),eq(projects.owner,owner),
        eq(projects.updatedAt,saved[0].updatedAt))).returning({id:projects.id});
      committed = result.length > 0;
    }
    if (!committed) throw Error('Collection changed during image import; assets remain in durable storage for recovery.');
  }
  await db.update(imageBatches).set({ status, completed: Math.max(requestCompleted, newCompleted), failed: Math.max(requestFailed, newFailed), items: JSON.stringify(items), outputFileId: batch.output_file_id ?? null, errorFileId: batch.error_file_id ?? null, updatedAt: Date.now() }).where(and(eq(imageBatches.id, job.id), eq(imageBatches.owner, owner)));
  const savedJob = { ...job, status, completed: Math.max(requestCompleted, newCompleted), failed: Math.max(requestFailed, newFailed), items: JSON.stringify(items) };
  // Enqueue SMTP only after all images have been recovered and the batch
  // bookkeeping is durable. A mail relay outage never invalidates a paid Batch.
  // Recovery fallback: if the relay was temporarily unavailable at OpenAI
  // completion, keep retrying after images import successfully.
  if (importedAll && !pendingBatchReviewCount(items) && batch.status === 'completed' && savedProject.length &&
      pendingImageBatchNotification(savedJob)) {
    try { await queueFinishedImageBatchEmail(savedJob, owner, userEmail, storeName, savedProject[0].name, batch.request_counts ?? {}); }
    catch { /* Keep the completion durable; notification can retry on syncAll. */ }
  }
  return savedJob;
  } finally { syncingJobIds.delete(job.id); syncingProjectIds.delete(job.projectId); }
}

export async function GET(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return fail('Sign in required', 401);
  const url = new URL(req.url);
  if (url.searchParams.get('syncAll') === '1') {
    // Resume a bounded number of outstanding OpenAI batches after desktop
    // restart, even when the user is not on the Image Production page.
    const db = getDb();
    const activeCandidates = await db.select().from(imageBatches).where(and(eq(imageBatches.owner, user.userId), notInArray(imageBatches.status, ['completed', 'completed_with_errors', 'failed', 'cancelled', 'expired', 'submitting', 'uncertain']))).orderBy(asc(imageBatches.updatedAt)).limit(30);
    // Fair polling across collections, and independent progress for up to
    // four active Batch receipts per collection. A validating Batch must not
    // prevent importing another Batch that has already published output.
    const seenProjects = new Set<string>();
    const perProject = new Map<string,number>();
    const active = activeCandidates.filter(row => {
      if (!seenProjects.has(row.projectId) && seenProjects.size >= 2) return false;
      const count=perProject.get(row.projectId)||0;
      if(count>=IMAGE_BATCH_SYNC_PER_COLLECTION)return false;
      seenProjects.add(row.projectId);
      perProject.set(row.projectId,count+1);
      return true;
    });
    const key = await userCredential(user.userId, 'openai') || sharedProviderSecret(user.userId, 'OPENAI_API_KEY');
    const updatedProjectIds: string[] = [];
    const warnings: string[] = [];
    if (key) for (const row of active) {
      try { await syncJob(row, key, user.userId, user.email, user.displayName); updatedProjectIds.push(row.projectId); }
      catch (error) { warnings.push(error instanceof Error ? error.message : 'Batch recovery failed'); }
    }
    // Opportunistic durable mail retries after reopening the browser or
    // desktop. Previously created batches are not enrolled automatically.
    const recentFinished = await db.select().from(imageBatches)
      .where(and(eq(imageBatches.owner, user.userId), notInArray(imageBatches.status,
        ['queued', 'validating', 'in_progress', 'finalizing', 'importing'])))
      .orderBy(desc(imageBatches.updatedAt)).limit(60);
    const pendingMail = recentFinished.filter(row => pendingImageBatchNotification(row)).slice(0, 3);
    if (pendingMail.length) {
      const known = await db.select({ id: projects.id, name: projects.name }).from(projects)
        .where(eq(projects.owner, user.userId));
      const names = new Map(known.map(project => [project.id, project.name]));
      for (const job of pendingMail) {
        const collectionName = names.get(job.projectId);
        if (!collectionName) continue;
        try { await queueFinishedImageBatchEmail(job, user.userId, user.email, user.displayName, collectionName); }
        catch { /* Next sync retry keeps this independent of image recovery. */ }
      }
    }
    return Response.json({ updatedProjectIds: [...new Set(updatedProjectIds)],
      pendingJobs: active.length, credentialMissing: !key && active.length > 0, warnings });
  }
  if (url.searchParams.get('activity') === '1') {
    const pageSize = Number(url.searchParams.get('limit') || '25');
    const offset = Number(url.searchParams.get('offset') || '0');
    if (![10, 25, 50, 100].includes(pageSize) || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) return fail('Invalid activity pagination');
    const db = getDb();
    const owner = eq(imageBatches.owner, user.userId);
    const [totals, recent, ownedProjects] = await Promise.all([
      db.select({ value: count() }).from(imageBatches).where(owner),
      db.select().from(imageBatches).where(owner).orderBy(desc(imageBatches.createdAt), desc(imageBatches.id)).limit(pageSize).offset(offset),
      db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.owner, user.userId)),
    ]);
    const labels = new Map(ownedProjects.map(project => [project.id, project.name]));
    return Response.json({ total: totals[0]?.value ?? 0, activities: recent.map(job => ({ collection: labels.get(job.projectId) ?? 'Deleted collection', job: safeJob(job) })) });
  }
  const projectId = url.searchParams.get('projectId');
  if (!projectId) return fail('Missing project ID');
  const db = getDb();
  const saved = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.owner, user.userId))).limit(1);
  if (!saved.length) return fail('Unknown project', 404);
  const rows = await db.select().from(imageBatches).where(and(eq(imageBatches.owner, user.userId), eq(imageBatches.projectId, projectId))).orderBy(desc(imageBatches.createdAt)).limit(200);
  const key = await userCredential(user.userId, 'openai') || sharedProviderSecret(user.userId, 'OPENAI_API_KEY');
  const sync = new URL(req.url).searchParams.get('sync') === '1';
  // Poll multiple Batch receipts instead of blocking all imports behind
  // the first still-validating or in-progress Batch. Serialize imports so
  // different jobs cannot overwrite each other's collection updates.
  const freshById = new Map<string,ReturnType<typeof safeJob> & {warning?:string}>();
  if(sync && key){
    // Least recently checked Batch goes first, so 10/25-image groups each
    // receive independent polling turns instead of the newest four batches
    // monopolizing polling until they finish.
    const pendingRows=rows.filter(row=>isActiveBatchStatus(row.status) && !row.openaiBatchId.startsWith('pending:'))
      .sort((a,b)=>a.updatedAt-b.updatedAt)
      .slice(0,IMAGE_BATCH_SYNC_PER_COLLECTION);
    for(const row of pendingRows){
      try { freshById.set(row.id,safeJob(await syncJob(row,key,user.userId,user.email,user.displayName))); }
      catch(error){freshById.set(row.id,{...safeJob(row),
        warning:error instanceof Error?error.message:'Unable to sync'}); }
    }
  }
  return Response.json({jobs:rows.map(row=>freshById.get(row.id)||safeJob(row))});
}
