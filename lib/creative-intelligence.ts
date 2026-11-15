/**
 * Shared research-to-production vocabulary. Reference observations are evidence;
 * suggested subjects are new ideas, never claims about the source listing.
 */
export type ColorSignal = { name: string; hex?: string; role?: string };
export type ImageObservation = { imageIndex: number; role: string; subjects: string[]; colors: string[]; expressions: string[]; notes: string };
export type EmotionProfile = {
  titleCues: string[]; tagCues: string[]; observedExpressions: string[];
  dominantMood: string; ageCues: string[]; styleCues: string[]; expressionStyle: string;
  recommendedExpressions: string[]; guidance: string;
};
export type CreativeAnalysis = {
  theme: string; subtheme: string; microtheme: string; style: string; palette: string; texture: string;
  primaryKeyword: string; keywords: string[]; longTailKeywords: string[];
  dominantColors: ColorSignal[]; accentColors: ColorSignal[];
  mood: string; medium: string; lighting: string; composition: string; background: string;
  audience: string[]; useCases: string[]; visualMotifs: string[];
  observedSubjects: string[]; subjectFamilies: string[]; imageObservations: ImageObservation[];
  differentiators: string[]; seoIntent: string; notes: string; emotionProfile: EmotionProfile;
};
export type DiverseConcept = { name: string; description?: string; family?: string; expression?: string };

const clean = (value: unknown, max = 500): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
const strings = (value: unknown, max = 60) => Array.isArray(value)
  ? [...new Set(value.filter((x): x is string => typeof x === 'string').map(x => x.trim().slice(0, 150)).filter(Boolean))].slice(0, max)
  : [];
