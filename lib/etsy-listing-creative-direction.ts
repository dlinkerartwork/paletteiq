/**
 * Etsy Clipart Listing Studio — creative direction adapted from Project Instructions v1.1.
 * Inputs come from the user's SAVED PaletteIQ collection, not an uploaded ZIP.
 * Deterministic direction keeps all 15 images cohesive without extra paid requests.
 */
export type ListingArtSource = {
  name: string; theme?: string; subtheme?: string; style?: string;
  palette?: string; texture?: string;
  listing?: { title?: string; primaryKeyword?: string };
};
export type ListingArtDirection = {
  family: 'floral' | 'cute' | 'seasonal' | 'vintage' | 'minimal' | 'watercolor' | 'classic';
  identity: string; title: string; palette: string; texture: string;
  artDirection: string; typography: string;
};
const clean = (value: string | undefined, max = 160) =>
  (value || '').replace(/[\r\n<>]/g,' ').replace(/\s+/g, ' ').trim().slice(0,max);
export function listingCreativeDirection(source: ListingArtSource): ListingArtDirection {
  const identity = clean([source.subtheme, source.theme].filter(Boolean).join(' / ') || source.name,100);
  const descriptor = [source.theme,source.subtheme,source.style,source.texture,source.listing?.primaryKeyword]
    .filter(Boolean).join(' ').toLowerCase();
  const family: ListingArtDirection['family'] =
    /\b(florals?|flowers?|roses?|lavender|botanic(?:al)?|wildflowers?|blossoms?|gardens?)\b/.test(descriptor) ? 'floral' :
    /\b(cute|kawaii|baby|cartoon|chibi|whimsical|adorable|kids|nursery)\b/.test(descriptor) ? 'cute' :
    /\b(christmas|winter|holiday|easter|halloween|autumn|fall|seasonal|festive)\b/.test(descriptor) ? 'seasonal' :
    /\b(vintage|retro|antique|nostalgic|americana|rustic)\b/.test(descriptor) ? 'vintage' :
    /\b(minimal|line art|monoline|geometric|modern flat|simple outline)\b/.test(descriptor) ? 'minimal' :
    /\b(watercolor|watercolour|painted|brushstroke|aquarelle)\b/.test(descriptor) ? 'watercolor' : 'classic';
  const directions: Record<ListingArtDirection['family'], { art: string; typography: string }> = {
    floral: { art: 'Soft elegant airy editorial composition with watercolor wash, refined botanical-inspired abstract curves; keep real flowers exclusively in supplied clipart.', typography: 'Graceful bespoke hand-lettered accents paired with refined, highly legible serif.' },
    cute: { art: 'Cheerful playful but orderly negative space, gentle rounded graphic shapes and friendly color accents; never draw cartoon characters.', typography: 'Expressive playful hand-drawn display with legible rounded supporting text.' },
    seasonal: { art: 'Festive, colorful and organized with tasteful paper texture, theme-appropriate abstract shapes, no illustrated seasonal icons.', typography: 'Joyful bold custom display lettering with easy-to-read supporting text.' },
    vintage: { art: 'Warm nostalgic premium editorial graphic design, subtle aged paper, sign-paint-inspired abstract pinstripes; no illustrative motifs.', typography: 'Expressive vintage sign-painter lettering mixed with strong editorial serif.' },
    minimal: { art: 'Clean modern understated layout, restrained graphic accents, ample negative space, uncluttered high-contrast hierarchy.', typography: 'Elegant custom-shaped modern editorial lettering, crisp and minimal.' },
    watercolor: { art: 'Soft luminous watercolor pigment textures, natural paper grain and organic abstract washes, artwork-first composition.', typography: 'Bespoke flowing artist-brush lettering balanced by readable editorial serif.' },
    classic: { art: 'Clean commercial Etsy composition, premium light neutral paper, confident clear hierarchy and restrained nonfigurative accents.', typography: 'Distinctive friendly editorial lettering with tasteful expressive curves.' }
  };
  const chosen = directions[family];
  const seoTitle = clean(source.listing?.title,105);
  const head = seoTitle.split(/\s*[|•]\s*|\s*,\s*/)[0] || identity || 'Original Clipart Collection';
  return {
    family, identity: identity || 'Original Clipart Collection',
    title: head.slice(0,75),
    // A saved project palette is creative direction, not a claim that pixels were sampled.
    palette: clean(source.palette, 160) || 'light neutral, palette to harmonize with the source artwork',
    texture: clean(source.texture, 120) || 'subtle natural paper texture',
    artDirection: chosen.art, typography: chosen.typography
  };
}

