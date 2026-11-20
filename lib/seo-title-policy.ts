/**
 * Etsy SEO title policy: a maximum of 140 characters, no word-count rule,
 * and no artwork/image quantity claims in the TITLE. Other numeric style,
 * event or year terms (3D, 2026, 4th birthday) remain untouched.
 */
export const ETSY_TITLE_MAX = 140;
export const ETSY_TITLE_IDEAL_MIN = 125;

/** Remove product-count claims without stripping valid style names or dates. */
export function removeClipartQuantity(title: string): string {
  let value = title.replace(/\s+/g, ' ').trim();
  // 120 Clipart, 125+ PNG Elements, 50 Watercolor Baby Farm Animals Clipart.
  value = value.replace(/\b(\d{1,5}(?:\s*[-–]\s*\d{1,5})?\s*\+?)\s+(?=(?:[\w-]+\s+){0,7}(?:clip\s?arts?|pngs?|images?|illustrations?|elements?|graphics?|files?|characters?)\b)/gi,
    (match, quantity: string) => {
      const parsed = Number(quantity.replace(/[^\d].*$/, ''));
      return parsed >= 2010 && parsed <= 2050 && /^\d{4}$/.test(quantity.trim()) ? match : '';
    });
  // Clipart bundle of 120; PNG images: 80; 100-piece printable clipart.
  value = value.replace(/\b(clip\s?arts?|pngs?|images?|illustrations?|graphics?|elements?|files?|characters?)\s*(bundle|set|pack|collection)?\s*(?:of|:|–|-)\s*\d{1,5}\+?\b/gi,
    (_match, noun: string, collection?: string) => [noun, collection].filter(Boolean).join(' '));
  value = value.replace(/\b(bundle|set|pack|collection)\s+of\s+\d{1,5}\+?\s*(?=clip\s?arts?|pngs?|images?|illustrations?|elements?|graphics?|files?|characters?)/gi, '$1 ');
  value = value.replace(/\b\d{1,5}\s*(?:pcs|pieces|items)\b(?=\s|$)/gi, '');
  // Omit empty separators caused by removed count phrases.
  return value.replace(/\s*([|,;–-])\s*(?=[|,;–-])/g, '$1 ')
    .replace(/^[\s|,;:–-]+|[\s|,;:–-]+$/g, '')
    .replace(/\s{2,}/g, ' ').trim();
}
export function clampEtsyTitle(title: string): string {
  const cleaned = removeClipartQuantity(title);
  if (cleaned.length <= ETSY_TITLE_MAX) return cleaned;
  const truncated = cleaned.slice(0, ETSY_TITLE_MAX);
  const atWord = truncated.replace(/\s+\S*$/, '').trim();
  return (atWord.length >= ETSY_TITLE_IDEAL_MIN ? atWord : truncated).trim();
}
export const isNearEtsyTitleLimit = (title: string) =>
  title.length >= ETSY_TITLE_IDEAL_MIN && title.length <= ETSY_TITLE_MAX;
