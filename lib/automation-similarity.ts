/** Deterministic, bounded similarity retry policy for saved image assets. */
export const SIMILARITY_RECHECK_LIMIT = 3;
// Bounded paid image replacement: at most two rounds for the flagged images,
// never an unlimited prompt/image-generation loop.
export const MAX_AUTOMATIC_REGENERATION_ROUNDS = 2;
export const SIMILARITY_RECHECK_PER_TICK = 4;
export const SIMILARITY_RECHECK_COOLDOWN_MS = 30_000;

export type SimilarityCandidate = {
  id: string; imageUrl?: string;
  similarityReview?: {status?: string;reason?: string};
};
export type RetryLedger = {
  attempts?: Record<string, number>;
  nextAt?: Record<string, number>;
};
export function unverifiedImages<T extends SimilarityCandidate>(characters: readonly T[]): T[] {
  return characters.filter(c=>Boolean(c.imageUrl) &&
    c.similarityReview?.status !== 'clear' &&
    c.similarityReview?.status !== 'needs_review');
}
/** Different image version = different retry budget; a previous failed image
 * must not consume the new replacement image's verification attempts. */
export function similarityRetryKey(candidate: SimilarityCandidate): string {
  return candidate.id + '|' + candidate.imageUrl;
}
export function similarityDue<T extends SimilarityCandidate>(
  characters:readonly T[], ledger:RetryLedger, at:number,
): T[] {
  return unverifiedImages(characters).filter(c=>{
    const key=similarityRetryKey(c);
    return (ledger.attempts?.[key]||0)<SIMILARITY_RECHECK_LIMIT &&
      (ledger.nextAt?.[key]||0)<=at;
  }).slice(0,SIMILARITY_RECHECK_PER_TICK);
}
export function similarityExhausted<T extends SimilarityCandidate>(
  characters:readonly T[], ledger:RetryLedger,
): T[] {
  return unverifiedImages(characters).filter(c=>
    (ledger.attempts?.[similarityRetryKey(c)]||0)>=SIMILARITY_RECHECK_LIMIT);
}
/** Only automatically recover the exact old similarity-specific pause, never
 * a user Pause or an uncertain submission from a billable job. */
export function canAutoRecoverSimilarityPause(flow?: {
  enabled?:boolean;stage?:string;resumeStage?:string;lastError?:string;
}): boolean {
  return !!flow?.enabled && flow.stage==='paused' &&
    flow.resumeStage==='images' &&
    /^\d+ image\(s\) have unverified similarity checks\. Review required\.$/.test(flow.lastError||'');
}

/** Auto-recover ONLY the legacy pause caused by a *completed* first image
 * replacement with confirmed similarity flags. Never resume manual pauses,
 * missing/uncertain Batch receipts, or other paid-work failures. */
export function canAutoRecoverFirstReplacementPause(flow?: {
  enabled?:boolean;stage?:string;resumeStage?:string;lastError?:string;
  regenerationBatchId?:string;reviewQueue?:string[];regenerationRounds?:number;
}): boolean {
  return !!flow?.enabled && flow.stage==='paused' && flow.resumeStage==='verifying' &&
    !!flow.regenerationBatchId && !!flow.reviewQueue?.length &&
    (flow.regenerationRounds||1)<MAX_AUTOMATIC_REGENERATION_ROUNDS &&
    /^\d+ replacement image\(s\) are still too similar\. One automatic regeneration was already attempted; inspect manually\.$/.test(flow.lastError||'');
}

/** The first generation attempt is present when verifying a saved Batch,
 * including flows stored before the regenerationRounds field existed. */
export function savedRegenerationRounds(flow?: {
  regenerationRounds?:number;regenerationBatchId?:string;
}): number {
  if (flow?.regenerationRounds !== undefined) {
    const n=flow.regenerationRounds;
    if (Number.isInteger(n)&&n>=0) return n;
  }
  return flow?.regenerationBatchId?1:0;
}

/** Find a saved replacement Batch belonging to these exact original image
 * versions, not a previous regeneration round for the same character IDs. */
export function matchesCurrentReplacementVersion(
  items:readonly {id:string;replaceFromImageUrl?:string}[],
  ids:readonly string[], currentImages:ReadonlyMap<string,string>,
): boolean {
  return ids.length>0 && ids.every(id=>{
    const original=currentImages.get(id);
    return !!original && items.some(item=>
      item.id===id && item.replaceFromImageUrl===original);
  });
}
