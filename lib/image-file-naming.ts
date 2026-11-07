export const DEFAULT_IMAGE_NAMING = 'generaltheme_imagenumber';

// A filename template controls ZIP labels only; image objects keep their stable IDs.
const allowed = new Set(['theme', 'collection', 'character', 'number', 'charactername', 'generaltheme', 'subtheme', 'microtheme', 'imagenumber']);
export function validImageNaming(pattern: unknown): pattern is string {
  if (typeof pattern !== 'string' || !pattern.trim() || pattern.length > 120) return false;
  if (pattern === DEFAULT_IMAGE_NAMING) return true;
  const tokens = [...pattern.matchAll(/\{([^{}]*)\}/g)].map(match => match[1]);
  if (tokens.some(token => !allowed.has(token))) return false;
  const withoutTokens = pattern.replace(/\{[^{}]*\}/g, '');
  return !/[{}\\/<>:"|?*\x00-\x1f]/.test(withoutTokens) && /^[\p{L}\p{N}_ .-]*$/u.test(withoutTokens);
}

const safe = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'image';

export function createImageFileNamer(pattern: string, context: { theme: string; collection: string; subtheme?: string; microtheme?: string }) {
  const naming = validImageNaming(pattern) ? pattern : DEFAULT_IMAGE_NAMING;
  const used = new Set<string>();
  return (character: string, index: number, extension: 'png' | 'jpg'): string => {
    const values: Record<string, string> = {
      theme: safe(context.theme), collection: safe(context.collection),
      subtheme: safe(context.subtheme || context.theme),
      microtheme: safe(context.microtheme || context.collection),
      character: safe(character), number: String(index + 1).padStart(3, '0'),
    };
    values.generaltheme = values.theme;
    values.charactername = values.character;
    values.imagenumber = values.number;
    const raw = naming === DEFAULT_IMAGE_NAMING
      ? `${values.theme}_${values.number}`
      : naming
          .replace(/(^|[_. -])(charactername|generaltheme|subtheme|microtheme|imagenumber)(?=$|[_. -])/gi, (_, prefix: string, token: string) => prefix + values[token.toLowerCase()])
          .replace(/\{(theme|collection|character|number|charactername|generaltheme|subtheme|microtheme|imagenumber)\}/gi, (_, token: string) => values[token.toLowerCase()]);
    const base = safe(raw).slice(0, 100).replace(/_+$/g, '') || 'image';
    let result = base;
    for (let suffix = 2; used.has(`${result}.${extension}`); suffix++) {
      result = `${base.slice(0, 90)}_${suffix}`;
    }
    used.add(`${result}.${extension}`);
    return `${result}.${extension}`;
  };
}
