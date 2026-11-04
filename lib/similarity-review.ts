export type SimilarityReview = { status: 'clear' | 'needs_review' | 'unverified'; score?: number; reason: string; checkedAt: number };

/** Advisory visual review, not a copyright determination or mathematical similarity guarantee. */
export async function reviewImageSimilarity(apiKey: string, generatedBase64: string, mime: string, references: string[]): Promise<SimilarityReview> {
  const checkedAt = Date.now();
  const urls = references.filter(url => {
    try { const parsed = new URL(url); return parsed.protocol === 'https:' && (parsed.hostname === 'etsystatic.com' || parsed.hostname.endsWith('.etsystatic.com')); }
    catch { return false; }
  }).slice(0, 20);
  if (!urls.length) return { status: 'unverified', reason: 'No selected Etsy reference images available for comparison.', checkedAt };
  try {
    let worstScore = -1;
    let flagged = false;
    let reason = '';
    for (let offset = 0; offset < urls.length; offset += 5) {
      const group = urls.slice(offset, offset + 5);
      const input = [{ role: 'user', content: [
        { type: 'input_text', text: 'Compare IMAGE 1 (newly generated clipart) to each following SOURCE REFERENCE image. Judge visual duplication of concrete artistic expression, not the generic subject or shared watercolor style. Flag near-identical composition, pose, silhouette, arrangement of petals/features/props, distinctive details, and overall visual structure. Do not penalize merely using the same type of flower or animal. Return ONLY JSON {"similarityScore":0-100,"tooSimilar":boolean,"reason":"concise specific explanation"}. Score above 75 means potentially near-duplicate artistic expression. If uncertain, mark tooSimilar true for manual review. IMAGE 1 is generated; remaining images are references.' },
        { type: 'input_image', image_url: `data:${mime};base64,${generatedBase64}`, detail: 'low' },
        ...group.map(image_url => ({ type: 'input_image', image_url, detail: 'low' })),
      ] }];
      const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4.1-mini', input, text: { format: { type: 'json_object' } }, max_output_tokens: 250 }) });
      if (!response.ok) throw new Error(`Visual review unavailable (${response.status})`);
      const result = await response.json() as { output?: Array<{ content?: Array<{ text?: string }> }> };
      const raw = result.output?.flatMap(item => item.content || []).map(item => item.text || '').join('') || '{}';
      const parsed = JSON.parse(raw) as { similarityScore?: number; tooSimilar?: boolean; reason?: string };
      if (typeof parsed.similarityScore !== 'number' || !Number.isFinite(parsed.similarityScore) || typeof parsed.tooSimilar !== 'boolean') throw new Error('Incomplete visual comparison');
      const score = Math.max(0, Math.min(100, Math.round(parsed.similarityScore)));
      if (score > worstScore || (parsed.tooSimilar && !flagged)) { worstScore = score; reason = String(parsed.reason || 'AI visual comparison complete.').slice(0, 500); }
      flagged ||= parsed.tooSimilar || score >= 75;
    }
    return { status: flagged ? 'needs_review' : 'clear', score: worstScore, reason, checkedAt };
  } catch (error) { return { status: 'unverified', reason: `Similarity review unavailable: ${error instanceof Error ? error.message : 'unknown error'}`, checkedAt }; }
}
