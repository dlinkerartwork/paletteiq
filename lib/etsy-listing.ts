export type EtsyListingDraft = {
  title: string;
  description: string;
  tags: string[];
  primaryKeyword: string;
  secondaryKeywords: string[];
  longTailKeywords: string[];
  categorySuggestion: string;
  attributes: { occasion: string; recipient: string; primaryColor: string; secondaryColor: string; style: string };
  materials: string[];
  imageAltTexts: string[];
  photoPlan: string[];
  priceSuggestion: string;
  sku: string;
  digitalFiles: string[];
  licenseNotes: string;
};

const strings = (value: unknown, cap: number) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean).slice(0, cap) : [];
const str = (value: unknown, cap = 500) => typeof value === 'string' ? value.trim().slice(0, cap) : '';

export function normalizeListing(value: unknown): EtsyListingDraft {
  const v = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const a = (v.attributes && typeof v.attributes === 'object' && !Array.isArray(v.attributes) ? v.attributes : {}) as Record<string, unknown>;
  const unique = new Set<string>();
  const tags = strings(v.tags, 40).map(t => t.replace(/[^\p{L}\p{N} '\-]/gu, '').replace(/^[ '\-]+/, '').slice(0, 20).trim()).filter(t => { const key = t.toLowerCase(); if (!t || unique.has(key)) return false; unique.add(key); return true; }).slice(0, 13);
  return {
    title: str(v.title, 140), description: str(v.description, 12000), tags,
    primaryKeyword: str(v.primaryKeyword), secondaryKeywords: strings(v.secondaryKeywords, 30), longTailKeywords: strings(v.longTailKeywords, 30),
    categorySuggestion: str(v.categorySuggestion),
    attributes: { occasion: str(a.occasion), recipient: str(a.recipient), primaryColor: str(a.primaryColor), secondaryColor: str(a.secondaryColor), style: str(a.style) },
    materials: strings(v.materials, 13), imageAltTexts: strings(v.imageAltTexts, 20), photoPlan: strings(v.photoPlan, 20),
    priceSuggestion: str(v.priceSuggestion, 100), sku: str(v.sku, 100), digitalFiles: strings(v.digitalFiles, 15), licenseNotes: str(v.licenseNotes, 1000),
  };
}

export function listingWarnings(draft: EtsyListingDraft, imageCount: number) {
  const warnings: string[] = [];
  if (!draft.title.trim()) warnings.push('Title masih kosong.');
  if (draft.title.length > 140) warnings.push('Title melebihi 140 karakter.');
  if (!draft.description.trim()) warnings.push('Description masih kosong.');
  if (draft.tags.length !== 13) warnings.push(`Isi 13 tags (sekarang ${draft.tags.length}).`);
  if (draft.tags.some(t => t.length > 20)) warnings.push('Tag melebihi 20 karakter.');
  if (!draft.categorySuggestion.trim()) warnings.push('Tentukan kategori Etsy.');
  if (!imageCount) warnings.push('Belum ada gambar produk untuk mockup listing.');
  warnings.push('Pastikan jumlah file, format, resolusi, lisensi, dan harga sesuai produk akhir sebelum dipublikasikan.');
  return warnings;
}

/**
 * Keep the generated listing and its primary search phrase consistent.
 * This is a deterministic fallback when the AI misses its opening-phrase instruction.
 */
export function ensurePrimaryKeywordOpening(draft: EtsyListingDraft): EtsyListingDraft {
  const keyword = draft.primaryKeyword.trim().replace(/\s+/g, ' ');
  if (!keyword || !draft.description.trim()) return draft;
  if (draft.description.slice(0, 250).toLocaleLowerCase().includes(keyword.toLocaleLowerCase())) return draft;
  const opening = `Explore this ${keyword} collection. `;
  return { ...draft, description: (opening + draft.description.trim()).slice(0, 12000) };
}

/** Apply saved Etsy SEO output limits after normalizing either AI provider's JSON. */
export function applySeoLimits(draft: EtsyListingDraft, maxTitleCharacters: number, altTextCount: number): EtsyListingDraft {
  const titleLimit = Math.min(140, Math.max(1, Math.trunc(maxTitleCharacters) || 120));
  const count = Math.min(20, Math.max(1, Math.trunc(altTextCount) || 10));
  const title = draft.title.length > titleLimit
    ? draft.title.slice(0, titleLimit).replace(/\s+\S*$/, '').trim() || draft.title.slice(0, titleLimit)
    : draft.title;
  return { ...draft, title, imageAltTexts: draft.imageAltTexts.slice(0, count).map(text => text.slice(0, 500).trim()) };
}

/** Prevent reference-listing URLs and quantities from leaking into our own Etsy draft. */
export function adaptReferenceSeoToCollection(title: string, description: string, imageCount: number) {
  const count = Math.max(0, Math.trunc(imageCount) || 0);
  const stripLinks = (value: string) => value
    .replace(/(?:https?:\/\/|www\.)[^\s<>()[\]{}]+/gi, '')
    .replace(/\b(?:[\w-]+\.)+(?:com|net|org|io|co|shop|store|me|ly)\/[^\s<>()[\]{}]*/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.!?:;])/g, '$1')
    .trim();
  const updateQuantities = (value: string) => value
    // Numeric quantity before the product unit: "50 PNG cliparts", "100+ images".
    .replace(/\b\d{1,6}(?:\s*[-–]\s*\d{1,6})?\s*\+?\s*(?=(?:(?:high[ -]res|digital|watercolor|transparent|printable|individual|unique)\s+){0,3}(?:clip\s?arts?|images?|pngs?|illustrations?|graphics?|designs?|elements?|files?)\b)/gi, String(count) + ' ')
    // Product unit before the quantity: "clipart bundle of 100", "images: 100".
    .replace(/\b(clip\s?arts?|images?|pngs?|illustrations?|graphics?|designs?|elements?|files?)\s*(?:bundle|set|pack)?\s*(?:of|:|–|-)\s*\d{1,6}\+?/gi, (_match, unit: string) => `${unit}: ${count}`)
    .replace(/\b(?:set|pack|bundle|collection)\s+of\s+\d{1,6}\+?\s+(?=clip\s?arts?|images?|pngs?|illustrations?|graphics?|designs?|elements?|files?)/gi, `set of ${count} `);
  return { title: stripLinks(updateQuantities(title)), description: stripLinks(updateQuantities(description)) };
}
