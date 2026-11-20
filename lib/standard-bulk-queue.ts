/**
 * Bounded foreground concurrency for Standard Bulk.
 * Never resubmit a failed task automatically: an uncertain response may have
 * succeeded and been billed upstream.
 */
export async function runBoundedQueue<T>(
  tasks: readonly T[],
  workers: number,
  execute: (task: T) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ completed: number; failed: number }> {
  if (!Number.isInteger(workers) || workers < 1 || workers > 5) {
    throw new Error('Standard Bulk workers must be between 1 and 5');
  }
  let next = 0;
  let completed = 0;
  let failed = 0;
  const runWorker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      try { await execute(task); }
      catch { failed++; }
      finally {
        completed++;
        onProgress?.(completed, tasks.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, tasks.length) }, () => runWorker()));
  return { completed, failed };
}
