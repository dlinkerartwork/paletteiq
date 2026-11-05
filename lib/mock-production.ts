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

const SCENARIOS: MockScenario[] = ['success', 'partial_failure', 'quota_error'];
const STATES = ['pending', 'in_progress', 'completed', 'completed_with_errors', 'failed'];

export function isValidMockJob(item: unknown): item is MockJob {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const job = item as Partial<MockJob>;
  return typeof job.id === 'string' && job.id.length > 0 &&
    typeof job.projectId === 'string' && job.projectId.length > 0 &&
    typeof job.model === 'string' &&
    typeof job.createdAt === 'number' && Number.isSafeInteger(job.createdAt) && job.createdAt > 0 &&
    typeof job.status === 'string' && STATES.includes(job.status) &&
    SCENARIOS.includes(job.scenario as MockScenario) &&
    Array.isArray(job.characterIds) && job.characterIds.length > 0 && job.characterIds.length <= 120 &&
    job.characterIds.every(id => typeof id === 'string' && id.length > 0) &&
    new Set(job.characterIds).size === job.characterIds.length &&
    Number.isSafeInteger(job.total) && job.total === job.characterIds.length &&
    Number.isSafeInteger(job.completed) && job.completed! >= 0 &&
    Number.isSafeInteger(job.failed) && job.failed! >= 0 &&
    job.completed! + job.failed! <= job.total! &&
    Number.isSafeInteger(job.imported) && job.imported! >= 0 && job.imported! <= job.total! &&
    Array.isArray(job.assets) && job.assets.every(asset =>
      !!asset && typeof asset.id === 'string' && ['done', 'error'].includes(asset.status));
}

export function inspectMockStorage(storage: Pick<Storage, 'getItem'>, now = Date.now()): { jobs: MockJob[]; warning?: string } {
  try {
    const raw = storage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return { jobs: [] };
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return { jobs: [], warning: 'TEST history format is invalid. Clear TEST history to restart.' };
    const valid = value.filter(isValidMockJob);
    const warning = valid.length !== value.length
      ? 'Some TEST history entries are invalid. Existing data was left unchanged; Clear TEST history to restart.'
      : undefined;
    const unique = new Map(valid.map(job => [job.id, job]));
    const jobs = [...unique.values()].slice(-500).map(job => advanceMockJob(job, now));
    return { jobs, warning: warning || (unique.size !== valid.length ? 'Duplicate TEST job IDs detected; Clear TEST history to restart.' : undefined) };
  } catch {
    return { jobs: [], warning: 'TEST history could not be read. Existing storage was left unchanged.' };
  }
}

export function readMockJobs(storage: Pick<Storage, 'getItem'>, now = Date.now()): MockJob[] {
  return inspectMockStorage(storage, now).jobs;
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
