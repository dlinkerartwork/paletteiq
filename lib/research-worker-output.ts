/**
 * Parse completed OpenAI Research worker output without assuming that the
 * model always places its visual analysis at the JSON root.
 *
 * A group may legitimately contain visual evidence but no generated
 * character proposals. Keep that evidence for the cross-group Style DNA
 * synthesis; do not fabricate subjects or resend a paid worker.
 */
type JsonObject = Record<string, unknown>;
const asObject = (value: unknown): JsonObject | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
const nonEmptyText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';
const nestedKeys = ['analysis', 'research', 'visualAnalysis', 'creativeAnalysis', 'result', 'data', 'output'];

function candidateObjects(root: JsonObject): JsonObject[] {
  const result: JsonObject[] = [];
  const seen = new Set<JsonObject>();
  const visit = (value: JsonObject, depth: number) => {
    if (seen.has(value)) return;
    seen.add(value);
    result.push(value);
    if (depth === 0) return;
    for (const key of nestedKeys) {
      const nested = asObject(value[key]);
      if (nested) visit(nested, depth - 1);
    }
  };
  visit(root, 2);
  return result;
}

function validConcepts(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap((entry): JsonObject[] => {
    if (typeof entry === 'string') {
      const name = entry.trim().slice(0, 160);
      return name ? [{ name }] : [];
    }
    const object = asObject(entry);
    if (!object) return [];
    const name = nonEmptyText(object.name) ||
      nonEmptyText(object.subject) || nonEmptyText(object.title) || nonEmptyText(object.label);
    return name ? [{ ...object, name: name.slice(0, 160) }] : [];
  });
}

function meaningfulVisualEvidence(object: JsonObject): boolean {
  const observations = object.imageObservations;
  if (Array.isArray(observations) && observations.length > 0) return true;
  for (const key of ['styleDNA', 'visualReverseEngineering', 'characterDNA', 'emotionProfile']) {
    const data = asObject(object[key]);
    if (data && Object.values(data).some(value =>
      Boolean(nonEmptyText(value)) || (Array.isArray(value) && value.length > 0))) return true;
  }
  return ['style', 'palette', 'texture', 'composition', 'lighting', 'medium']
    .filter(key => nonEmptyText(object[key])).length >= 2;
}

export type ParsedResearchWorker = {
  resultText: string;
  conceptCount: number;
  warning?: string;
};

export function parseResearchWorkerOutput(
  rawText: string, sourceTitle: string,
): ParsedResearchWorker {
  let decoded: unknown;
  try { decoded = JSON.parse(rawText); }
  catch { throw Error('Worker response is not valid JSON. The saved OpenAI response ID can be inspected without a new submission.'); }
  if (typeof decoded === 'string') {
    try { decoded = JSON.parse(decoded); } catch { /* Report below. */ }
  }
  const root = asObject(decoded);
  if (!root) throw Error('Worker response is not a JSON research object.');
  const objects = candidateObjects(root);
  // Prefer the most complete nested research object over a wrapper that
  // happens to contain a title or an empty characters array.
  const scored = objects.map((object, index) => {
    const sourceKeys = ['characters', 'characterConcepts', 'concepts', 'subjects', 'observedSubjects'];
    let concepts: JsonObject[] = [];
    let from = '';
    for (const key of sourceKeys) {
      const entries = validConcepts(object[key]);
      if (entries.length > concepts.length) { concepts = entries; from = key; }
    }
    const evidence = meaningfulVisualEvidence(object);
    const theme = nonEmptyText(object.theme) || nonEmptyText(object.generalTheme);
    return { object, index, concepts, from, evidence, theme,
      score: concepts.length * 100 + (evidence ? 10 : 0) + (theme ? 1 : 0) };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const best = scored[0];
  if (!best || (!best.concepts.length && !best.evidence))
    throw Error('Worker returned no usable character concepts or visual observations. Keep the existing response ID; review its output before considering a new paid request.');
  const explicitTheme = best.theme || scored.find(item => item.theme)?.theme || '';
  const theme = explicitTheme || nonEmptyText(sourceTitle);
  if (!theme) throw Error('Worker omitted theme and the source listing has no title to identify the niche.');
  const warnings: string[] = [];
  if (!explicitTheme) warnings.push('Theme uses the source listing title (not a verified worker inference)');
  if (!best.concepts.length)
    warnings.push('Worker supplied visual evidence without character proposals; synthesis will use other groups');
  else if (best.from !== 'characters')
    warnings.push('Character concepts were recovered from ' + best.from);
  const normalized = {
    ...root,
    ...best.object,
    theme,
    characters: best.concepts,
  };
  const resultText = JSON.stringify(normalized);
  if (resultText.length > 160_000)
    throw Error('Research worker output is too large to store safely. Inspect the saved OpenAI response ID before retrying.');
  return {
    resultText,
    conceptCount: best.concepts.length,
    ...(warnings.length ? { warning: warnings.join('; ').slice(0, 240) } : {}),
  };
}
