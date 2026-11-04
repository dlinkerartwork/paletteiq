import { env } from 'cloudflare:workers';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { imageBatches, projects, studioSettings } from '@/db/schema';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { userCredential } from '@/lib/credentials';
import { normalizeListing } from '@/lib/etsy-listing';
import { normalizeAiSeoReview } from '@/lib/seo-intelligence';

const fail = (error: string, status = 400) => Response.json({ error }, { status });
const secret = (key: string) => (env as unknown as Record<string, string | undefined>)[key];
const extractText = (result: any) => result.output?.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? '').join('') ?? '{}';

export async function GET(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return fail('Sign in required', 401);
  const projectId = new URL(req.url).searchParams.get('projectId');
  const filter = projectId ? and(eq(projects.owner, user.userId), eq(projects.id, projectId)) : eq(projects.owner, user.userId);
  const rows = await getDb().select().from(projects).where(filter).orderBy(desc(projects.updatedAt));
  return Response.json(rows.map(x => ({ id: x.id, name: x.name, data: JSON.parse(x.data) })));
}

export async function POST(req: Request) {
  const user = await getChatGPTUser();
  if (!user) return fail('Sign in required', 401);
  const body = await req.json() as Record<string, any>;
  if (body.action === 'save') {
    if (typeof body.id !== 'string' || !/^[\w-]{8,80}$/.test(body.id) || typeof body.name !== 'string' || !body.data) return fail('Invalid project');
    const incoming = body.data as Record<string, any>;
    if (incoming.id !== body.id || !Array.isArray(incoming.characters)) return fail('Invalid collection data');
    const db = getDb();
    const current = await db.select().from(projects).where(eq(projects.id, body.id)).limit(1);
    if (current.length && current[0].owner !== user.userId) return fail('Forbidden', 403);
    if (current.length) {
      // An older browser snapshot must not erase assets already persisted by the image worker.
      const old = JSON.parse(current[0].data) as { characters?: Array<{ id: string; imageUrl?: string; status?: string }> };
      const storedImages = new Map((old.characters || []).filter(c => c.imageUrl).map(c => [c.id, c]));
      incoming.characters = incoming.characters.map((c: any) => {
        const persisted = storedImages.get(c.id);
        return persisted?.imageUrl ? { ...c, imageUrl: persisted.imageUrl, status: 'done', error: '' } : c;
      });
    }
    const data = JSON.stringify(incoming);
    if (data.length > 700000) return fail('Project too large');
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
    if (!source.images.some(Boolean)) return fail('Etsy listing returned no reference images. Cannot build a visually grounded collection.', 422);
    const aiKey = await userCredential(user.userId, 'openai') || secret('OPENAI_API_KEY');
    if (!aiKey) return fail('OpenAI API not connected. Configure it in Settings to analyze images.', 503);
    const input = [{ role: 'user', content: [{ type: 'input_text', text: `Analyze this Etsy CLIPART listing primarily from the attached product images. Determine the actual subject matter, theme, subtheme, style, palette, texture and SEO keywords. Identify only individual recognizable clipart subjects supported by image evidence, with specific descriptive names and distinguishing visual details. Do not use generic default subjects (women, teddy bears, cats, etc.) unless the images truly contain them. Distinguish a collage/mockup from distinct clipart assets; avoid claiming off-image subjects as observed. Return JSON {"theme":"...","subtheme":"...","style":"...","palette":"...","texture":"...","keywords":["..."],"characters":[{"name":"specific visual subject","description":"visible distinctive visual details"}],"notes":"evidence and uncertainties"}. No copying designs or assuming unseen content. Source listing text (secondary evidence): ${JSON.stringify({ ...source, images: undefined }).slice(0,14000)}` }, ...source.images.slice(0,5).filter(Boolean).map((image_url: string) => ({ type: 'input_image', image_url }))] }];
    const ai = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4.1-mini', input, text: { format: { type: 'json_object' } } }) });
    if (!ai.ok) return fail(`OpenAI visual analysis failed (${ai.status}): ${(await ai.text()).slice(0,200)}`, 502);
    try { return Response.json({ source, analysis: JSON.parse(extractText(await ai.json())) }); } catch { return fail('Could not parse OpenAI visual analysis', 502); }
  }
  if (body.action === 'expand') {
    const aiKey = await userCredential(user.userId, 'openai') || secret('OPENAI_API_KEY');
    if (!aiKey) return fail('OpenAI API not connected.', 503);
    const count = Math.max(1, Math.min(20, Number(body.count) || 1));
    const images = Array.isArray(body.images) ? body.images.filter((url: unknown) => { try { const parsed = new URL(String(url)); return parsed.protocol === 'https:' && (parsed.hostname === 'etsystatic.com' || parsed.hostname.endsWith('.etsystatic.com')); } catch { return false; } }).slice(0, 3) as string[] : [];
    const existing = Array.isArray(body.existing) ? body.existing.map((s: unknown) => String(s).slice(0,120)).slice(-600) : [];
    const instruction = `Create EXACTLY ${count} NEW, visually distinct, original, specific clipart subjects compatible with the reference product IMAGES. The images and the detailed art direction are the main source of truth; do not suggest unrelated default characters like people, bears, or cats unless consistent with these references. Use fresh poses, compositions, variants, botanical or object subtypes as appropriate to the actual theme. Distinguish each character by descriptive name and 1-sentence visual details. They are NEW AI proposals, never claim they appeared in the listing. Respect the theme and visual language but never imitate reference artwork exactly. Avoid names or close semantic duplicates of the existing subjects. Return JSON {"characters":[{"name":"distinct subject name","description":"original specific visual traits"}]}. Theme: ${String(body.theme ?? '').slice(0,200)}; subtheme: ${String(body.subtheme ?? '').slice(0,200)}; style: ${String(body.style ?? '').slice(0,400)}; palette: ${String(body.palette ?? '').slice(0,300)}; texture: ${String(body.texture ?? '').slice(0,300)}; visual analysis notes: ${String(body.notes ?? '').slice(0,1800)}; existing subjects: ${JSON.stringify(existing).slice(0,22000)}`;
    const input = [{ role: 'user', content: [{ type: 'input_text', text: instruction }, ...images.map(image_url => ({ type: 'input_image', image_url }))] }];
    const ai = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4.1-mini', input, text: { format: { type: 'json_object' } } }) });
    if (!ai.ok) return fail(`AI expansion returned ${ai.status}`, 502);
    try { const result = JSON.parse(extractText(await ai.json())); const characters = Array.isArray(result.characters) ? result.characters.filter((c: any) => c && typeof c.name === 'string' && c.name.trim()).slice(0, count).map((c: any) => ({ name: c.name.trim().slice(0,160), description: String(c.description || '').slice(0,500) })) : []; return Response.json({ characters }); } catch { return fail('Invalid AI response', 502); }
  }
  if (body.action === 'generate-prompts') {
    const aiKey = await userCredential(user.userId, 'openai') || secret('OPENAI_API_KEY');
    if (!aiKey) return fail('Configure an OpenAI API key in Settings to generate prompts.', 503);
    const incoming = Array.isArray(body.characters) ? body.characters : [];
    if (!incoming.length || incoming.length > 10 || incoming.some((c: any) => typeof c.id !== 'string' || typeof c.name !== 'string' || !c.name.trim())) return fail('Select 1–10 valid characters per AI request.');
    const context = { theme: String(body.theme ?? '').slice(0, 200), subtheme: String(body.subtheme ?? '').slice(0, 200), style: String(body.style ?? '').slice(0, 500), palette: String(body.palette ?? '').slice(0, 300), texture: String(body.texture ?? '').slice(0, 300) };
    const characters = incoming.map((c: any) => ({ id: String(c.id).slice(0, 80), name: String(c.name).slice(0, 200), description: String(c.description ?? '').slice(0, 500), previousPrompt: String(c.prompt ?? '').slice(0, 1200) }));
    const requestText = `Write ONE original, detailed, production-ready English image-generation prompt per character. Return JSON {"prompts":[{"id":"exact given id","prompt":"..."}]}. Preserve each id exactly. Each prompt must be visually distinctive in pose/composition/character details while following the same art direction. Use the explicit character identity and description. Include hand-painted texture, palette, lighting, expressive details, isolated full subject centered on transparent background; no text, logo, watermark, sticker cutline, white border, exterior shadows, unrelated elements. The image must be a single clipart element ready for a coordinated bundle. Avoid copying any existing shop's character or proprietary artwork. If previousPrompt exists, regenerate with fresh unique subject-specific details. Never add unsupported trademarked characters. Style guide: ${JSON.stringify(context)}. Subjects: ${JSON.stringify(characters)}`;
    const ai = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4.1-mini', input: requestText, text: { format: { type: 'json_object' } } }) });
    if (!ai.ok) return fail(`OpenAI prompt generation failed (${ai.status}): ${(await ai.text()).slice(0, 200)}`, 502);
    try {
      const result = JSON.parse(extractText(await ai.json()));
      const allowed = new Set(characters.map((c: { id: string }) => c.id));
      const prompts = Array.isArray(result.prompts) ? result.prompts.filter((p: any) => allowed.has(p.id) && typeof p.prompt === 'string' && p.prompt.trim().length > 60).map((p: any) => ({ id: p.id, prompt: p.prompt.trim().slice(0, 8000) })) : [];
      if (new Set(prompts.map((p: { id: string }) => p.id)).size !== characters.length || prompts.length !== characters.length) return fail('AI returned incomplete prompts. Please retry this group.', 502);
      return Response.json({ prompts });
    } catch (error) { return fail(error instanceof Error && error.message.startsWith('AI returned') ? error.message : 'Invalid OpenAI prompt response', 502); }
  }
  if (body.action === 'listing-draft') {
    const aiKey = await userCredential(user.userId, 'openai') || secret('OPENAI_API_KEY');
    if (!aiKey) return fail('Configure your OpenAI API key in Settings.', 503);
    const project = body.project;
    if (!project || typeof project !== 'object' || typeof project.id !== 'string' || typeof project.name !== 'string' || !Array.isArray(project.characters)) return fail('Invalid collection');
    const subjects = project.characters.slice(0, 200).filter((c: any) => c && typeof c.name === 'string').map((c: any) => ({ name: String(c.name).slice(0, 100), produced: c.status === 'done' }));
    const produced = subjects.filter((c: { produced: boolean }) => c.produced).length;
    const brief = { name: String(project.name).slice(0, 150), theme: String(project.theme ?? '').slice(0, 150), subtheme: String(project.subtheme ?? '').slice(0, 150), style: String(project.style ?? '').slice(0, 200), palette: String(project.palette ?? '').slice(0, 200), texture: String(project.texture ?? '').slice(0, 200), keywords: Array.isArray(project.keywords) ? project.keywords.slice(0, 30) : [], subjects, produced, sourceReference: String(project.title ?? '').slice(0, 250) };
    const instruction = `You are preparing an original, accurate, English-language Etsy DIGITAL CLIPART listing draft. Return a single valid JSON object with precisely these keys: title (natural, clear, <=140 characters, ideally under 15 words), description (scannable, buyer-friendly opening, what's included, potential uses, download and licensing caveats), tags (13 distinct relevant phrases, each <=20 characters), primaryKeyword, secondaryKeywords (array), longTailKeywords (array), categorySuggestion (suggestion only, not taxonomy ID), attributes (object: occasion, recipient, primaryColor, secondaryColor, style), materials (array), imageAltTexts (array for original mockups), photoPlan (array), priceSuggestion (estimated range with currency and clearly marked estimate, not a market fact), sku, digitalFiles (array of proposed filenames/package contents), licenseNotes. Never copy the source listing's wording, SEO tags, or branding; create distinct original copy. Never invent concrete specs such as exact files, DPI, sizes, transparent backgrounds, licenses, or quantities as facts if unknown. Mark such details TO CONFIRM. Do not claim ${subjects.length} images are delivered when only ${produced} are produced. Etsy allows 13 tags of up to 20 characters. No unsupported demand, ranking, sales or ownership claims. Seller will verify before publishing. Collection brief: ${JSON.stringify(brief).slice(0, 21000)}`;
    const ai = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4.1-mini', input: instruction, text: { format: { type: 'json_object' } } }) });
    if (!ai.ok) return fail(`AI listing draft failed (${ai.status}): ${(await ai.text()).slice(0, 200)}`, 502);
    try { return Response.json({ draft: normalizeListing(JSON.parse(extractText(await ai.json()))) }); } catch { return fail('AI returned an invalid listing draft', 502); }
  }
  if (body.action === 'seo-review') {
    const aiKey = await userCredential(user.userId, 'openai') || secret('OPENAI_API_KEY');
    if (!aiKey) return fail('Configure your OpenAI API key in Settings.', 503);
    if (!body.draft || typeof body.draft !== 'object' || typeof body.projectId !== 'string') return fail('Invalid SEO review request');
    const saved = await getDb().select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.owner, user.userId))).limit(1);
    if (!saved.length) return fail('Save this collection before requesting SEO review.', 404);
    const project = JSON.parse(saved[0].data) as { name: string; theme?: string; subtheme?: string; characters?: Array<{ name: string }> };
    const draft = normalizeListing(body.draft);
    const prompt = `Review this ORIGINAL Etsy digital clipart listing draft as a cautious Etsy SEO editor. Offer practical, buyer-friendly suggestions based on relevant terms and product truth, NOT invented keyword search volume, market demand, competition ratings, Etsy search ranking, sales or performance claims. Never copy the source listing or claim access to Etsy Analytics. Return valid JSON with EXACT keys: summary (short editorial analysis), targetBuyers (array of plausible buyer audiences), keywordGaps (array of missing long-tail search phrases relevant to the actual subject), titleAlternatives (3 naturally phrased unique alternative titles <=140 characters, preferably <=15 words), suggestedTags (up to 13 distinct keyword tags, each <=20 characters), descriptionOpening (improved honest opening), risks (array of unverified claims, missing product details, potential keyword stuffing, vague wording). Avoid promises about file formats, quantities, license and DPI unless explicitly confirmed. Etsy tags must be unique phrases <=20 characters. Title should be clear and concise. Collection: ${JSON.stringify({ name: project.name, theme: project.theme, subtheme: project.subtheme, subjects: (project.characters || []).slice(0, 35).map(c => c.name) }).slice(0, 6000)}. Current draft: ${JSON.stringify(draft).slice(0, 16000)}`;
    const ai = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4.1-mini', input: prompt, text: { format: { type: 'json_object' } } }) });
    if (!ai.ok) return fail(`OpenAI SEO review failed (${ai.status}): ${(await ai.text()).slice(0, 180)}`, 502);
    try { return Response.json({ review: normalizeAiSeoReview(JSON.parse(extractText(await ai.json()))) }); } catch { return fail('Invalid AI SEO review response', 502); }
  }
  if (body.action === 'generate') {
    const aiKey = await userCredential(user.userId, 'openai') || secret('OPENAI_API_KEY');
    if (!aiKey) return fail('OpenAI API not connected.', 503);
    if (!['gpt-image-1-mini','gpt-image-1','gpt-image-1.5','gpt-image-2.5-flare','gpt-image-2.5-sunburst'].includes(body.model) || !['low','medium','high'].includes(body.quality) || typeof body.projectId !== 'string' || typeof body.characterId !== 'string') return fail('Invalid image settings');
    const db = getDb();
    const saved = await db.select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.owner, user.userId))).limit(1);
    if (!saved.length) return fail('Save the collection before generating images.', 404);
    const project = JSON.parse(saved[0].data) as { characters?: Array<{ id: string; prompt: string; status: string; imageUrl?: string; error?: string }> };
    const character = project.characters?.find(c => c.id === body.characterId);
    if (!character?.prompt || character.prompt.length > 8000) return fail('Character has no saved valid prompt.');
    const batchJobs = await db.select().from(imageBatches).where(and(eq(imageBatches.projectId, body.projectId), eq(imageBatches.owner, user.userId)));
    if (batchJobs.some(job => !['completed','completed_with_errors','failed','cancelled','expired'].includes(job.status) && (JSON.parse(job.items) as Array<{ id: string; status: string }>).some(item => item.id === character.id && item.status === 'pending'))) return fail('Character has an active Batch job. Wait for it to finish before regenerating.', 409);
    if (!env.BUCKET) return fail('Image storage is not provisioned', 503);
    const settings = await getDb().select().from(studioSettings).where(eq(studioSettings.owner, user.userId)).limit(1);
    const preferences = settings[0] ? JSON.parse(settings[0].preferences) as { output?: string; background?: string } : {};
    const format = preferences.output === 'jpg' ? 'jpeg' : 'png';
    const background = preferences.background === 'opaque' || format === 'jpeg' ? 'opaque' : 'transparent';
    const ai = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: body.model, quality: body.quality, size: '1024x1024', background, output_format: format, n: 1, prompt: character.prompt }) });
    if (!ai.ok) return fail(`OpenAI image generation failed (${ai.status}): ${(await ai.text()).slice(0,200)}`, 502);
    const data = await ai.json() as { data?: Array<{ b64_json?: string }> };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return fail('Image API returned no file', 502);
    const extension = format === 'jpeg' ? 'jpg' : 'png';
    const imageUrl = `/api/images/${character.id}?format=${extension}&v=${Date.now()}`;
    // A deterministic per-character object key allows recovery if DB persistence fails.
    await env.BUCKET.put(`generated/${user.userId}/${character.id}.${extension}`, Uint8Array.from(atob(b64), c => c.charCodeAt(0)), { httpMetadata: { contentType: format === 'jpeg' ? 'image/jpeg' : 'image/png' } });
    character.imageUrl = imageUrl; character.status = 'done'; character.error = '';
    try {
      await db.update(projects).set({ data: JSON.stringify(project), updatedAt: Date.now() }).where(and(eq(projects.id, body.projectId), eq(projects.owner, user.userId)));
    } catch {
      return fail('Image stored safely, but collection update failed. Use Recover images in Image Production; do not regenerate yet.', 503);
    }
    return Response.json({ imageUrl, persisted: true });
  }
  if (body.action === 'recover-images') {
    if (typeof body.projectId !== 'string' || !env.BUCKET) return fail('Invalid recovery request');
    const bucket = env.BUCKET;
    const db = getDb();
    const saved = await db.select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.owner, user.userId))).limit(1);
    if (!saved.length) return fail('Collection not found', 404);
    const project = JSON.parse(saved[0].data) as { characters?: Array<{ id: string; status: string; imageUrl?: string; error?: string }> };
    const recovered: Array<{ id: string; imageUrl: string; status: 'done'; error: string }> = [];
    for (const character of project.characters ?? []) {
      if (character.imageUrl || !/^[\w-]{8,80}$/.test(character.id)) continue;
      const candidates = await Promise.all(['png', 'jpg'].map(async extension => ({ extension, object: await bucket.head(`generated/${user.userId}/${character.id}.${extension}`) })));
      const latest = candidates.filter(c => c.object).sort((a, b) => (b.object!.uploaded?.getTime() || 0) - (a.object!.uploaded?.getTime() || 0))[0];
      if (!latest) continue;
      character.imageUrl = `/api/images/${character.id}?format=${latest.extension}&v=${latest.object?.uploaded?.getTime() || Date.now()}`;
      character.status = 'done'; character.error = '';
      recovered.push({ id: character.id, imageUrl: character.imageUrl, status: 'done', error: '' });
    }
    if (recovered.length) await db.update(projects).set({ data: JSON.stringify(project), updatedAt: Date.now() }).where(and(eq(projects.id, body.projectId), eq(projects.owner, user.userId)));
    return Response.json({ recovered });
  }
  return fail('Unknown action');
}
