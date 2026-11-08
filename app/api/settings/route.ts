import { validImageNaming } from '@/lib/image-file-naming';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { studioSettings } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { encryptCredential, decryptCredential, userCredential, userGeminiKeys } from '@/lib/credentials';
import { env } from 'cloudflare:workers';
import { parseGeminiKeyring, serializeGeminiKeyring } from '@/lib/gemini-keyring';

const bad = (error: string, status = 400) => Response.json({ error }, { status });
const seoPromptFields = ["general","title","description","tags","primaryKeyword","secondaryKeywords","longTailKeywords","categorySuggestion","attributes","materials","imageAltTexts","photoPlan","priceSuggestion","sku","digitalFiles","licenseNotes"] as const;
const defaultSeoPrompts = Object.fromEntries(seoPromptFields.map(key => [key, '']));
const defaultPrefs = { target: 120, model: 'gpt-image-1-mini', quality: 'low', analysisModel: 'gpt-4.1-mini', output: 'png', background: 'transparent', variations: 1, defaultStyle: 'Soft hand-painted watercolor illustration', autoSave: false, seoProvider: 'openai', seoGeminiModel: 'gemini-2.5-pro', seoOpenaiModel: 'gpt-6.1-terra', seoDraftFields: ['title','description','tags','imageAltTexts'], seoTitleMaxLength: 120, seoAltTextCount: 1, seoFileNaming: 'charactername_imagenumber', seoPrompts: defaultSeoPrompts, upscaleProvider: 'remote', upscaleFactor: 4, upscaleRequireTransparency: true, upscaleQc: true, upscaleModel: 'realesrgan-x4plus', upscaleCleanup: false, upscaleCleanupStrength: 'low' };
const isImageModel = (value: unknown): value is string => typeof value === 'string' && /^gpt-image-[a-z0-9.-]{1,80}$/.test(value);

