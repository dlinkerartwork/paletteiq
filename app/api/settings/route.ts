import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { studioSettings } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { encryptCredential } from '@/lib/credentials';

const bad = (error: string, status = 400) => Response.json({ error }, { status });
const seoPromptFields = ["general","title","description","tags","primaryKeyword","secondaryKeywords","longTailKeywords","categorySuggestion","attributes","materials","imageAltTexts","photoPlan","priceSuggestion","sku","digitalFiles","licenseNotes"] as const;
const defaultSeoPrompts = Object.fromEntries(seoPromptFields.map(key => [key, '']));
const defaultPrefs = { target: 120, model: 'gpt-image-1-mini', quality: 'low', analysisModel: 'gpt-4.1-mini', output: 'png', background: 'transparent', variations: 1, defaultStyle: 'Soft hand-painted watercolor illustration', autoSave: false, seoPrompts: defaultSeoPrompts };
const allowedModels = ['gpt-image-1-mini', 'gpt-image-1', 'gpt-image-1.5', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  const rows = await getDb().select().from(studioSettings).where(eq(studioSettings.owner, user.userId)).limit(1);
  const row = rows[0];
  return Response.json({ preferences: { ...defaultPrefs, ...(row ? JSON.parse(row.preferences) : {}) }, credentials: { etsy: Boolean(row?.etsyCredential), openai: Boolean(row?.openaiCredential) } });
}

export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return bad('Sign in required', 401);
  const body = await req.json() as Record<string, unknown>;
  const db = getDb();
  const rows = await db.select().from(studioSettings).where(eq(studioSettings.owner, user.userId)).limit(1);
  const row = rows[0];
  const values = { owner: user.userId, preferences: row?.preferences || JSON.stringify(defaultPrefs), etsyCredential: row?.etsyCredential ?? null, openaiCredential: row?.openaiCredential ?? null, updatedAt: Date.now() };
  if (body.action === 'preferences') {
    const raw = body.preferences as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('Invalid preferences');
    const prefs = { ...defaultPrefs, ...raw };
    if (!Number.isInteger(prefs.target) || prefs.target < 1 || prefs.target > 1000 || !Number.isInteger(prefs.variations) || prefs.variations < 1 || prefs.variations > 8 || !allowedModels.includes(prefs.model) || !['low','medium','high'].includes(prefs.quality) || prefs.analysisModel !== 'gpt-4.1-mini' || !['png','jpg'].includes(prefs.output) || !['transparent','opaque'].includes(prefs.background) || (prefs.output === 'jpg' && prefs.background === 'transparent') || typeof prefs.defaultStyle !== 'string' || prefs.defaultStyle.length > 500 || typeof prefs.autoSave !== 'boolean') return bad('Invalid settings values');
    if (!prefs.seoPrompts || typeof prefs.seoPrompts !== 'object' || Array.isArray(prefs.seoPrompts) || Object.keys(prefs.seoPrompts).some(key => !seoPromptFields.includes(key as typeof seoPromptFields[number])) || seoPromptFields.some(key => typeof prefs.seoPrompts[key] !== 'string' || prefs.seoPrompts[key].length > 2000)) return bad('Invalid custom SEO prompts');
    values.preferences = JSON.stringify(prefs);
  } else if (body.action === 'credential') {
    if (!['etsy','openai'].includes(String(body.provider))) return bad('Invalid provider');
    const provider = body.provider as 'etsy' | 'openai';
    if (body.remove === true) {
      if (provider === 'etsy') values.etsyCredential = null; else values.openaiCredential = null;
    } else {
      const value = String(body.key || '').trim();
      if (value.length < 12 || value.length > 1000 || /\s/.test(value)) return bad('Invalid API key');
      const encrypted = await encryptCredential(value, user.userId);
      if (provider === 'etsy') values.etsyCredential = encrypted; else values.openaiCredential = encrypted;
    }
  } else return bad('Unknown action');
  await db.insert(studioSettings).values(values).onConflictDoUpdate({ target: studioSettings.owner, set: { preferences: values.preferences, etsyCredential: values.etsyCredential, openaiCredential: values.openaiCredential, updatedAt: Date.now() } });
  return Response.json({ ok: true, credentials: { etsy: Boolean(values.etsyCredential), openai: Boolean(values.openaiCredential) } });
}
