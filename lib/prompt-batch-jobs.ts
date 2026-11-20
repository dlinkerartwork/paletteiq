import { normalizeCreativeAnalysis, normalizeCreativeControls, type CreativeAnalysis, type CreativeControls } from './creative-intelligence.ts';
import { productionPromptInstruction } from './creative-research-prompts.ts';

export type PromptTarget = {
  id: string; name: string; family?: string; expression?: string;
  description?: string; shape?: string; silhouette?: string; accessories?: string; colorPlan?: string; prompt?: string; status?: string; imageUrl?: string;
};
export type PromptBatchItem = {
  id: string; originalFingerprint: string;
  status: 'pending' | 'done' | 'error' | 'skipped'; error?: string;
};
export type PromptBatchGroup = { key: string; ids: string[] };
export type ProgressivePromptGroup = {
  key: string; status: 'planned'|'submitting'|'queued'|'in_progress'|'completed'|'failed'|'uncertain';
  responseId?: string; // Standard Responses API; historical Batch IDs remain readable.
  batchId?: string; startedAt?: number; error?: string;
};
export type PromptBatchJob = {
  id: string; status: string; batchId?: string; model: string;
  mode?: 'batch'|'progressive'|'standard'; progressiveBatches?: ProgressivePromptGroup[];
  progressiveJsonl?: string; // Immutable paid request inputs, never rebuilt from edited characters.
  createdAt: number; updatedAt: number; total: number; imported: number;
  failed: number; processedGroups: number; totalGroups: number;
  groups: PromptBatchGroup[]; items: PromptBatchItem[];
  regenerate: boolean; error?: string;
};
export type PromptProject = {
  id: string; name: string; title?: string; theme?: string; subtheme?: string;
  microtheme?: string; style?: string; palette?: string; texture?: string;
  primaryKeyword?: string; keywords?: string[]; longTailKeywords?: string[];
  notes?: string; emotionDirection?: string; ageDirection?: string;
  cutenessDirection?: string; research?: CreativeAnalysis; creativeControls?: CreativeControls;
  characters: PromptTarget[]; promptJob?: PromptBatchJob;
  [key: string]: unknown;
};

export const isActivePromptBatch = (job?: PromptBatchJob): boolean =>
  !!job && !['completed', 'completed_with_errors', 'failed', 'cancelled', 'expired'].includes(job.status);

// Stable non-cryptographic fingerprint for optimistic editing conflicts only.
// This is NOT a security token or proof of content authenticity.
export function promptFingerprint(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return value.length + ':' + (hash >>> 0).toString(16);
}

export function projectPromptContext(p: PromptProject): CreativeAnalysis {
  const a = normalizeCreativeAnalysis(p.research);
  return { ...a, theme: p.theme || a.theme, subtheme: p.subtheme || a.subtheme,
    microtheme: p.microtheme || a.microtheme, style: p.style || a.style,
    palette: p.palette || a.palette, texture: p.texture || a.texture,
    primaryKeyword: p.primaryKeyword || a.primaryKeyword, keywords: p.keywords || a.keywords,
    longTailKeywords: p.longTailKeywords || a.longTailKeywords, notes: p.notes || a.notes,
    creativeControls: normalizeCreativeControls(p.creativeControls ?? a.creativeControls),
    emotionProfile: {
      ...a.emotionProfile,
      dominantMood: p.emotionDirection === undefined ? a.emotionProfile.dominantMood : p.emotionDirection,
      ageCues: p.ageDirection === undefined ? a.emotionProfile.ageCues : [p.ageDirection].filter(Boolean),
      styleCues: p.cutenessDirection === undefined ? a.emotionProfile.styleCues : [p.cutenessDirection].filter(Boolean),
    } };
}

export function buildPromptBatchInput(p: PromptProject, selected: PromptTarget[], model: string) {
  const context = projectPromptContext(p);
  const groups: PromptBatchGroup[] = [];
  const lines: string[] = [];
  for (let index = 0; index < selected.length; index += 10) {
    const subset = selected.slice(index, index + 10);
    const key = 'prompt-group-' + Math.floor(index / 10);
    groups.push({ key, ids: subset.map(c => c.id) });
    const instruction = productionPromptInstruction({
      title: p.title || p.name, analysis: context,
      characters: subset.map(c => ({
        id: c.id, name: c.name, family: c.family, expression: c.expression,
        description: c.description, shape: c.shape, silhouette: c.silhouette,
        accessories: c.accessories, colorPlan: c.colorPlan, previousPrompt: c.prompt?.slice(0, 1200),
      })),
    });
    lines.push(JSON.stringify({
      custom_id: key, method: 'POST', url: '/v1/responses',
      body: { model, input: [{ role: 'user', content: [{ type: 'input_text', text: instruction }] }],
        text: { format: { type: 'json_object' } },
        max_output_tokens: 8000 },
    }));
  }
  return { jsonl: lines.join('\n') + '\n', groups };
}

export type PromptBatchOutput = { prompts: Map<string, string>; errors: Map<string, string> };
type BatchLine = {
  custom_id?: string; error?: { message?: string };
  response?: { status_code?: number; body?: {
    output?: Array<{ content?: Array<{ text?: string }> }>;
    error?: { message?: string };
  } };
};

/** Match each OpenAI result to its original group and ID; reject extras/duplicates. */
export function parsePromptBatchOutput(jsonl: string, groups: PromptBatchGroup[]): PromptBatchOutput {
  const prompts = new Map<string, string>(), errors = new Map<string, string>();
  const groupsByKey = new Map(groups.map(g => [g.key, g]));
  const seenGroups = new Set<string>();
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let record: BatchLine;
    try { record = JSON.parse(line) as BatchLine; } catch { continue; }
    const group = groupsByKey.get(record.custom_id || '');
    if (!group || seenGroups.has(group.key)) continue;
    seenGroups.add(group.key);
    const result = record.response?.body;
    const text = result?.output?.flatMap(o => o.content ?? []).map(c => c.text || '').join('') || '';
    let decoded: { prompts?: Array<{ id: string; prompt: string }> } | null = null;
    try { decoded = JSON.parse(text) as { prompts?: Array<{ id: string; prompt: string }> }; } catch { /* See errors below. */ }
    const expected = new Set(group.ids);
    const found = new Set<string>();
    for (const item of Array.isArray(decoded?.prompts) ? decoded.prompts : []) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !expected.has(item.id) || found.has(item.id)) continue;
      found.add(item.id);
      if (typeof item.prompt === 'string' && item.prompt.trim().length > 60) prompts.set(item.id, item.prompt.trim().slice(0, 6000));
      else errors.set(item.id, 'OpenAI returned an empty or too-short image prompt.');
    }
    for (const id of group.ids) if (!prompts.has(id) && !errors.has(id)) {
      errors.set(id, String(record.error?.message || result?.error?.message ||
        'Missing or invalid prompt in the Batch response.').slice(0, 240));
    }
  }
  return { prompts, errors };
}
