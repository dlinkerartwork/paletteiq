/**
 * Cost-free cover copy guidance based ONLY on saved collection facts.
 * Etsy SEO title stays unchanged; these are shorter optional IMAGE overlays.
 */
export type ListingCopySource = {
  name?: string; theme?: string; subtheme?: string; style?: string;
  seoTitle?: string; primaryKeyword?: string; collectionSize?: number;
};
export type TitleReadability = {
  status: 'good' | 'warning' | 'too-long';
  words: number; characters: number; message: string;
};
const clean = (value: string | undefined) =>
  (value || '').replace(/[\r\n<>]/g, ' ').replace(/\s+/g, ' ').trim();
const titleCase = (value: string) => value.split(' ').map(word =>
  word.length ? word[0].toUpperCase() + word.slice(1) : '').join(' ');
const distinct = (strings: string[], max: number) =>
  [...new Set(strings.map(x => clean(x).replace(/\s*[|•]\s*$/, '')).filter(Boolean))]
    .filter(x => x.length <= 65).slice(0,max);
const shorten = (text: string) =>
  clean(text).split(/\s*[|•]\s*|\s+[-–—]\s+|\s*,\s*/)[0].replace(/\b(digital download|instant download)\b/ig, '').trim();

export function evaluateListingCoverTitle(text: string): TitleReadability {
  const title=clean(text);
  const words=title ? title.split(' ').length : 0;
  const characters=title.length;
  if (!words) return { status:'warning', words, characters, message:'Title is empty. You can leave it blank, but a concise cover title usually helps shoppers understand the bundle.' };
  if (words >= 9 || characters > 55)
    return { status:'too-long', words, characters, message:'Too long for a small Etsy thumbnail. Try a short 2–5 word cover title; keep the full SEO title in Etsy Listing Draft.' };
  if (words >= 6 || characters > 35)
    return { status:'warning', words, characters, message:'This title may wrap into many lines or compete with original clipart. Consider a shorter 2–5 word version.' };
  return { status:'good', words, characters, message:'Good length for an Etsy cover. Check the actual artistic lettering after generation.' };
}

export function suggestListingCoverCopy(source: ListingCopySource): { titles: string[]; subtitles: string[] } {
  const seo=shorten(source.seoTitle || '');
  const main=shorten(source.subtheme || source.theme || source.name || '');
  const collectionName=shorten(source.name || '');
  const theme=shorten(source.theme || '');
  const keyword=shorten(source.primaryKeyword || '');
  const style=shorten(source.style || '');
  // Avoid inventing painted style, image format, dimensions, license, or usage.
  const stylePrefix=/\b(watercolor|watercolour|gouache|vintage|retro|kawaii|boho|pastel|hand.painted)\b/i
    .test(style) ? titleCase(style.split(/[,;/]/)[0].slice(0,24)) : '';
  const label=titleCase(main || collectionName || seo || 'Clipart');
  const base=label.replace(/\s+(cliparts?|bundle|pack|collection)$/i,'');
  const keywords=titleCase(keyword);
  const hasClipart=/clipart/i.test(label);
  const themed=hasClipart ? label : label+' Clipart';
  const count=source.collectionSize && Number.isInteger(source.collectionSize) && source.collectionSize > 0
    ? source.collectionSize : 0;
  const titleCandidates=[
    seo && seo.split(' ').length <= 6 ? titleCase(seo) : '',
    themed,
    base+' Collection',
    base+' Art Bundle',
    stylePrefix && !base.toLowerCase().includes(stylePrefix.toLowerCase()) ? stylePrefix+' '+base+' Clipart' : '',
    keywords && keywords.split(' ').length <= 5 ? keywords : '',
    theme && theme.toLowerCase()!==main.toLowerCase() ? titleCase(theme)+' Clipart' : '',
    collectionName && collectionName.toLowerCase()!==main.toLowerCase() ? titleCase(collectionName) : ''
  ];
  const subtitles=distinct([
    keyword && keyword !== seo ? keyword : '',
    count ? count+' Original Clipart Illustrations' : '',
    stylePrefix ? stylePrefix+' Artwork Collection' : '',
    base+' Artwork Collection',
    theme && theme.toLowerCase()!==main.toLowerCase() ? titleCase(theme)+' Inspired Designs' : '',
    'Original Clipart Collection'
  ],6);
  return {
    titles:distinct(titleCandidates,6).filter(t => t.split(' ').length <= 8),
    subtitles
  };
}