const colors = (value: unknown): ColorSignal[] => Array.isArray(value) ? value.slice(0, 14).flatMap((item): ColorSignal[] => {
  if (typeof item === 'string') return [{ name: clean(item, 80) }];
  if (!item || typeof item !== 'object') return [];
  const c = item as Record<string, unknown>;
  const name = clean(c.name, 80), hex = clean(c.hex, 7), role = clean(c.role, 80);
  if (!name) return [];
  return [{ name, ...( /^#[a-f0-9]{6}$/i.test(hex) ? { hex } : {}), ...(role ? { role } : {}) }];
}) : [];

export function normalizeCreativeAnalysis(input: unknown): CreativeAnalysis {
  const raw: Record<string, unknown> = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const observations = Array.isArray(raw.imageObservations) ? raw.imageObservations.slice(0, 30).flatMap((item): ImageObservation[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const imageIndex = Number(row.imageIndex);
    if (!Number.isInteger(imageIndex) || imageIndex < 1) return [];
    return [{ imageIndex, role: clean(row.role, 100), subjects: strings(row.subjects, 30), colors: strings(row.colors, 12), expressions: strings(row.expressions, 15), notes: clean(row.notes, 500) }];
  }) : [];
  return {
    theme: clean(raw.theme, 200), subtheme: clean(raw.subtheme, 200), microtheme: clean(raw.microtheme, 200),
    style: clean(raw.style, 500), palette: clean(raw.palette, 500), texture: clean(raw.texture, 500),
    primaryKeyword: clean(raw.primaryKeyword, 200), keywords: strings(raw.keywords, 80),
    longTailKeywords: strings(raw.longTailKeywords, 50), dominantColors: colors(raw.dominantColors), accentColors: colors(raw.accentColors),
    mood: clean(raw.mood), medium: clean(raw.medium), lighting: clean(raw.lighting),
    composition: clean(raw.composition), background: clean(raw.background),
    audience: strings(raw.audience, 25), useCases: strings(raw.useCases, 25),
    visualMotifs: strings(raw.visualMotifs, 50), observedSubjects: strings(raw.observedSubjects, 100),
    subjectFamilies: strings(raw.subjectFamilies, 60), imageObservations: observations,
    differentiators: strings(raw.differentiators, 30), seoIntent: clean(raw.seoIntent),
    notes: clean(raw.notes, 2400),
    emotionProfile: normalizeEmotionProfile(raw.emotionProfile),
  };
}


const emotionCues: Array<[RegExp, string]> = [
  [/\b(cute|adorable|kawaii|sweet)\b/i, 'cute'],
  [/\b(baby|babies|newborn|infant|toddler|little)\b/i, 'baby'],
  [/\b(happy|joyful|cheerful|smiling|smile)\b/i, 'happy'],
  [/\b(sad|unhappy|tearful|crying)\b/i, 'sad'],
  [/\b(angry|mad|furious|grumpy)\b/i, 'angry'],
  [/\b(sleepy|sleeping|dreamy|tired)\b/i, 'sleepy'],
  [/\b(surprised|shocked|astonished)\b/i, 'surprised'],
  [/\b(shy|bashful|timid)\b/i, 'shy'],
  [/\b(playful|silly|mischievous)\b/i, 'playful'],
  [/\b(calm|peaceful|serene)\b/i, 'calm'],
  [/\b(scared|afraid|frightened)\b/i, 'scared'],
];
export function extractEmotionCues(text: string): string[] {
  return emotionCues.filter(([pattern]) => pattern.test(text)).map(([, cue]) => cue);
}
const moodCues = new Set(['happy', 'sad', 'angry', 'sleepy', 'surprised', 'shy', 'playful', 'calm', 'scared']);
function normalizeEmotionProfile(value: unknown): EmotionProfile {
  const raw: Record<string, unknown> = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { titleCues: strings(raw.titleCues, 30), tagCues: strings(raw.tagCues, 30),
    observedExpressions: strings(raw.observedExpressions, 50),
    dominantMood: clean(raw.dominantMood, 200), ageCues: strings(raw.ageCues, 30), styleCues: strings(raw.styleCues, 30),
    expressionStyle: clean(raw.expressionStyle, 350),
    recommendedExpressions: strings(raw.recommendedExpressions, 30), guidance: clean(raw.guidance, 1200) };
}
/** Title intent has precedence for the requested mood; image evidence stays separate. */
export function mergeSourceEmotionProfile(analysis: CreativeAnalysis, title: string, tags: string[]): CreativeAnalysis {
  const titleCues = extractEmotionCues(title);
  const tagCues = extractEmotionCues(tags.join(' '));
  const explicitMood = titleCues.filter(x => moodCues.has(x));
  const tagMood = tagCues.filter(x => moodCues.has(x));
  const dominantMood = explicitMood.length ? explicitMood.join(' / ') :
    analysis.emotionProfile.dominantMood || (tagMood.length ? tagMood.join(' / ') : analysis.mood);
  const ageCues = [...new Set([...titleCues, ...tagCues].filter(x => x === 'baby').concat(analysis.emotionProfile.ageCues))];
  const styleCues = [...new Set([...titleCues, ...tagCues].filter(x => x === 'cute').concat(analysis.emotionProfile.styleCues))];
  return { ...analysis, emotionProfile: { ...analysis.emotionProfile, titleCues, tagCues,
    dominantMood, ageCues, styleCues } };
}
export function expressionDistribution(items: Array<{ expression?: string }>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const key = clean(item.expression, 120).toLowerCase() || 'unspecified';
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}

// Normalize livestock synonyms and plurals so "calf", "cow" and "cattle" share a quota.
const families: Array<[RegExp, string]> = [
  [/\b(cow|cows|calf|calves|bull|cattle|bovine)\b/i, 'cow'],
  [/\b(pig|pigs|piglet|piglets|swine)\b/i, 'pig'],
  [/\b(horse|horses|pony|ponies|foal|foals|mare)\b/i, 'horse'],
  [/\b(sheep|lamb|lambs|ewe|ewes)\b/i, 'sheep'],
  [/\b(goat|goats|kid goat)\b/i, 'goat'],
  [/\b(chicken|chickens|hen|hens|rooster|chick|chicks)\b/i, 'chicken'],
  [/\b(duck|ducks|duckling|ducklings)\b/i, 'duck'],
  [/\b(donkey|donkeys|mule|mules)\b/i, 'donkey'],
  [/\b(turkey|turkeys|poult|poults)\b/i, 'turkey'],
  [/\b(goose|geese|gosling|goslings)\b/i, 'goose'],
  [/\b(rabbit|rabbits|bunny|bunnies)\b/i, 'rabbit'],
  [/\b(cat|cats|kitten|kittens)\b/i, 'cat'],
  [/\b(dog|dogs|puppy|puppies)\b/i, 'dog'],
];
export function conceptFamily(family: unknown, name: unknown): string {
  const value = [clean(family, 120), clean(name, 160)].filter(Boolean).join(' ');
  for (const [pattern, group] of families) if (pattern.test(value)) return group;
  const explicit = clean(family, 120).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (explicit) return explicit.replace(/\b(?:family|group|category|clipart|elements|animals)\b/g, '').trim() || explicit;
  const words = clean(name, 160).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !/^(cute|baby|little|sweet|happy|pink|blue|green|red|gold|white|watercolor|vintage|retro|floral|adorable)$/.test(w));
  return words.slice(0, 2).join(' ') || 'other';
}
export function conceptSignature(name: string): string {
  return clean(name, 160).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
export function familyDistribution(items: Array<{ name: string; family?: string }>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const c of items) { const key = conceptFamily(c.family, c.name); result[key] = (result[key] || 0) + 1; }
  return result;
}
export function selectDiverseConcepts<T extends DiverseConcept>(
  proposals: T[], existing: Array<{ name: string; family?: string; expression?: string }>, target: number, limit: number,
): T[] {
  const current = familyDistribution(existing);
  const seen = new Set(existing.map(c => conceptSignature(c.name)));
  const emotions = expressionDistribution(existing);
  // A broad catalog should cover at least eight different subject families.
  // This caps repetition of the SAME species/category, not the number of poses.
  const perFamilyCap = Math.max(3, Math.ceil(Math.max(1, target) / 8));
  const ordered = [...proposals].sort((a, b) => {
    const familyGap = (current[conceptFamily(a.family, a.name)] || 0) - (current[conceptFamily(b.family, b.name)] || 0);
    return familyGap || (emotions[(a.expression || '').trim().toLowerCase() || 'unspecified'] || 0) -
      (emotions[(b.expression || '').trim().toLowerCase() || 'unspecified'] || 0);
  });
  const accepted: T[] = [];
  for (const candidate of ordered) {
    const name = clean(candidate.name, 160), signature = conceptSignature(name);
    if (!signature || seen.has(signature)) continue;
    const family = conceptFamily(candidate.family, name);
    if ((current[family] || 0) >= perFamilyCap) continue;
    accepted.push(candidate); seen.add(signature); current[family] = (current[family] || 0) + 1;
    const expression = clean(candidate.expression, 120).toLowerCase() || 'unspecified';
    emotions[expression] = (emotions[expression] || 0) + 1;
    if (accepted.length >= limit) break;
  }
  return accepted;
}
