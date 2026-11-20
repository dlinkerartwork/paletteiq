// Keep alt text useful and close to Etsy's configured 500-character maximum.
// Never pad with invented visual claims merely to satisfy the minimum.
export const MIN_SEO_ALT_LENGTH = 460;
export const MAX_SEO_ALT_LENGTH = 500;

export function normalizeSeoAlt(value: unknown): string {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_SEO_ALT_LENGTH) return clean;
  const prefix = clean.slice(0, MAX_SEO_ALT_LENGTH);
  const lastSpace = prefix.lastIndexOf(' ');
  return (lastSpace >= MIN_SEO_ALT_LENGTH ? prefix.slice(0, lastSpace) : prefix).trim();
}

export function hasTargetSeoAltLength(value: unknown): boolean {
  const text = normalizeSeoAlt(value);
  return text.length >= MIN_SEO_ALT_LENGTH && text.length <= MAX_SEO_ALT_LENGTH;
}
