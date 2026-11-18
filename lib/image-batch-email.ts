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

export function pendingImageBatchNotification(job: typeof imageBatches.$inferSelect, now = Date.now()) {
  if (!['completed', 'completed_with_errors'].includes(job.status)) return false;
  let items: EmailBatchItem[];
  try { items = JSON.parse(job.items) as EmailBatchItem[]; } catch { return false; }
  return Boolean(items.length && items[0].notifyEmail === true &&
    !items[0].notificationQueuedAt &&
    (!items[0].notificationLastAttemptAt || now - items[0].notificationLastAttemptAt > 60_000) &&
    items.length === job.total && items.every(item => item.status === 'done' || item.status === 'error'));
}

/**
 * Deliver a receipt to the trusted GPU server's durable SMTP outbox.
 * This function deliberately does not send SMTP credentials to the browser,
 * and failures cannot roll back generated assets or a completed OpenAI Batch.
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
): Promise<boolean> {
  if (!pendingImageBatchNotification(job)) return false;
  const items = JSON.parse(job.items) as EmailBatchItem[];
  const email = items[0].notificationRecipient || recipient;
  const store = items[0].notificationStoreName || storeName;
  const collection = items[0].notificationCollectionName || collectionName;
  const success = items.filter(item => item.status === 'done').length;
  const failed = items.filter(item => item.status === 'error').length;
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
