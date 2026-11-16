import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { userCredential } from '@/lib/credentials';
import { mergeSourceEmotionProfile, normalizeCreativeAnalysis, selectDiverseConcepts } from '@/lib/creative-intelligence';
import { researchAnalysisInstruction } from '@/lib/creative-research-prompts';

type Concept = { name: string; family?: string; expression?: string; description?: string };
type StoredCharacter = { id: string; name: string; family?: string; expression?: string; description?: string; status?: string; prompt?: string; origin?: string; imageUrl?: string };
type Source = { title: string; description: string; tags: string[]; images: string[] };
type ResearchJob = {
  id: string; status: 'submitting' | 'queued' | 'in_progress' | 'completed' | 'failed';
  model: string; responseId?: string; createdAt: number; updatedAt: number;
  target: number; requested: number; completedCount: number;
  selectedImages: string[]; source: Source; error?: string;
};
type Collection = {
  id: string; name: string; url?: string; title?: string; images?: string[];
  selectedImageUrls?: string[]; sourceDescription?: string; sourceTags?: string[];
  characters: StoredCharacter[]; researchJob?: ResearchJob;
  [key: string]: unknown;
};
type ApiResponse = { id?: string; status?: string; output?: Array<{ content?: Array<{ text?: string }> }>; error?: { message?: string }; incomplete_details?: { reason?: string } };
const bad = (error: string, status = 400) => Response.json({ error }, { status });
const getSecret = (name: string) => (env as unknown as Record<string, string | undefined>)[name];
const safeJob = (job: ResearchJob) => ({
  id: job.id, status: job.status, target: job.target, requested: job.requested,
  completedCount: job.completedCount, model: job.model, createdAt: job.createdAt,
  updatedAt: job.updatedAt, error: job.error,
});
const active = (job?: ResearchJob) => job && ['submitting', 'queued', 'in_progress'].includes(job.status);
const openai = (key: string, path: string, init?: RequestInit) => fetch('https://api.openai.com/v1/' + path, {
  ...init,
  headers: { Authorization: 'Bearer ' + key, ...(init?.headers || {}) },
});
const extractText = (response: ApiResponse) =>
  response.output?.flatMap(item => item.content ?? []).map(item => item.text || '').join('') || '';
const listingId = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['www.etsy.com', 'etsy.com'].includes(url.hostname)) return null;
    return url.pathname.match(/^\/listing\/(\d+)/)?.[1] || null;
  } catch { return null; }
};
const validImage = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'etsystatic.com' || url.hostname.endsWith('.etsystatic.com'));
  } catch { return false; }
};

