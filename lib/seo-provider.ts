import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { studioSettings } from '@/db/schema';
import { userCredential, userGeminiKeys } from '@/lib/credentials';
import { isGeminiQuotaExhausted, isGeminiModelUnavailable } from '@/lib/gemini-keyring';

export type SeoGenerationPreferences = {
  seoProvider: 'openai' | 'gemini';
  seoGeminiModel: string;
  seoOpenaiModel: string;
  seoTitleMaxLength: number;
  seoAltTextCount: number;
  seoFileNaming: 'charactername_imagenumber';
};

const defaults: SeoGenerationPreferences = {
  seoProvider: 'openai', seoGeminiModel: 'gemini-flash-latest', seoOpenaiModel: 'gpt-4.1-mini', seoTitleMaxLength: 120,
  seoAltTextCount: 1, seoFileNaming: 'charactername_imagenumber',
};
const secret = (key: string) => (env as unknown as Record<string, string | undefined>)[key];

export async function seoPreferences(owner: string): Promise<SeoGenerationPreferences> {
  const rows = await getDb().select().from(studioSettings).where(eq(studioSettings.owner, owner)).limit(1);
  let stored: Record<string, unknown> = {};
  try { stored = rows[0]?.preferences ? JSON.parse(rows[0].preferences) : {}; } catch { /* Legacy defaults. */ }
  return {
    seoProvider: stored.seoProvider === 'gemini' ? 'gemini' : 'openai',
    seoOpenaiModel: typeof stored.seoOpenaiModel === 'string' && /^gpt-[a-z0-9.-]{1,80}$/.test(stored.seoOpenaiModel) ? stored.seoOpenaiModel : 'gpt-4.1-mini',
    seoGeminiModel: typeof stored.seoGeminiModel === 'string' && /^gemini-[a-z0-9.-]{1,80}$/.test(stored.seoGeminiModel) ? stored.seoGeminiModel : 'gemini-flash-latest',
    seoTitleMaxLength: typeof stored.seoTitleMaxLength === 'number' && Number.isInteger(stored.seoTitleMaxLength) && Number(stored.seoTitleMaxLength) >= 1 && Number(stored.seoTitleMaxLength) <= 140 ? Number(stored.seoTitleMaxLength) : defaults.seoTitleMaxLength,
    seoAltTextCount: 1,
    seoFileNaming: 'charactername_imagenumber',
  };
}

export async function generateSeoJson(owner: string, instruction: string, provider: 'openai' | 'gemini', modelChoice = 'gemini-flash-latest'): Promise<unknown> {
  if (provider === 'openai') {
    const key = await userCredential(owner, 'openai') || secret('OPENAI_API_KEY');
    if (!key) throw new Error('Configure your OpenAI API key in Settings before generating SEO.');
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: /^gpt-[a-z0-9.-]{1,80}$/.test(modelChoice) ? modelChoice : 'gpt-4.1-mini', input: instruction, text: { format: { type: 'json_object' } } }),
    });
    if (!response.ok) throw new Error(`OpenAI SEO generation failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    const data = await response.json() as { output?: Array<{ content?: Array<{ text?: string }> }> };
    const text = data.output?.flatMap(o => o.content ?? []).map(c => c.text ?? '').join('') || '';
    if (!text) throw new Error('OpenAI returned no SEO JSON content');
    return JSON.parse(text);
  }
  const keys = await userGeminiKeys(owner);
  if (!keys.length && secret('GEMINI_API_KEY')) keys.push(secret('GEMINI_API_KEY')!);
  if (!keys.length) throw new Error('Configure a Gemini API key in Settings before generating SEO.');
  const model = /^gemini-[a-z0-9.-]{1,80}$/.test(modelChoice) ? modelChoice : 'gemini-flash-latest';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: instruction }] }], generationConfig: { responseMimeType: 'application/json', ...(model.startsWith('gemini-2.5-') ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } });
  let exhausted = 0;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(45_000),
        method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: payload,
      });
      if (response.ok) {
        const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = data.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('') || '';
        if (!text) throw new Error('Gemini returned no SEO JSON content');
        return JSON.parse(text);
      }
      const detail = (await response.text()).slice(0, 500);
      let status = '';
      let message = detail;
      try { const parsed = JSON.parse(detail) as { error?: { status?: string; message?: string } }; status = parsed.error?.status || ''; message = parsed.error?.message || detail; } catch { /* Raw provider message. */ }
      if (isGeminiQuotaExhausted(response.status, status)) { exhausted++; break; }
      if (isGeminiModelUnavailable(response.status, message)) throw new Error(`Gemini model ${model} is unavailable for this account. Select a supported model in Settings or Etsy Listing Draft.`);
      if (response.status === 503 && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 650 * (attempt + 1)));
        continue;
      }
      throw new Error(`Gemini SEO generation failed (${response.status}): ${message.slice(0, 240)}`);
    }
  }
  if (exhausted === keys.length) throw new Error('All configured Gemini API keys have exhausted their quotas. Add or replenish a key in Settings, then retry.');
  throw new Error('Gemini SEO generation failed: no available API key');
}
