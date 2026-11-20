/** Deterministic, bounded similarity retry policy for saved image assets. */
export const SIMILARITY_RECHECK_LIMIT = 3;
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