async function getSettings(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  if (new URL(req.url).searchParams.get('models') === 'openai' || new URL(req.url).searchParams.get('models') === 'openai-seo') {
    const key = await userCredential(user.userId, 'openai') || (env as unknown as Record<string, string | undefined>).OPENAI_API_KEY;
    if (!key) return bad('Save an OpenAI API key first.', 400);
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return bad(`Unable to list OpenAI models (HTTP ${response.status}).`, 502);
    const payload = await response.json() as { data?: Array<{ id?: string }> };
    if (new URL(req.url).searchParams.get('models') === 'openai-seo') {
      const preferred = ['gpt-6.1-terra','gpt-6.1-sol','gpt-6-astra','gpt-6-luna','gpt-5.6','gpt-5.2','gpt-5','gpt-4.1'];
      return Response.json({ models: (payload.data || [])
        .filter(row => typeof row.id === 'string' && /^gpt-[a-z0-9.-]{1,80}$/.test(row.id) && !/(image|audio|realtime|transcribe|tts|search|codex|mini|nano|micro|lite|instruct)/i.test(row.id))
        .map(row => ({ id: row.id!, name: row.id! }))
        .sort((a, b) => { const ai = preferred.indexOf(a.id); const bi = preferred.indexOf(b.id); return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || b.id.localeCompare(a.id, undefined, { numeric: true }); }).slice(0, 6) });
    }
    // The models endpoint returns IDs, not transparency capability flags.
    // Limit options to the GPT Image family; the image API validates capabilities on use.
    return Response.json({ models: (payload.data || []).filter(row => isImageModel(row.id))
      .map(row => ({ id: row.id!, name: row.id!, batchSupported: ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].includes(row.id!) })).sort((left, right) => left.id.localeCompare(right.id)) });
  }
    if (new URL(req.url).searchParams.get('models') === 'gemini') {
    const keys = await userGeminiKeys(user.userId);
    if (!keys.length) return bad('Save a Gemini API key first.', 400);
    let response: Response | undefined;
    for (const key of keys) {
      response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
        headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) break;
      if (![401, 403, 429].includes(response.status)) break;
    }
    if (!response?.ok) return bad(`Unable to list Gemini models (HTTP ${response?.status ?? 'unknown'}).`, 502);
    const data = await response.json() as { models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }> };
    const models = (data.models || []).filter(item => item.supportedGenerationMethods?.includes('generateContent'))
      .map(item => ({ id: (item.name || '').replace(/^models\//, ''), name: item.displayName || item.name || '' }))
      .filter(item => /^gemini-(?:(?:\d+(?:\.\d+)?)-)?(?:pro|flash)(?:-|$)/.test(item.id)
        && !/(?:flash-lite|image|imagen|banana|veo|video|tts|speech|audio|live|robot|argon|embedding|experimental|research|computer)/i.test(item.id + ' ' + item.name));
    // Newer Gemini families (3.5, 3.6, 3.7, …) take precedence over older versions.
    const version = (id: string) => Number(id.match(/^gemini-(\d+(?:\.\d+)?)-/)?.[1] || 0);
    return Response.json({ models: models.sort((a, b) => version(b.id) - version(a.id)
      || Number(b.id.includes('-pro')) - Number(a.id.includes('-pro'))
      || a.id.localeCompare(b.id)).slice(0, 6) });
  }
  const rows = await getDb().select().from(studioSettings).where(eq(studioSettings.owner, user.userId)).limit(1);
  const row = rows[0];
  return Response.json({ preferences: { ...defaultPrefs, ...(row ? JSON.parse(row.preferences) : {}), upscaleProvider: 'remote' }, credentials: { etsy: Boolean(row?.etsyCredential), openai: Boolean(row?.openaiCredential), gemini: Boolean(row?.geminiCredential), upscale: Boolean(row?.upscaleCredential) }, geminiKeyCount: (await userGeminiKeys(user.userId)).length });
}

async function postSettings(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  const body = await req.json() as Record<string, unknown>;
  const db = getDb();
  const rows = await db.select().from(studioSettings).where(eq(studioSettings.owner, user.userId)).limit(1);
  const row = rows[0];
  const values = { owner: user.userId, preferences: row?.preferences || JSON.stringify(defaultPrefs), etsyCredential: row?.etsyCredential ?? null, openaiCredential: row?.openaiCredential ?? null, geminiCredential: row?.geminiCredential ?? null, upscaleCredential: row?.upscaleCredential ?? null, updatedAt: Date.now() };
  if (body.action === 'gemini-key-add' || body.action === 'gemini-key-remove') {
    const previous = row?.geminiCredential ? parseGeminiKeyring(await decryptCredential(row.geminiCredential, user.userId)) : [];
    let next = previous;
    if (body.action === 'gemini-key-add') {
      const value = typeof body.key === 'string' ? body.key.trim() : '';
      if (value.length < 12 || value.length > 1000 || /\\s/.test(value)) return bad('Invalid Gemini API key');
      if (previous.length >= 10 && !previous.includes(value)) return bad('Maximum 10 Gemini keys');
      next = [...new Set([...previous, value])];
    } else {
      if (!Number.isInteger(body.index) || Number(body.index) < 0 || Number(body.index) >= previous.length) return bad('Invalid Gemini key index');
      next = previous.filter((_, index) => index !== body.index);
    }
    values.geminiCredential = next.length ? await encryptCredential(serializeGeminiKeyring(next), user.userId) : null;
    await db.insert(studioSettings).values(values).onConflictDoUpdate({ target: studioSettings.owner, set: { geminiCredential: values.geminiCredential, updatedAt: Date.now() } });
    return Response.json({ ok: true, credentials: { etsy: Boolean(values.etsyCredential), openai: Boolean(values.openaiCredential), gemini: Boolean(values.geminiCredential), upscale: Boolean(values.upscaleCredential) }, geminiKeyCount: next.length });
  }
  if (body.action === 'preferences') {
    const raw = body.preferences as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('Invalid preferences');
    const prefs = { ...defaultPrefs, ...raw, upscaleProvider: 'remote' };
    if (!Number.isInteger(prefs.target) || prefs.target < 1 || prefs.target > 1000 || !Number.isInteger(prefs.variations) || prefs.variations < 1 || prefs.variations > 8 || !isImageModel(prefs.model) || !['low','medium','high'].includes(prefs.quality) || prefs.analysisModel !== 'gpt-4.1-mini' || !['png','jpg'].includes(prefs.output) || !['transparent','opaque'].includes(prefs.background) || (prefs.output === 'jpg' && prefs.background === 'transparent') || typeof prefs.defaultStyle !== 'string' || prefs.defaultStyle.length > 500 || typeof prefs.autoSave !== 'boolean' || !['openai','gemini'].includes(prefs.seoProvider) || typeof prefs.seoGeminiModel !== 'string' || !/^gemini-[a-z0-9.-]{1,80}$/.test(prefs.seoGeminiModel) || typeof prefs.seoOpenaiModel !== 'string' || !/^gpt-[a-z0-9.-]{1,80}$/.test(prefs.seoOpenaiModel) || !Number.isInteger(prefs.seoTitleMaxLength) || prefs.seoTitleMaxLength < 1 || prefs.seoTitleMaxLength > 140 || !Number.isInteger(prefs.seoAltTextCount) || prefs.seoAltTextCount < 1 || prefs.seoAltTextCount > 20 || !validImageNaming(prefs.seoFileNaming) || prefs.upscaleProvider !== 'remote' || ![2,4].includes(prefs.upscaleFactor) || typeof prefs.upscaleRequireTransparency !== 'boolean' || typeof prefs.upscaleQc !== 'boolean' || !['realesrgan-x4plus','realesrgan-x4plus-anime','realesrnet-x4plus','realesr-animevideov3','real-hat-gan-sharper-x4'].includes(prefs.upscaleModel) || (prefs.upscaleModel === 'real-hat-gan-sharper-x4' && prefs.upscaleFactor !== 4) || typeof prefs.upscaleCleanup !== 'boolean' || !['low','medium','high'].includes(prefs.upscaleCleanupStrength)) return bad('Invalid settings values');
    if (!Array.isArray(prefs.seoDraftFields) || prefs.seoDraftFields.some((field: unknown) => !['title','description','tags','imageAltTexts','primaryKeyword','secondaryKeywords','longTailKeywords','categorySuggestion','attributes','materials','photoPlan','priceSuggestion','sku','digitalFiles','licenseNotes'].includes(String(field))) || new Set(prefs.seoDraftFields).size !== prefs.seoDraftFields.length) return bad('Invalid SEO draft field selection');
    if (!prefs.seoPrompts || typeof prefs.seoPrompts !== 'object' || Array.isArray(prefs.seoPrompts) || Object.keys(prefs.seoPrompts).some(key => !seoPromptFields.includes(key as typeof seoPromptFields[number])) || seoPromptFields.some(key => typeof prefs.seoPrompts[key] !== 'string' || prefs.seoPrompts[key].length > 2000)) return bad('Invalid custom SEO prompts');
    values.preferences = JSON.stringify(prefs);
  } else if (body.action === 'upscale-credential') {
    if (body.remove === true) values.upscaleCredential = null;
    else {
      const value = typeof body.key === 'string' ? body.key.trim() : '';
      if (value.length < 32 || value.length > 1000 || /\s/.test(value)) return bad('GPU Server API key must be 32–1000 characters with no spaces');
      values.upscaleCredential = await encryptCredential(value, user.userId);
    }
  } else if (body.action === 'credential') {
    if (!['etsy','openai','gemini'].includes(String(body.provider))) return bad('Invalid provider');
    const provider = body.provider as 'etsy' | 'openai' | 'gemini';
    if (body.remove === true) {
      if (provider === 'etsy') values.etsyCredential = null; else if (provider === 'gemini') values.geminiCredential = null; else values.openaiCredential = null;
    } else {
      const value = String(body.key || '').trim();
      if (value.length < 12 || value.length > 1000 || /\s/.test(value)) return bad('Invalid API key');
      const encrypted = await encryptCredential(value, user.userId);
      if (provider === 'etsy') values.etsyCredential = encrypted; else if (provider === 'gemini') values.geminiCredential = encrypted; else values.openaiCredential = encrypted;
    }
  } else return bad('Unknown action');
  await db.insert(studioSettings).values(values).onConflictDoUpdate({ target: studioSettings.owner, set: { preferences: values.preferences, etsyCredential: values.etsyCredential, openaiCredential: values.openaiCredential, geminiCredential: values.geminiCredential, upscaleCredential: values.upscaleCredential, updatedAt: Date.now() } });
  return Response.json({ ok: true, credentials: { etsy: Boolean(values.etsyCredential), openai: Boolean(values.openaiCredential), gemini: Boolean(values.geminiCredential), upscale: Boolean(values.upscaleCredential) }, geminiKeyCount: parseGeminiKeyring(values.geminiCredential ? await decryptCredential(values.geminiCredential, user.userId) : null).length });
}

function settingsError(error: unknown): Response {
  console.error('Settings request failed:', error);
  const detail = error instanceof Error ? error.message : String(error);
  if (/gemini_credential|no such column/i.test(detail)) {
    return bad('Database migration is required: apply drizzle/0003_gemini_seo.sql to the active database, then retry.', 503);
  }
  return bad('Settings could not be saved. Check the server logs for details.', 500);
}

export async function GET(req: Request) {
  try { return await getSettings(req); } catch (error) { return settingsError(error); }
}

export async function POST(req: Request) {
  try { return await postSettings(req); } catch (error) { return settingsError(error); }
}

