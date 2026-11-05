// Temporary development-only simulator. Never writes to production tables or object storage.
export type MockScenario = 'success' | 'partial_failure' | 'quota_error';
export type MockJob = {
  id: string; projectId: string; model: string; createdAt: number; status: string;
  characterIds: string[]; total: number; completed: number; failed: number;
  imported: number; assets: Array<{ id: string; status: string; error?: string }>;
  scenario: MockScenario; warning?: string;
};

export const MOCK_STORAGE_KEY = 'paletteiq-development-mock-jobs-v1';
const DELAY_START = 2000;
const DELAY_COMPLETE = 10000;

export function advanceMockJob(job: MockJob, now: number): MockJob {
  if (!['pending', 'in_progress'].includes(job.status)) return job;
  const elapsed = now - job.createdAt;
  if (elapsed < DELAY_START) return { ...job, status: 'pending' };
  if (elapsed < DELAY_COMPLETE) return { ...job, status: 'in_progress' };
  if (job.scenario === 'quota_error') {
    const error = 'SIMULATED insufficient_quota: no OpenAI API call was made.';
    return { ...job, status: 'failed', completed: 0, failed: job.total, imported: job.total, warning: error, assets: job.characterIds.map(id => ({ id, status: 'error', error })) };
  }
  const failCount = job.scenario === 'partial_failure' ? Math.min(1, job.total) : 0;
  return {
    ...job, status: failCount ? 'completed_with_errors' : 'completed',
    completed: job.total - failCount, failed: failCount, imported: job.total,
    assets: job.characterIds.map((id, index) => index < failCount
      ? { id, status: 'error', error: 'SIMULATED output failure' }
      : { id, status: 'done' }),
  };
}

export function readMockJobs(storage: Pick<Storage, 'getItem'>, now = Date.now()): MockJob[] {
  try {
    const value = JSON.parse(storage.getItem(MOCK_STORAGE_KEY) || '[]') as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is MockJob =>
      !!item && typeof item === 'object' && typeof item.id === 'string' &&
      typeof item.projectId === 'string' && Array.isArray(item.characterIds) &&
      typeof item.createdAt === 'number' && typeof item.scenario === 'string'
    ).slice(-500).map(job => advanceMockJob(job, now));
  } catch { return []; }
}

export function writeMockJobs(storage: Pick<Storage, 'setItem'>, jobs: MockJob[]) {
  storage.setItem(MOCK_STORAGE_KEY, JSON.stringify(jobs.slice(-500)));
}

export function mockEligibleIds(
  characters: Array<{ id: string; prompt?: string; imageUrl?: string; status?: string }>,
  jobs: MockJob[],
  projectId: string,
): string[] {
  const alreadySimulated = new Set(jobs.filter(job => job.projectId === projectId).flatMap(job => job.characterIds));
  return characters.filter(c => !!c.prompt?.trim() && !c.imageUrl && c.status !== 'done' && c.status !== 'error' && !alreadySimulated.has(c.id)).map(c => c.id);
}
