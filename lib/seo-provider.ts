import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { studioSettings } from '@/db/schema';
import { userCredential } from '@/lib/credentials';

export type SeoGenerationPreferences = {
  seoProvider: 'openai' | 'gemini';
  seoGeminiModel: string;
  seoTitleMaxLength: number;
  seoAltTextCount: number;
  seoFileNaming: 'generaltheme_imagenumber';
};

const defaults: SeoGenerationPreferences = {
  seoProvider: 'openai', seoGeminiModel: 'gemini-flash-latest', seoTitleMaxLength: 120,
  seoAltTextCount: 10, seoFileNaming: 'generaltheme_imagenumber',
};
const secret = (key: string) => (env as unknown as Record<string, string | undefined>)[key];

export async function seoPreferences(owner: string): Promise<SeoGenerationPreferences> {
  const rows = await getDb().select().from(studioSettings).where(eq(studioSettings.owner, owner)).limit(1);
  let stored: Record<string, unknown> = {};
  try { stored = rows[0]?.preferences ? JSON.parse(rows[0].preferences) : {}; } catch { /* Legacy defaults. */ }
  return {
    seoProvider: stored.seoProvider === 'gemini' ? 'gemini' : 'openai',
    seoGeminiModel: typeof stored.seoGeminiModel === 'string' && /^gemini-[a-z0-9.-]{1,80}$/.test(stored.seoGeminiModel) ? stored.seoGeminiModel : 'gemini-flash-latest',
    seoTitleMaxLength: typeof stored.seoTitleMaxLength === 'number' && Number.isInteger(stored.seoTitleMaxLength) && Number(stored.seoTitleMaxLength) >= 1 && Number(stored.seoTitleMaxLength) <= 140 ? Number(stored.seoTitleMaxLength) : defaults.seoTitleMaxLength,
    seoAltTextCount: typeof stored.seoAltTextCount === 'number' && Number.isInteger(stored.seoAltTextCount) && Number(stored.seoAltTextCount) >= 1 && Number(stored.seoAltTextCount) <= 20 ? Number(stored.seoAltTextCount) : defaults.seoAltTextCount,
    seoFileNaming: 'generaltheme_imagenumber',
  };
}

export async function generateSeoJson(owner: string, instruction: string, provider: 'openai' | 'gemini', geminiModel = 'gemini-flash-latest'): Promise<unknown> {
  if (provider === 'openai') {
    const key = await userCredential(owner, 'openai') || secret('OPENAI_API_KEY');
    if (!key) throw new Error('Configure your OpenAI API key in Settings before generating SEO.');
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4.1-mini', input: instruction, text: { format: { type: 'json_object' } } }),
    });
    if (!response.ok) throw new Error(`OpenAI SEO generation failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    const data = await response.json() as { output?: Array<{ content?: Array<{ text?: string }> }> };
    const text = data.output?.flatMap(o => o.content ?? []).map(c => c.text ?? '').join('') || '';
    if (!text) throw new Error('OpenAI returned no SEO JSON content');
    return JSON.parse(text);
  }
  const key = await userCredential(owner, 'gemini') || secret('GEMINI_API_KEY');
  if (!key) throw new Error('Configure your Gemini API key in Settings before generating SEO.');
  const model = /^gemini-[a-z0-9.-]{1,80}$/.test(geminiModel) ? geminiModel : 'gemini-flash-latest';
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      signal: AbortSignal.timeout(90_000),
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: instruction }] }], generationConfig: { responseMimeType: 'application/json', ...(model.startsWith('gemini-2.5-') ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } }),
    });
    if (![429, 503].includes(response.status) || attempt === 2) break;
    await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
  }
  if (!response) throw new Error('Gemini did not respond');
  if (!response.ok) throw new Error(`Gemini SEO generation failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') || '';
  if (!text) throw new Error('Gemini returned no SEO JSON content');
  return JSON.parse(text);
}
