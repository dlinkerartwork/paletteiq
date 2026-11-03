import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { projects, studioSettings } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { userCredential } from '@/lib/credentials';

const fail = (error: string, status = 400) => Response.json({ error }, { status });
const secret = (key: string) => (env as unknown as Record<string, string | undefined>)[key];
const extractText = (result: any) => result.output?.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? '').join('') ?? '{}';

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return fail('Sign in required', 401);
  const rows = await getDb().select().from(projects).where(eq(projects.owner, user.userId));
  return Response.json(rows.map(x => ({ id: x.id, name: x.name, data: JSON.parse(x.data) })));
}

export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return fail('Sign in required', 401);
  const body = await req.json() as Record<string, any>;
  if (body.action === 'save') {
    if (typeof body.id !== 'string' || !/^[\w-]{8,80}$/.test(body.id) || typeof body.name !== 'string' || !body.data) return fail('Invalid project');
    const data = JSON.stringify(body.data);
    if (data.length > 700000) return fail('Project too large');
    const db = getDb();
    const current = await db.select().from(projects).where(eq(projects.id, body.id)).limit(1);
    if (current.length && current[0].owner !== user.userId) return fail('Forbidden', 403);
    await db.insert(projects).values({ id: body.id, owner: user.userId, name: body.name.slice(0, 160), data, updatedAt: Date.now() }).onConflictDoUpdate({ target: projects.id, set: { name: body.name.slice(0, 160), data, updatedAt: Date.now() } });
    return Response.json({ ok: true });
  }
  if (body.action === 'analyze') {
    let url: URL;
    try { url = new URL(body.url); } catch { return fail('Invalid Etsy listing URL'); }
    if (url.protocol !== 'https:' || !['www.etsy.com','etsy.com'].includes(url.hostname)) return fail('Use an Etsy URL');
    const listingId = url.pathname.match(/^\/listing\/(\d+)/)?.[1];
    if (!listingId) return fail('Etsy listing ID not found');
    const key = await userCredential(user.userId, 'etsy') || secret('ETSY_API_KEY');
    if (!key) return fail('Etsy API not connected. Configure ETSY_API_KEY to analyze live listings.', 503);
    const listingRes = await fetch(`https://api.etsy.com/v3/application/listings/${listingId}?includes=Images`, { headers: { 'x-api-key': key } });
    if (!listingRes.ok) return fail(`Etsy API request failed (${listingRes.status}). Verify app permissions.`, 502);
    const listing = await listingRes.json() as Record<string, any>;
    const source = { title: listing.title ?? '', description: listing.description ?? '', tags: listing.tags ?? [], images: (listing.images ?? []).slice(0,5).map((x: any) => x.url_570xN ?? x.url_fullxfull) };
    const aiKey = await userCredential(user.userId, 'openai') || secret('OPENAI_API_KEY');
    if (!aiKey) return Response.json({ source, warning: 'OpenAI API not connected yet.' });
    const input = [{ role: 'user', content: [{ type: 'input_text', text: `For original clipart market research, identify theme, subtheme, style, palette, texture, SEO keywords, and only characters actually supported by listing evidence. Return JSON with keys theme, subtheme, style, palette, texture, keywords (array), characters (array of strings), notes. Never assert inferred characters as observed. Listing: ${JSON.stringify({ ...source, images: undefined }).slice(0,14000)}` }, ...source.images.slice(0,3).filter(Boolean).map((image_url: string) => ({ type: 'input_image', image_url }))] }];
    const ai = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4.1-mini', input, text: { format: { type: 'json_object' } } }) });
    if (!ai.ok) return Response.json({ source, warning: `AI analysis returned ${ai.status}` });
    try { return Response.json({ source, analysis: JSON.parse(extractText(await ai.json())) }); } catch { return Response.json({ source, warning: 'Could not parse AI analysis' }); }
  }
  if (body.action === 'expand') {
    const aiKey = await userCredential(user.userId, 'openai') || secret('OPENAI_API_KEY');
    if (!aiKey) return fail('OpenAI API not connected.', 503);
    const count = Math.max(1, Math.min(120, Number(body.count) || 1));
    const ai = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4.1-mini', input: `Suggest ${count} DISTINCT original marketable clipart subjects for theme ${String(body.theme).slice(0,200)}. Style: ${String(body.style).slice(0,300)}. Do not repeat: ${JSON.stringify(body.existing ?? []).slice(0,12000)}. Return JSON {"characters":[{"name":"...","description":"..."}]}. No copied proprietary designs.`, text: { format: { type: 'json_object' } } }) });
    if (!ai.ok) return fail(`AI expansion returned ${ai.status}`, 502);
    try { return Response.json(JSON.parse(extractText(await ai.json()))); } catch { return fail('Invalid AI response', 502); }
  }
  if (body.action === 'generate') {
    const aiKey = await userCredential(user.userId, 'openai') || secret('OPENAI_API_KEY');
    if (!aiKey) return fail('OpenAI API not connected.', 503);
    if (!['gpt-image-1-mini','gpt-image-1','gpt-image-1.5'].includes(body.model) || !['low','medium','high'].includes(body.quality) || typeof body.prompt !== 'string' || body.prompt.length > 8000) return fail('Invalid image settings');
    const settings = await getDb().select().from(studioSettings).where(eq(studioSettings.owner, user.userId)).limit(1);
    const preferences = settings[0] ? JSON.parse(settings[0].preferences) as { output?: string; background?: string } : {};
    const format = preferences.output === 'jpg' ? 'jpeg' : 'png';
    const background = preferences.background === 'opaque' || format === 'jpeg' ? 'opaque' : 'transparent';
    const ai = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: body.model, quality: body.quality, size: '1024x1024', background, output_format: format, n: 1, prompt: body.prompt }) });
    if (!ai.ok) return fail(`OpenAI image generation failed (${ai.status}): ${(await ai.text()).slice(0,200)}`, 502);
    const data = await ai.json() as { data?: Array<{ b64_json?: string }> };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return fail('Image API returned no file', 502);
    const id = crypto.randomUUID();
    if (!env.BUCKET) return fail('Image storage is not provisioned', 503);
    const extension = format === 'jpeg' ? 'jpg' : 'png';
    await env.BUCKET.put(`generated/${user.userId}/${id}.${extension}`, Uint8Array.from(atob(b64), c => c.charCodeAt(0)), { httpMetadata: { contentType: format === 'jpeg' ? 'image/jpeg' : 'image/png' } });
    return Response.json({ imageUrl: `/api/images/${id}?format=${extension}` });
  }
  return fail('Unknown action');
}
