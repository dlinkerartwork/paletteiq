export type StyleSourceAsset = { id: string; imageUrl?: string };
/** Match source artwork de-duplication without server or runtime module aliases. */
function uniqueStyleSources(assets: StyleSourceAsset[]): StyleSourceAsset[] {
  const urls = new Set<string>();
  return assets.filter(a => {
    if (!a.id || !a.imageUrl || urls.has(a.imageUrl)) return false;
    urls.add(a.imageUrl);
    return true;
  });
}

/**
 * A real Vision observation of the original collection artwork — NOT a request
 * to recreate the depicted items. The image generator only receives this text.
 */
export type ListingVisualStyleProfile = {
  signature: string;
  summary: string;
  medium: string;
  palette: string;
  texture: string;
  rendering: string;
  mood: string;
  sampleCount: number;
  analyzedAt: number;
};

export type ListingStyleSample = { assetId: string; dataUrl: string };

/** Stable lightweight change detector; includes original asset URLs so regenerating
 * a collection image invalidates a previous style analysis. Not a security hash. */
export function listingStyleSignature(characters: StyleSourceAsset[]): string {
  const source = uniqueStyleSources(characters);
  const items = source.map(a => a.id + '\u001f' + a.imageUrl).sort();
  let hash = 2166136261;
  for (const item of items) {
    for (let i = 0; i < item.length; i++) {
      hash ^= item.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 10;
    hash = Math.imul(hash, 16777619);
  }
  return 'visual-v1-' + source.length + '-' + (hash >>> 0).toString(16);
}

export function currentListingVisualStyle(
  profile: ListingVisualStyleProfile | undefined,
  characters: StyleSourceAsset[]
): ListingVisualStyleProfile | null {
  return profile && profile.signature === listingStyleSignature(characters)
    && typeof profile.summary === 'string' && profile.summary.trim()
    ? profile : null;
}

export function listingStyleDirection(profile: ListingVisualStyleProfile): string {
  return [
    'OBSERVED STYLE OF REAL SOURCE CLIPART (derived from actual original collection images; prioritize this above generic theme templates):',
    'Medium: ' + profile.medium,
    'Color family: ' + profile.palette,
    'Surface and material texture: ' + profile.texture,
    'Brushwork, edge and detail treatment: ' + profile.rendering,
    'Atmosphere: ' + profile.mood,
    'Visual art direction: ' + profile.summary,
    'Create an imaginative original NONFIGURATIVE background and bespoke typography that BELONG to this visual family, without copying motifs or recreating any actual clipart object.',
    'You may freely vary composition, ornament, scale, layout and expressive lettering to make an engaging buyer-ready design, while preserving a consistent medium, color character, texture and finish.'
  ].join('\n');
}