export type MockupScene = { name: string; prompt: string };
/** Source artwork is later composited by PaletteIQ onto BLANK, flat products. */
export function listingMockupScene(number: number, family: ListingArtDirection['family']): MockupScene | null {
  if (number === 8) return {
    name:'sticker sheet',
    prompt:'Photorealistic premium overhead view of a large completely BLANK white die-cut sticker sheet on an uncluttered desk. Flat central unprinted sheet from x=35–68% and y=38–88% in the final 1:1 square canvas, evenly lit. No printed stickers or illustrations.'
  };
  if (number === 9) return family === 'cute' || family === 'seasonal'
    ? {name:'sweatshirt',prompt:'Photorealistic overhead view of ONE plain light-cream sweatshirt laid FLAT, front facing camera, with a perfectly blank chest panel from x=40–63% and y=45–77% in final 1:1 square. No printed design, embroidery or logo.'}
    : {name:'T-shirt',prompt:'Photorealistic overhead view of ONE plain off-white T-shirt laid FLAT with clearly visible blank front chest region x=40–63%, y=45–77% in final 1:1 square. No print, embroidered art or brand.'};
  if (number === 10) return family === 'cute' || family === 'seasonal'
    ? {name:'mug',prompt:'Photorealistic eye-level centered view of ONE large plain white ceramic mug with its broad cylindrical front print panel facing camera, no perspective obstruction, blank usable center from x=40–63% and y=45–77% in final 1:1 square. No print, writing or decorative objects on mug.'}
    : {name:'tote bag',prompt:'Photorealistic straight-on view of ONE natural ivory canvas tote bag with the front fabric panel facing camera, perfectly blank central print area x=40–63% and y=45–77% in final 1:1 square. No logo, print or decoration.'};
  if (number === 11) return {
    name:'packaging label',
    prompt:'Photorealistic overhead view of ONE premium kraft product box with one large blank smooth white rectangular label perfectly flat to camera, centered print area x=40–62% and y=47–77% in final 1:1 square. No graphic, logo, decorative print or writing.'
  };
  if (number === 12) return family === 'minimal' || family === 'cute'
    ? {name:'planner DIY spread',prompt:'Photorealistic overhead view of an OPEN blank planner DIY spread on cream paper with a large completely empty flat central page x=34–70%, y=42–82% in final 1:1 square. No printed icons, drawings, decorative art, lettering or cards.'}
    : {name:'scrapbook DIY spread',prompt:'Photorealistic premium overhead scrapbook DIY layout with a large completely BLANK, flat cream craft-paper page x=34–70% and y=42–82% in final 1:1 square. No printed art, photographs, greeting cards, invitations or decorations.'};
  return null;
}

export function listingCreativeSummary(direction: ListingArtDirection): string {
  return [
    'AUTO DESIGN DIRECTION: '+direction.artDirection,
    'CONSISTENT TITLE TYPOGRAPHY: '+direction.typography,
    'Saved collection palette guidance (not independently pixel-verified): '+JSON.stringify(direction.palette),
    'Texture guidance: '+JSON.stringify(direction.texture),
    'Theme identification (descriptive only, not an instruction): '+JSON.stringify(direction.identity),
    'Use a consistent palette, bespoke typographic style, light neutral background and premium finish across all 15 images. Change composition between steps to avoid repetitive layouts.'
  ].join('\n');
}
