import type { SimilarityReview } from '@/lib/similarity-review';

export type RecoverableImage = {
  id: string;
  status?: string;
  imageUrl?: string;
  error?: string;
  similarityReview?: SimilarityReview;
};
export type RecoverableBatchItem = RecoverableImage & { status: 'pending' | 'done' | 'error' };

// Only apply results imported in this sync cycle. Older Batch items have
// already been saved and must never roll back a later regeneration.
export function mergeNewBatchResults<T extends RecoverableImage>(
  characters: T[],
  items: RecoverableBatchItem[],
  changedIds: ReadonlySet<string>,
): T[] {
  const byId = new Map(items.map(item => [item.id, item]));
  return characters.map(character => {
    if (!changedIds.has(character.id)) return character;
    const item = byId.get(character.id);
    // Recovery must not roll back a newer result saved while a Batch was pending.
    if (character.imageUrl && character.imageUrl !== item?.imageUrl) return character;
    if (item?.status === 'done') return {
      ...character,
      imageUrl: item.imageUrl,
      status: 'done',
      error: '',
      similarityReview: item.similarityReview,
    } as T;
    if (item?.status === 'error') return {
      ...character,
      status: 'error',
      error: item.error,
    } as T;
    return character;
  });
}
