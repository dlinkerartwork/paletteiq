import type { EtsyListingDraft } from './etsy-listing';

export type SeoAuditResult = { score: number; passed: number; total: number; checks: Array<{ id: string; label: string; passed: boolean; weight: number; fix: string }> };

// Editorial completeness only. This is NOT an Etsy ranking, traffic, or sales prediction.
export function auditSeo(draft: EtsyListingDraft): SeoAuditResult {
  const tags = draft.tags.map(t => t.trim()).filter(Boolean);
  const lower = (s: string) => s.trim().toLocaleLowerCase();
  const phrase = lower(draft.primaryKeyword);
  const checks = [
    { id: 'title', label: 'Descriptive listing title', passed: !!draft.title.trim(), weight: 10, fix: 'Describe the actual clipart product in the title.' },
    { id: 'title-length', label: 'Title within 140 characters', passed: !!draft.title && draft.title.length <= 140, weight: 10, fix: 'Keep the title at or below 140 characters.' },
    { id: 'title-clarity', label: 'Title is concise (15 words or fewer)', passed: !!draft.title && draft.title.trim().split(/\s+/).length <= 15, weight: 5, fix: 'Use a clear title with fewer repetitive phrases.' },
    { id: 'keyword', label: 'Primary keyword defined', passed: !!phrase, weight: 5, fix: 'Choose a precise buyer-facing primary keyword.' },
    { id: 'keyword-title', label: 'Primary keyword visible near title start', passed: !!phrase && lower(draft.title.slice(0, 75)).includes(phrase), weight: 10, fix: 'Consider placing the primary keyword early in the title if it reads naturally.' },
    { id: 'tags-count', label: 'All 13 Etsy tags used', passed: tags.length === 13, weight: 10, fix: 'Use up to 13 relevant, distinct Etsy search phrases.' },
    { id: 'tags-valid', label: 'Tags unique and within 20 characters', passed: tags.length > 0 && tags.every(t => t.length <= 20) && new Set(tags.map(lower)).size === tags.length, weight: 10, fix: 'Remove duplicate tags and shorten any tag above 20 characters.' },
    { id: 'description', label: 'Clear product description', passed: draft.description.trim().length >= 120, weight: 10, fix: 'Explain what buyers receive, ideal uses, and any important conditions.' },
    { id: 'description-keyword', label: 'Primary keyword in description opening', passed: !!phrase && lower(draft.description.slice(0, 250)).includes(phrase), weight: 5, fix: 'Mention the product and main search phrase naturally in the opening.' },
    { id: 'category', label: 'Category suggestion ready for verification', passed: !!draft.categorySuggestion.trim(), weight: 5, fix: 'Choose an accurate category inside Etsy when uploading.' },
    { id: 'attributes', label: 'Useful style and color attributes', passed: !!draft.attributes.style && !!draft.attributes.primaryColor, weight: 5, fix: 'Describe applicable visual style and primary color.' },
    { id: 'delivery', label: 'Digital file plan documented', passed: draft.digitalFiles.length > 0, weight: 5, fix: 'Confirm file formats, quantity, and digital delivery contents.' },
    { id: 'license', label: 'Usage/license terms documented', passed: !!draft.licenseNotes.trim(), weight: 5, fix: 'Document the actual license and allowed uses accurately.' },
    { id: 'photos', label: 'Listing imagery plan', passed: draft.photoPlan.length > 0, weight: 5, fix: 'Plan product photos/contact sheets that truthfully show the bundle.' },
  ];
  return { score: checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0), passed: checks.filter(c => c.passed).length, total: checks.length, checks };
}

export type AiSeoReview = {
  summary: string;
  targetBuyers: string[];
  keywordGaps: string[];
  titleAlternatives: string[];
  suggestedTags: string[];
  descriptionOpening: string;
  risks: string[];
};

const arr = (v: unknown, max: number, length = 160): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').map(s => s.trim().slice(0, length)).filter(Boolean).slice(0, max) : [];
export function normalizeAiSeoReview(v: unknown): AiSeoReview {
  const x = v && typeof v === 'object' ? v as Record<string, unknown> : {};
  return { summary: String(x.summary || '').slice(0, 1000), targetBuyers: arr(x.targetBuyers, 8), keywordGaps: arr(x.keywordGaps, 20), titleAlternatives: arr(x.titleAlternatives, 5, 140), suggestedTags: arr(x.suggestedTags, 13, 20), descriptionOpening: String(x.descriptionOpening || '').slice(0, 800), risks: arr(x.risks, 15, 260) };
}