async function getCollection(owner: string, projectId: string) {
  if (!/^[\w-]{8,80}$/.test(projectId)) throw new Error('Invalid collection id');
  const rows = await getDb().select().from(projects).where(and(eq(projects.id, projectId), eq(projects.owner, owner))).limit(1);
  return rows[0] ? { row: rows[0], data: JSON.parse(rows[0].data) as Collection } : null;
}
async function persistJob(owner: string, projectId: string, jobId: string, update: Partial<ResearchJob>) {
  const saved = await getCollection(owner, projectId);
  if (!saved || saved.data.researchJob?.id !== jobId) return null;
  const job = { ...saved.data.researchJob, ...update, updatedAt: Date.now() };
  const data = { ...saved.data, researchJob: job };
  await getDb().update(projects).set({ data: JSON.stringify(data), updatedAt: Date.now() })
    .where(and(eq(projects.id, projectId), eq(projects.owner, owner)));
  return job;
}
function normalizedProposals(value: unknown): Concept[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const raw = value as { characters?: unknown };
  if (!Array.isArray(raw.characters)) return [];
  return raw.characters.slice(0, 200).flatMap((item): Concept[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const char = item as Record<string, unknown>;
    if (typeof char.name !== 'string' || !char.name.trim()) return [];
    return [{
      name: char.name.trim().slice(0, 160),
      family: typeof char.family === 'string' ? char.family.slice(0, 120) : '',
      expression: typeof char.expression === 'string' ? char.expression.slice(0, 160) : '',
      description: typeof char.description === 'string' ? char.description.slice(0, 500) : '',
    }];
  });
}
async function finish(owner: string, projectId: string, job: ResearchJob, response: ApiResponse) {
  const saved = await getCollection(owner, projectId);
  if (!saved || saved.data.researchJob?.id !== job.id) return bad('Research run was superseded or deleted', 409);
  if (saved.data.researchJob.status === 'completed') return Response.json({ job: safeJob(saved.data.researchJob), project: saved.data });
  let parsed: unknown;
  try { parsed = JSON.parse(extractText(response)); }
  catch {
    const failed = await persistJob(owner, projectId, job.id, { status: 'failed', error: 'Background research returned invalid JSON. Review API output and retry explicitly.' });
    return Response.json({ job: failed && safeJob(failed) });
  }
  const source = job.source;
  const research = mergeSourceEmotionProfile(normalizeCreativeAnalysis(parsed), source.title, source.tags);
  const candidates = normalizedProposals(parsed);
  if (!research.theme || !candidates.length) {
    const failed = await persistJob(owner, projectId, job.id, { status: 'failed', error: 'AI response did not contain a theme and character concepts. Retry explicitly.' });
    return Response.json({ job: failed && safeJob(failed) });
  }
  const previous = saved.data.characters || [];
  const uniquePrevious = [...new Map(previous.filter(c => c.name).map(c => [c.name.trim().toLowerCase(), c])).values()];
  const needed = Math.max(0, job.target - uniquePrevious.length);
  const selected = selectDiverseConcepts(candidates, uniquePrevious, job.target, needed);
  const characters: StoredCharacter[] = [
    ...uniquePrevious,
    ...selected.map(c => ({ id: crypto.randomUUID(), name: c.name, family: c.family,
      expression: c.expression, description: c.description || '', origin: 'ai',
      prompt: '', status: 'draft' })),
  ];
  const updatedJob: ResearchJob = { ...job, status: 'completed', completedCount: characters.length, updatedAt: Date.now() };
  // Merge the current stored record, not the user's stale browser snapshot. This
  // keeps independently saved images/upscale records and manual character edits intact.
  const updated: Collection = {
    ...saved.data, researchJob: updatedJob, url: saved.data.url,
    title: source.title, name: saved.data.name === 'Untitled collection' ? source.title : saved.data.name,
    images: source.images, selectedImageUrls: job.selectedImages,
    sourceDescription: source.description, sourceTags: source.tags,
    theme: research.theme, subtheme: research.subtheme, microtheme: research.microtheme,
    primaryKeyword: research.primaryKeyword, longTailKeywords: research.longTailKeywords,
    emotionDirection: research.emotionProfile.dominantMood,
    ageDirection: research.emotionProfile.ageCues.join(', '),
    cutenessDirection: research.emotionProfile.styleCues.join(', '),
    style: research.style || saved.data.style, palette: research.palette || saved.data.palette,
    texture: research.texture || saved.data.texture,
    keywords: research.keywords.length ? research.keywords : source.tags,
    notes: research.notes, research, characters,
  };
  await getDb().update(projects).set({ name: updated.name.slice(0, 160), data: JSON.stringify(updated), updatedAt: Date.now() })
    .where(and(eq(projects.id, projectId), eq(projects.owner, owner)));
  return Response.json({ job: safeJob(updatedJob), project: updated });
}

