// OpenAI may report the Batch as completed before its result-file links
// become available. Do not convert pending characters into permanent errors.
export function awaitBatchOutputFiles(batch: {
  status: string;
  output_file_id?: string | null;
  error_file_id?: string | null;
  request_counts?: { completed: number; failed: number };
}): boolean {
  if (batch.status !== 'completed') return false;
  if (batch.output_file_id || batch.error_file_id) return false;
  // Even a completed Batch with no request counters should be retried briefly;
  // the output link may arrive on the next poll.
  return true;
}
