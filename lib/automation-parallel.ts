/**
 * Bound paid work by durable receipts rather than browser tab count.
 * A planned slot is reserved BEFORE its OpenAI submission. A slot without
 * a confirmed remote ID is never automatically resubmitted.
 */
export const AUTOMATION_LIMITS = Object.freeze({
  research: 3, aiFill: 3, prompts: 4, imageBatches: 4,
});
export type ExpansionSlot = {
  id: string; count: number; startedAt: number;
  status: 'submitting'|'queued'|'in_progress'|'uncertain';
  responseId?: string; batchId?: string; error?: string;
};

export function activeExpansionSlots(flow: {
  expansionBatches?: ExpansionSlot[];
  expansionBatch?: Omit<ExpansionSlot, 'id'>;
}): ExpansionSlot[] {
  const current = flow.expansionBatches || [];
  return flow.expansionBatch
    ? [{ ...flow.expansionBatch, id: 'legacy' }, ...current]
    : current;
}

/** Reserve only missing concepts NOT already reserved by another paid call. */
export function planExpansionSlots(
  target: number, savedCharacters: number,
  slots: ReadonlyArray<Pick<ExpansionSlot, 'count'>>,
  attempts: number, maxAttempts: number,
): number[] {
  const capacity = Math.max(0, AUTOMATION_LIMITS.aiFill - slots.length);
  let remaining = Math.max(0, target - savedCharacters -
    slots.reduce((sum, slot) => sum + slot.count, 0));
  const counts: number[] = [];
  for (let i = 0; i < capacity && attempts + counts.length < maxAttempts && remaining > 0; i++) {
    const count = Math.min(15, remaining);
    counts.push(count);
    remaining -= count;
  }
  return counts;
}

export type ImageBatchSlot = { status: string; items: string };
// A remote "completed" status is NOT proof that its PNGs were imported.
// Preserve all pending IDs even when the provider has finished the Batch.
// A failed/cancelled reservation also requires explicit reconciliation.
export function pendingImageIds(records: ReadonlyArray<ImageBatchSlot>): Set<string> {
  const ids = new Set<string>();
  for (const record of records) {
    let items: unknown;
    try { items = JSON.parse(record.items); }
    catch { throw Error('Unreadable saved image Batch reservation; inspect before submitting anything new.'); }
    if (!Array.isArray(items)) throw Error('Invalid saved image Batch reservation; inspect before submitting anything new.');
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const row = item as { id?: unknown; status?: unknown };
      if (typeof row.id === 'string' && row.status === 'pending') ids.add(row.id);
    }
  }
  return ids;
}

export function availableImageSlots(activeBatchCount: number): number {
  return Math.max(0, AUTOMATION_LIMITS.imageBatches - activeBatchCount);
}
