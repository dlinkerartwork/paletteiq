export type ImageSubjectState = { prompt?: string; imageUrl?: string; status?: string };
export const isActiveBatchStatus = (status: string) => !['completed', 'completed_with_errors', 'failed', 'cancelled', 'expired'].includes(status);
export const wasPreviouslyGenerated = (subject: ImageSubjectState) => !!subject.imageUrl || subject.status === 'done' || subject.status === 'error';
export const eligibleForBulk = (subject: ImageSubjectState, batchPending = false) => !!subject.prompt?.trim() && !wasPreviouslyGenerated(subject) && !batchPending;
