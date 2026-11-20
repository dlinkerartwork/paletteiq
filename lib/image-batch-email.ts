import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { imageBatches } from '@/db/schema';
import { nativeSmtpOperation, supportsNativeSmtp } from '@/lib/native-bridge';

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
 * Send the verified OpenAI Batch completion email through the Desktop's
 * private Node/Electron SMTP service without contacting the GPU Server.
 * SMTP secrets remain in the native process or in an encrypted local store.
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
  if (!supportsNativeSmtp() || !pendingImageBatchNotification(job, Date.now(), Boolean(openAICompletedCounts))) return false;
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
    await nativeSmtpOperation(owner, {
      action: 'send', batchId: job.id, openaiBatchId: job.openaiBatchId,
      recipient: email,
      storeName: store.slice(0, 90).replace(/[\x00-\x1f\x7f]/g, ' ').trim() || 'PaletteIQ Store',
      collectionName: collection.slice(0, 160).replace(/[\x00-\x1f\x7f]/g, ' ').trim() || 'Untitled Collection',
      total: items.length, completed: success, failed,
    });
    items[0] = { ...items[0], notificationQueuedAt: now, notificationLastAttemptAt: now };
  } catch {
    // Retry on the next Desktop background poll. Email failures must not
    // roll back paid image generation or produce duplicate OpenAI batches.
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
