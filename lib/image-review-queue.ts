import type { SimilarityReview } from '@/lib/similarity-review';
import { reviewImageSimilarity } from '@/lib/similarity-review';

/** Import and review are separate bounded stages. The image must already exist. */
export const BATCH_IMPORT_LIMIT = 12;
export const BATCH_REVIEW_LIMIT = 2;

export type ReviewableBatchItem = {
  id: string; status: string; imageUrl?: string; similarityReview?: SimilarityReview;
};

export function needsBatchReview(item: ReviewableBatchItem): boolean {
  return item.status === 'done' && !!item.imageUrl && !item.similarityReview;
}

export function pendingBatchReviewCount(items: ReviewableBatchItem[]): number {
  return items.filter(needsBatchReview).length;
}

export async function reviewStoredBatchImage(
  bucket: R2Bucket, key: string, mime: 'image/png' | 'image/jpeg',
  apiKey: string, references: string[],
): Promise<SimilarityReview> {
  const object = await bucket.get(key);
  if (!object) return { status: 'unverified', reason: 'Saved image is temporarily unavailable; check image storage.', checkedAt: Date.now() };
  const bytes = new Uint8Array(await object.arrayBuffer());
  // Encode in bounded chunks to avoid call-stack overflow on large images.
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return reviewImageSimilarity(apiKey, btoa(binary), mime, references);
}
