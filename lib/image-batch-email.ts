import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { imageBatches } from '@/db/schema';
import { gpuFetch } from '@/lib/upscale-batch-transport';

export type EmailBatchItem = {
  id: string; status: 'pending' | 'done' | 'error';
  notifyEmail?: boolean;
  notificationRecipient?: string;
  notificationStoreName?: string;
  notificationCollectionName?: string;
  notificationQueuedAt?: number;
  notificationLastAttemptAt?: number;
  [key: string]: unknown;
};

export function pendingImageBatchNotification(
  job: typeof imageBatches.$inferSelect, now = Date.now(), openAICompleted = false,
) {
  if (!openAICompleted && !['completed', 'completed_with_errors'].includes(job.status)) return false;
  let items: EmailBatchItem[];
  try { items = JSON.parse(job.items) as EmailBatchItem[]; } catch { return false; }
  return Boolean(items.length && items[0].notifyEmail === true &&
    !items[0].notificationQueuedAt &&
    (!items[0].notificationLastAttemptAt || now - items[0].notificationLastAttemptAt > 60_000) &&
    items.length === job.total &&
    (openAICompleted || items.every(item => item.status === 'done' || item.status === 'error')));
}

/**
 * Register a completion receipt immediately when the verified OpenAI Batch
 * status becomes completed, even if its output file is not yet available or
 * imported. The GPU SMTP outbox is independent from image recovery.
 * No SMTP credentials are sent to the browser.
 *
 * The first item holds the email enrollment and retry receipt to avoid schema
 * migrations in existing local SQLite / hosted D1 databases.
 */
export async function queueFinishedImageBatchEmail(
  job: typeof imageBatches.$inferSelect,
  owner: string,
  recipient: string,
  storeName: string,
  collectionName: string,
  openAICompletedCounts?: { completed?: number; failed?: number },
): Promise<boolean> {
  if (!pendingImageBatchNotification(job, Date.now(), Boolean(openAICompletedCounts))) return false;
  const items = JSON.parse(job.items) as EmailBatchItem[];
  const email = items[0].notificationRecipient || recipient;
  const store = items[0].notificationStoreName || storeName;
  const collection = items[0].notificationCollectionName || collectionName;
  const importedSuccess = items.filter(item => item.status === 'done').length;
  const importedFailed = items.filter(item => item.status === 'error').length;
  const countsValid = openAICompletedCounts &&
    Number.isSafeInteger(openAICompletedCounts.completed) &&
    Number.isSafeInteger(openAICompletedCounts.failed) &&
    (openAICompletedCounts.completed ?? -1) >= 0 &&
    (openAICompletedCounts.failed ?? -1) >= 0 &&
    (openAICompletedCounts.completed ?? 0) + (openAICompletedCounts.failed ?? 0) === items.length;
  // -1 means OpenAI has completed the batch but has not provided a
  // complete request count yet. Never invent success or failure figures.
  const success = openAICompletedCounts
    ? (countsValid ? openAICompletedCounts.completed! : -1) : importedSuccess;
  const failed = openAICompletedCounts
    ? (countsValid ? openAICompletedCounts.failed! : -1) : importedFailed;
  const now = Date.now();
  try {
    await gpuFetch(owner, '/v1/notifications/image-batches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_batch_id: job.id, notification_email: email,
        store_name: store.slice(0, 90).replace(/[\x00-\x1f\x7f]/g, ' ').trim() || 'PaletteIQ Store',
        collection_name: collection.slice(0, 160).replace(/[\x00-\x1f\x7f]/g, ' ').trim() || 'Untitled Collection',
        total: items.length, completed: success, failed,
      }),
    });
    items[0] = { ...items[0], notificationQueuedAt: now, notificationLastAttemptAt: now };
  } catch {
    // Retry on the next session / background synchronization, not on the
    // current image import transaction. Never hide or corrupt generated files.
    items[0] = { ...items[0], notificationLastAttemptAt: now };
  }
  const receiptSaved = Boolean(items[0].notificationQueuedAt);
  // Optimistic compare-and-swap prevents a stale retry from overwriting
  // concurrent image import updates or a successful notification receipt.
  await getDb().update(imageBatches)
    .set({ items: JSON.stringify(items), updatedAt: now })
    .where(and(eq(imageBatches.owner, owner), eq(imageBatches.id, job.id),
      eq(imageBatches.items, job.items)));
  return receiptSaved;
}