export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  let body: { projectId?: string; url?: string; selectedImages?: unknown[]; target?: number; model?: string };
  try { body = await req.json(); } catch { return bad('Invalid JSON'); }
  const projectId = String(body.projectId || '');
  const saved = await getCollection(user.userId, projectId).catch(() => null);
  if (!saved) return bad('Save your collection first, then start background research.', 404);
  if (active(saved.data.researchJob)) return Response.json({ job: safeJob(saved.data.researchJob!) }, { status: 409 });
  const url = String(body.url || '');
  const id = listingId(url);
  if (!id || saved.data.url !== url) return bad('Saved collection must contain the same valid Etsy reference URL');
  const model = String(body.model || 'gpt-4.1-mini');
  if (!/^gpt-[a-z0-9.-]{1,80}$/.test(model)) return bad('Choose a valid OpenAI vision model');
  const target = Number(body.target);
  if (!Number.isInteger(target) || target < 1 || target > 1000) return bad('Target must be between 1 and 1000');
  const requested = Math.min(target, 160); // Above 160, finish the remaining subjects with AI Fill.
  const etsyKey = await userCredential(user.userId, 'etsy') || getSecret('ETSY_API_KEY');
  const aiKey = await userCredential(user.userId, 'openai') || getSecret('OPENAI_API_KEY');
  if (!etsyKey || !aiKey) return bad('Connect Etsy API and OpenAI API in Settings before starting research.', 503);
  const listingRes = await fetch(`https://api.etsy.com/v3/application/listings/${id}?includes=Images`, { headers: { 'x-api-key': etsyKey } });
  if (!listingRes.ok) return bad(`Could not load Etsy listing (HTTP ${listingRes.status})`, 502);
  const listing = await listingRes.json() as { title?: string; description?: string; tags?: string[]; images?: Array<{ url_fullxfull?: string; url_570xN?: string }> };
  const source: Source = {
    title: String(listing.title || '').slice(0, 350),
    description: String(listing.description || '').slice(0, 9000),
    tags: Array.isArray(listing.tags) ? listing.tags.filter(t => typeof t === 'string').slice(0, 40) : [],
    images: Array.isArray(listing.images) ? [...new Set(listing.images.map(im => String(im.url_fullxfull || im.url_570xN || '')).filter(validImage))] : [],
  };
  const candidates = Array.isArray(body.selectedImages) ? body.selectedImages.filter((v): v is string => typeof v === 'string') : [];
  const allowed = new Set(source.images);
  const selectedImages = [...new Set(candidates.filter(value => allowed.has(value)))].slice(0, 24);
  if (!selectedImages.length) return bad('Select at least one actual Etsy listing image');
  const now = Date.now();
  const job: ResearchJob = { id: crypto.randomUUID(), status: 'submitting', model, target, requested,
    createdAt: now, updatedAt: now, completedCount: saved.data.characters?.length || 0,
    selectedImages, source };
  // Claim the collection before the paid API call. Reject concurrent tabs using
  // the saved row version, so duplicate submissions cannot quietly incur charges.
  const updated = { ...saved.data, researchJob: job };
  const claim = await getDb().update(projects)
    .set({ data: JSON.stringify(updated), updatedAt: Math.max(now, saved.row.updatedAt + 1) })
    .where(and(eq(projects.id, projectId), eq(projects.owner, user.userId), eq(projects.updatedAt, saved.row.updatedAt)))
    .returning({ id: projects.id });
  if (!claim.length) return bad('Collection changed in another tab. Refresh and retry before paying for analysis.', 409);
  try {
    const instruction = researchAnalysisInstruction(source, selectedImages.length, requested);
    const input = [{ role: 'user', content: [
      { type: 'input_text', text: instruction },
      ...selectedImages.map(image_url => ({ type: 'input_image', image_url })),
    ] }];
    const ai = await openai(aiKey, 'responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, input, background: true, store: true,
        text: { format: { type: 'json_object' } },
        max_output_tokens: Math.min(30000, 3200 + requested * 190),
      }),
    });
    if (!ai.ok) throw new Error('OpenAI background research failed to start (HTTP ' + ai.status + '): ' + (await ai.text()).slice(0, 260));
    const response = await ai.json() as ApiResponse;
    if (!response.id || !/^resp_[\w-]+$/.test(response.id)) throw new Error('OpenAI did not provide a resumable background response ID.');
    const savedJob = await persistJob(user.userId, projectId, job.id, {
      status: response.status === 'in_progress' ? 'in_progress' : 'queued',
      responseId: response.id,
    });
    return Response.json({ job: safeJob(savedJob || { ...job, status: 'queued' }) }, { status: 202 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await persistJob(user.userId, projectId, job.id, { status: 'failed', error: msg.slice(0, 500) });
    return bad(msg.slice(0, 500), 502);
  }
}

export async function GET(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  const projectId = new URL(req.url).searchParams.get('projectId') || '';
  const saved = await getCollection(user.userId, projectId).catch(() => null);
  if (!saved) return bad('Collection not found', 404);
  const job = saved.data.researchJob;
  if (!job) return Response.json({ job: null });
  if (job.status === 'completed') return Response.json({ job: safeJob(job), project: saved.data });
  if (job.status === 'failed') return Response.json({ job: safeJob(job) });
  if (!job.responseId) {
    if (job.status === 'submitting' && Date.now() - job.createdAt > 120_000) {
      const failed = await persistJob(user.userId, projectId, job.id, { status: 'failed',
        error: 'The server was interrupted during background submission, before its tracking ID was saved. Check OpenAI usage before explicitly retrying to avoid duplicate charges.' });
      return Response.json({ job: safeJob(failed || job) });
    }
    return Response.json({ job: safeJob(job) });
  }
  const key = await userCredential(user.userId, 'openai') || getSecret('OPENAI_API_KEY');
  if (!key) return bad('OpenAI API key is needed to retrieve the saved background response.', 503);
  const ai = await openai(key, 'responses/' + encodeURIComponent(job.responseId));
  if (!ai.ok) return bad('Cannot check background research (HTTP ' + ai.status + '): ' + (await ai.text()).slice(0, 200), 502);
  const response = await ai.json() as ApiResponse;
  if (response.status === 'completed') return finish(user.userId, projectId, job, response);
  if (['failed', 'cancelled', 'incomplete'].includes(String(response.status))) {
    const failed = await persistJob(user.userId, projectId, job.id, { status: 'failed',
      error: (response.error?.message || response.incomplete_details?.reason || 'Background response did not complete').slice(0, 400) });
    return Response.json({ job: safeJob(failed || job) });
  }
  const status = response.status === 'in_progress' ? 'in_progress' : 'queued';
  return Response.json({ job: safeJob({ ...job, status }) });
}
