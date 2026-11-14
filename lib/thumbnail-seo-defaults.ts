/**
 * Etsy Listing Draft stores a title and a primary keyword, but no subtitle field.
 * For new thumbnail canvases, choose a readable cover title from the SEO title
 * and derive the subtitle from its primary keyword/category. Never invent specs.
 */
export type ThumbnailSeoSource = {
  title?: string; primaryKeyword?: string; categorySuggestion?: string;
};
const tidy = (value?: string) => (value || '').replace(/\s+/g, ' ').trim();
const fit = (text: string, max: number) => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s,;|/&-]+$/, '').trim();
  return cut || text.slice(0, max);
};
export function thumbnailSeoDefaults(listing: ThumbnailSeoSource | undefined, fallbackTitle: string) {
  const raw = tidy(listing?.title);
  const seoCoverTitle = raw.split(/\s*[|•]\s*|\s*,\s*/).find(Boolean) || raw;
  const title = fit(seoCoverTitle || tidy(fallbackTitle) || 'Clipart Collection', 100);
  const keyword = tidy(listing?.primaryKeyword);
  const category = tidy(listing?.categorySuggestion);
  const candidate = [keyword, category].find(s => s && s.toLocaleLowerCase() !== title.toLocaleLowerCase());
  const subtitle = fit(candidate || 'Digital Clipart Collection', 140);
  return { title, subtitle, hasSeoTitle: Boolean(raw), hasSeoSubtitle: Boolean(candidate) };
}
