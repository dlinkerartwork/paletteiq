/**
 * AI-First thumbnail design. Contact sheets are source-asset INDEXES, not
 * layouts. In AI-First, the image model uses references to generate a full
 * single-layer thumbnail. Source illustration details may be reinterpreted.
 */
export const AI_FIRST_MAX_REFERENCE_SHEETS = 8;
export const AI_FIRST_ASSETS_PER_SHEET = 24;
export const AI_FIRST_MAX_REFERENCE_ASSETS = AI_FIRST_MAX_REFERENCE_SHEETS * AI_FIRST_ASSETS_PER_SHEET;

export function aiFirstSampleIndices(total: number, max = AI_FIRST_MAX_REFERENCE_ASSETS): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(max) || max < 1) return [];
  const count = Math.min(total, max);
  if (count === total) return Array.from({length:total},(_,i)=>i);
  return Array.from({length:count},(_,i)=>Math.floor((i+0.5)*total/count));
}
type CreativeInput = {
  theme: string; title: string; subtitle: string; badge: string;
  selectedCount: number; revisionNotes?: string;
  style?: string; palette?: string; texture?: string;
  observedSourceStyle?: string; approvedCoverStyle?: string;
  sourceAssets?: Array<{ name: string; category?: string }>;
};

/** Keep the user's successful Etsy prompt structure; adapt only real source facts. */
export function aiFirstConceptPrompt(input: CreativeInput): string {
  const examples=(input.sourceAssets||[]).slice(0,32)
    .map(x=>[x.name,x.category].filter(Boolean).join(' — '));
  return [
    'Create a stunning, premium-quality Etsy digital clipart bundle thumbnail with a beautifully balanced, artistic, and visually engaging composition.',
    '',
    '**CANVAS**',
    '- Square format, 1024 × 1024 pixels.',
    '- Design a clean, theme-matched background with subtle, tasteful texture.',
    '- Avoid distracting backgrounds, heavy patterns or decorative frames unless they significantly improve the composition.',
    '',
    '**ARTWORK & COMPOSITION**',
    'Create a rich, abundant collage featuring original illustrations from the supplied '+JSON.stringify(input.theme)+' collection.',
    'For the main hero, begin with approximately 6–12 standout source illustrations with clear recognizable details. If a more abundant collage genuinely looks better, add smaller sourced supporting motifs as needed; this is guidance, not a hard object limit.',
    'Use a variety of ACTUAL supplied original assets. Source artwork is represented visually by numbered reference images; they are equivalent to the contents of a collection ZIP, not pre-arranged canvas objects.',
    examples.length ? 'Examples of the actual available illustrations (not mandatory to include all): '+examples.join('; ') : '',
    '- Arrange illustrations organically around and between the typography, creating a rich but harmonious composition.',
    '- Use dramatically varied object sizes. Feature compelling visual anchors when suitable; support them with medium and miniature original assets.',
    '- Distribute objects across the canvas including corners and edges; allow creative positioning, rotation, scaling and asymmetry.',
    '- Create visual depth and rhythm through intentional variation.',
    '- Avoid uniform grids, repetitive spacing, awkward overlaps, overcrowding, obscured characters and excessive empty space.',
    '- Make the composition feel like an expertly art-directed commercial illustration collage.',
    '- Verify that the product is immediately recognizable and dominant at mobile thumbnail size. Do not let titles, tiny artwork, extra badges or unnecessary decoration overpower the real clipart.',
    '',
    '**TYPOGRAPHY**',
    'Include the following exact text:',
    'Main title: '+JSON.stringify(input.title),
    'Subtitle: '+JSON.stringify(input.subtitle),
    'Badge: '+JSON.stringify(input.badge)+' (leave out if empty).',
    'Create beautiful, professional, artistic typography with a strong hierarchy.',
    '- Choose complementary title colors and expressive lettering appropriate to the actual source theme.',
    '- Make subtitle smaller and refined as aesthetically appropriate; integrate any badge tastefully.',
    '- Keep all typography proportional, artistically appealing and clearly readable at small Etsy thumbnail size.',
    '- Integrate text naturally with the original illustrations without covering important letterforms.',
    '- Explore creative typography and lettering without being restricted to particular fonts.',
    '',
    '**ARTISTIC DIRECTION**',
    'Match the actual illustration style of the attached collection, not a fixed Christmas/woodland reference.',
    input.style?.trim() ? 'Collection visual style: '+input.style.trim() : '',
    input.palette?.trim() ? 'Collection palette guidance: '+input.palette.trim() : '',
    input.texture?.trim() ? 'Collection texture: '+input.texture.trim() : '',
    'Make the result cohesive, charming, premium and highly appealing to Etsy shoppers. Preserve each original illustration’s distinctive rendering, color, expressions and details.',
    input.observedSourceStyle?.trim() ? 'Actual source artwork style observed from collection imagery: '+input.observedSourceStyle.trim() : '',
    'DEFAULT DESIGN SYSTEM: Clean Commercial, 1:1 square, light theme-adapted backdrop, bold readable friendly artistic lettering and modern balanced layout. Adapt naturally to watercolor flowers, cute characters, seasonal holidays, vintage pictures and minimalist line art; do not impose one style on unrelated collections.',
    '',
    '**CREATIVE FREEDOM**',
    'Act as an experienced Etsy creative director and commercial thumbnail designer.',
    'You have full freedom to determine the best positions, sizes, rotations, visual hierarchy, spacing, text styling and relationships between original objects and typography.',
    'Prioritize beauty, artistic composition, readability, visual richness and strong thumbnail appeal.',
    'Make the result professionally designed, not mechanically assembled.',
    '',
    '**FINAL QUALITY**',
    'A polished premium Etsy listing cover with visually prominent original clipart, beautifully varied illustration sizes, balanced artistic typography, a harmonious background, and strong visual impact at 128px thumbnail size.',
    'Final cover quality checklist: Is the product recognizable instantly? Is the title readable when reduced? Can you clearly see the most appealing illustrations? Does the design stand out without clutter? Does it accurately represent the supplied references? Improve any weakness BEFORE returning the image.',
    '',
    '**SOURCE CLIPART REQUIREMENTS**',
    'Use the supplied clipart collection as the EXCLUSIVE source for all illustrated characters and objects.',
    'Preserve original characters, artistic styles, colors, expressions, clothing, accessories and recognizable details.',
    'Do not invent unrelated clipart or replace supplied characters with newly imagined variations.',
    'Never invent or imply unverified asset counts, formats, dimensions, resolution, DPI, transparency, licensing rights or bonus items. Only the user-supplied exact lettering may carry its own claims; do not add new ones.',
    'You may select any number of actual source assets, resize, rotate, position and repeat EXISTING source PNGs where artistically appropriate. No fixed grid or mandatory size uniformity.',
    'Treat originals as flexible independent illustrations, not an existing design to preserve.',
    'The selected clipart are VISUAL REFERENCES for the image model to integrate creatively into ONE finished thumbnail. Stay as faithful as possible to the original artwork, recognizable subjects, colors, expressions and details. A generative image model may reinterpret or redraw them; pixel-identical copying is not guaranteed.',
    'The numbered contact sheets are visual previews of the same originals that PaletteIQ packages as a user-downloadable ZIP. ZIP is NOT itself a visual model input. Never assume position/size from contact-sheet cells.',
    input.revisionNotes?.trim() ? '**ADDITIONAL USER REQUEST**: '+input.revisionNotes.trim().slice(0,800) : '',
    '',
    '**FINAL IMAGE GENERATION**',
    'Generate the complete finished 1024 × 1024 Etsy cover directly as ONE cohesive image: illustrated collage, artistic typography, background and badge together. This is NOT a layout JSON request, an empty typography plate or a contact sheet.',
    'The attached visual reference boards are an unordered collection of artwork; numbers and cell boundaries are for identification only. Ignore the source board geometry. Select and arrange elements freely, with dramatically varied scale and attractive spacing.',
    'Use only objects depicted in the reference boards as the visual subject vocabulary; do not invent, blend, reinterpret or substitute unrelated characters, clothing, accessories or vehicles. Preserve recognizable face, structure, silhouette, pose, color and detailed identity; exact original pixels are not guaranteed in a generative result.',
    'Generate ONE image. The rest of the 15-image sequence should reuse the same visual family but show DIFFERENT layouts appropriate to each listing step.',
    'Maintain exact wording for title, subtitle and badge. Make all lettering readable at Etsy search thumbnail size.',
  ].filter(Boolean).join('\n');
}



/**
 * Creative briefs for Etsy CLIPART LISTING STUDIO's fifteen image tiles.
 * Main Cover intentionally retains the user's proven full artistic prompt.
 * The other images are distinct merchandising tasks, not fourteen more covers.
 * This helper is NOT used by Thumbnail Designer.
 */
export const AI_FIRST_LISTING_IMAGE_BRIEFS: Readonly<Record<number, {
  title: string; objective: string; directions: readonly string[];
}>> = {
  2: {title:'Bundle Overview',objective:'Give buyers a quick, attractive overview of the collection.',
    directions:[
      'Present a broad, representative assortment of the selected source clipart, not another hero title cover.',
      'Organize organically into a few clearly distinguishable visual groupings to communicate the range and theme.',
      'Use varied object sizes, balanced whitespace and modest typography. The clipart—not marketing copy—should dominate.',
      'Avoid depicting dozens of indistinguishable tiny items or implying that every item is visible when it is not.'
    ]},
  3: {title:'Complete Collection',objective:'Show the breadth of the digital bundle in a useful visual inventory.',
    directions:[
      'Present as many DIFFERENT selected source motifs as can remain recognizable at thumbnail size; favor comprehensive visual coverage over dramatic hero typography.',
      'Use a beautifully ordered dense mosaic, multi-row salon-style gallery or editorial semi-grid. Keep individual illustrations distinguishable.',
      'Small, consistent margins and a compact title are appropriate. Do not add objects that are not represented in the source references.',
      'This is a visual SAMPLE when the reference set does not include the entire bundle; do not falsely imply pixel-exact coverage.'
    ]},
  4: {title:'Best Elements',objective:'Spotlight the collection\'s most appealing individual illustrations.',
    directions:[
      'Choose a small set of the most visually expressive selected source subjects and show them substantially larger than on overview pages.',
      'Let fine brushwork, faces, silhouette and special details remain visible; make the presentation an editorial close-up showcase, not a crowded cover.',
      'Use restrained complimentary lettering and careful spacing. Keep subject shapes unobstructed.'
    ]},
  5: {title:'Collection Categories',objective:'Help the buyer understand which kinds of clipart are in the collection.',
    directions:[
      'Create an elegant categorized gallery with recognizable small groups of relevant source clipart and clear section hierarchy.',
      'Use only category names supported by the supplied source names or their known category metadata. Do not invent new product groups.',
      'Separate categories using tasteful spacing or subtle nonfigurative dividers, not a giant decorative title collage.',
      'If category metadata is missing, group by genuinely visible subject types without making unsupported claims.'
    ]},
  6: {title:'File Features',objective:'Communicate real digital file benefits with a refined product-feature graphic.',
    directions:[
      'Design a clean, readable feature-led editorial graphic with a handful of selected clipart samples supporting the text.',
      'Only assert features that are confirmed by user-supplied wording or verifiable collection metadata: do not invent dimensions, resolution, DPI, transparency, license rights, file types or delivery guarantees.',
      'Prefer precise small labels, discreet dividers and premium hierarchy. Never claim formats or entitlements just because they are common for Etsy.',
      'If no verified feature data is supplied, focus on the digital artwork preview rather than generating unverified feature badges.'
    ]},
  7: {title:'Artwork Close-Up',objective:'Show the visual craft and texture of the illustrations.',
    directions:[
      'Create a refined macro-detail study with one to three prominent source motifs, cropped artistically but with enough intact subject context.',
      'Emphasize the actually visible brushwork, color transitions and edge quality from the references. Do not invent quality claims about source resolution.',
      'Use tiny supporting typography and a calm background, prioritizing close-up artwork texture.'
    ]},
  8: {title:'Sticker Sheet Mockup',objective:'Demonstrate how the selected clipart might look as a crafted sticker sheet.',
    directions:[
      'Create a believable sticker-sheet APPLICATION MOCKUP with several selected source illustrations arranged as individual sticker motifs.',
      'Use crisp white die-cut borders, light paper texture and realistic but tasteful tabletop lighting, without claiming that physical stickers are included.',
      'The digital clipart bundle is the product; the sticker sheet is only an inspirational usage example.',
      'Keep any main title secondary to the applied sample designs. Avoid crowded overlaps.'
    ]},
  9: {title:'Apparel Mockup',objective:'Show one credible apparel-use example of the digital artwork.',
    directions:[
      'Create a commercially polished, realistic blank T-shirt or sweatshirt mockup, choosing a simple garment well suited to this actual collection.',
      'Apply a small, attractive arrangement of reference motifs to a plausible printable garment area with proper fold and fabric perspective.',
      'Show it as an APPLICATION IDEA ONLY: the physical garment is not included in the digital download.',
      'Avoid brand names, fake endorsements, unexpected text on the garment and unrelated generated clipart.'
    ]},
  10: {title:'Accessories Mockup',objective:'Illustrate a tasteful potential accessory customization.',
    directions:[
      'Choose a believable tote bag, ceramic mug or tumbler that fits the supplied artwork and create a realistic premium lifestyle product mockup.',
      'Apply a selected source motif naturally to the product surface; preserve convincing material curvature, light and shadows.',
      'Clearly treat the object as an example of POSSIBLE USE, not an included physical product or a promise of print compatibility.',
      'Make the clipart application visually prominent without overwhelming the scene.'
    ]},
  11: {title:'Packaging & Labels Mockup',objective:'Show how the artwork could embellish gift packaging and labels.',
    directions:[
      'Create a warm, professional product-packaging or gift-label mockup featuring selected source artwork on a product label, packaging tag, box or paper wrap.',
      'Make printed artwork appropriately scaled and integrated with real paper, shadows and perspective.',
      'This is a CREATIVE APPLICATION EXAMPLE only. Do not imply boxes, labels, cards, or printed merchandise are shipped with the digital bundle.',
      'Use simple credible print finishing and restrained text.'
    ]},
  12: {title:'Creative Projects Mockup',objective:'Inspire creative uses with an achievable example project.',
    directions:[
      'Show an appealing scrapbook, planner spread or practical DIY craft project using recognizable motifs from the actual source art. Avoid greeting/invitation/wedding stationery.',
      'Build a believable overhead workspace/editorial scene and let the applied artwork communicate a practical creative idea.',
      'Do not present physical supplies or finished print products as items included in the digital download.',
      'Balance aesthetic impact with clarity of how the motifs may be used.'
    ]},
  13: {title:"What's Included",objective:'Summarize exactly what the customer will receive.',
    directions:[
      'Design a polished, highly legible informational product-summary slide with a restrained representative sample of the artwork.',
      'Only list factual contents validated by the selected collection and user-provided text. A source reference count is not automatically a verified full-bundle quantity.',
      'Do not invent ZIP contents, bonus packs, number of unique files, license terms, software compatibility, DPI, dimensions, or file formats.',
      'Use a premium feature hierarchy rather than a dense artistic cover collage.'
    ]},
  14: {title:'How to Download & Use',objective:'Explain the digital delivery and usage journey simply.',
    directions:[
      'Create a clean numbered educational infographic with concise, easy-to-follow steps and modest selected clipart accents.',
      'Communicate the general digital-download workflow without pretending to show exact storefront UI or unverified personal account settings.',
      'Avoid invented file formats, technical requirements, licensing claims and fixed platform-specific instructions that may be inaccurate.',
      'Make steps legible at Etsy thumbnail size; keep the background spare and instructional.'
    ]},
  15: {title:'Final Bundle Showcase',objective:'Close the listing sequence with a memorable, cohesive summary of the collection.',
    directions:[
      'Create an emotionally appealing final showcase, reusing the actual theme and visual language of the selected artwork.',
      'Combine several recognizable collection motifs in a fresh balanced editorial arrangement, distinct from the Main Cover.',
      'Use elegant finishing typography and a tasteful closing impression without invented urgency, discounts or guarantees.',
      'Conclude with a visually cohesive reminder of the bundle’s character, consistent with the approved Main Cover, rather than repeating its composition.'
    ]}
};

/** Return the user-approved Main Cover prompt ONLY for tile 01. */
export function aiFirstListingPrompt(number: number, input: CreativeInput & {
  collectionCount?: number;
}): string {
  if (number === 1) return aiFirstConceptPrompt(input);
  const spec=AI_FIRST_LISTING_IMAGE_BRIEFS[number];
  if (!spec) throw Error('Invalid Etsy Clipart Listing Studio image type');
  const examples=(input.sourceAssets||[]).slice(0,32)
    .map(a=>[a.name,a.category].filter(Boolean).join(' — '));
  return [
    'Design ONE stunning, commercially professional Etsy digital clipart listing image specifically for '+spec.title+'.',
    'This is image '+number+' of 15 in Etsy Clipart Listing Studio. It is NOT Main Cover. Do NOT reuse the Main Cover 18–25-clipart hero collage formula or oversized headline treatment.',
    '**PURPOSE**: '+spec.objective,
    '**CANVAS**: Square 1024 × 1024 pixels, premium and clearly readable even at Etsy thumbnail size.',
    '**ACTUAL COLLECTION**: '+JSON.stringify(input.theme),
    input.style?.trim() ? 'Saved artistic style: '+input.style.trim() : '',
    input.palette?.trim() ? 'Saved palette guidance: '+input.palette.trim() : '',
    input.texture?.trim() ? 'Saved texture guidance: '+input.texture.trim() : '',
    'Number of unique ORIGINAL clipart images currently saved in the collection (verified app inventory): '+String(input.collectionCount ?? input.selectedCount)+'.',
    'Number of selected source images supplied as candidate visual references: '+String(input.selectedCount)+'.',
    input.observedSourceStyle?.trim() ? 'OBSERVED real clipart visual characteristics: '+input.observedSourceStyle.trim() : '',
    input.approvedCoverStyle?.trim() ? 'VISUAL CONTINUITY: Main Cover was approved. Maintain its verified collection identity, palette, typography character and overall finish while using a DIFFERENT composition. '+input.approvedCoverStyle.trim() : '',
    examples.length ? 'Examples of genuinely selected source clipart: '+examples.join('; ') : '',
    aiFirstLayoutArchetype(number),
    '**VISUAL DIRECTION FOR '+spec.title.toUpperCase()+'**',
    ...spec.directions.map(s=>'- '+s),
    number>=8 && number<=12
      ? 'GENERAL-PURPOSE MOCKUP POLICY: Prioritize sticker sheets, die-cut stickers, T-shirts, sweatshirts, kidswear, mugs, tumblers, tote bags, product packaging, labels, scrapbooks, planners and DIY craft applications. Adapt automatically to the real collection. DO NOT use greeting cards, invitation cards, wedding stationery, or other card-based mockups by default; only do so if the user explicitly requests them. A physical mockup product is NOT included in the digital bundle.'
      : '',
    number>=2 && number<=5
      ? 'COLLECTION PRESENTATION POLICY: Demonstrate genuine variety and recognizable original subjects, with clean editorial organization and minimal duplicates. Never suggest a reference selection is literally the entire archive unless it is.'
      : '',
    number===6 || number===7 || number===13
      ? 'VERIFIED PRODUCT DATA: Use ONLY collection facts actually validated by the saved PaletteIQ inventory or user-provided authoritative listing information. Never invent asset counts, formats, DPI, dimensions, transparency, commercial licenses or bonuses. If a claim is uncertain, OMIT it.'
      : '',
    '**TYPOGRAPHY**',
    'Use these exact user-editable words (empty fields mean omit them):',
    'Main title: '+JSON.stringify(input.title),
    'Subtitle: '+JSON.stringify(input.subtitle),
    'Badge: '+JSON.stringify(input.badge),
    'Design typography, font styles, text positions and relative sizes with freedom appropriate to this SPECIFIC image purpose.',
    'The typography must remain subordinate to content where this is an informational or mockup image. Never invent additional text, discounts, features or quantities.',
    'Design with short, readable, high-contrast wording; do not fill supporting images with the long SEO title or repeat the Main Cover layout.',
    '**ARTISTIC FREEDOM**',
    'Maintain an original, cohesive visual language derived from the supplied artwork, but adapt the layout, visual hierarchy, density and presentation to THIS image type—not to the Main Cover.',
    'QUALITY GATE: Confirm a professional balanced layout, recognizable real source subjects, theme-relevant mockups, readable exact typography, no invented file/license claims, no awkward cropping and coherent finish with previously approved listing images. Fix design problems before finishing.',
    'The attached numbered contact sheets are unordered visual references, not grids, canvas positions or pixel-exact assets. Prefer the separate full-resolution original image references for distinctive details when supplied.',
    'Use depicted reference subjects only; do not invent unrelated characters or misrepresent what is included in the sold digital collection.',
    'OpenAI will generate the complete image in one creative pass. Exact pixel-matching with original clipart cannot be guaranteed.',
    input.revisionNotes?.trim() ? 'User revision direction: '+input.revisionNotes.trim().slice(0,800) : '',
    aiFirstLayoutArchetype(number),
    '**FIDELITY TO THE REAL COLLECTION**: Use the attached actual clipart illustrations as the ONLY figurative subject vocabulary. Preserve each reference image character silhouette, expression, color, accessories, pose, texture and distinctive identity as faithfully as possible. Do not invent characters, blend parts from two references, repaint one asset as a different subject, add random text inside illustrations or substitute made-up variations. Different source originals should remain recognizable and distinct. This is generative image editing, so pixel-exact copying is not guaranteed.',
    '**FINAL OUTPUT**: Generate one finished 1024 × 1024 Etsy '+spec.title+' image following the UNIQUE structural archetype above, not a generic Main Cover variant, raw reference contact sheet, blank template or JSON layout.'
  ].filter(Boolean).join('\n');
}

/**
 * Deliberately DISTINCT visual construction rules per Etsy Clipart Listing
 * Studio tile. Layout is decisive; brand/cover STYLE does not imply
 * repeating the same title frame, image arrangement or border.
 */
export const AI_FIRST_LAYOUT_ARCHETYPES: Readonly<Record<number,{
  name: string; layout: string; forbidden: string; detailedReferences: number;
}>>={
  2:{name:'HERO STRIP + MINI COLLECTION CATALOG',
    layout:'BUILT LIKE A TWO-TIER MERCHANDISING PAGE, not a hero poster. TOP: a slim heading (no more than 10–12% height), then a showcase strip of FOUR to SIX prominently sized, different source illustrations taking approximately 30–35% of canvas height. LOWER: a tidy miniature gallery of MANY other DISTINCT reference illustrations arranged in 5–8 narrow columns and several rows over roughly the bottom 45–50% of the canvas. The gallery should communicate range at a glance; enlarge the leading objects and keep the smaller catalog orderly, with restrained dividers and a small final caption only if supplied. Preserve generous breathing room between the upper showcases and lower catalog. This is the large-featured-top + small-catalog-bottom pattern.',
    forbidden:'DO NOT make a single generic hero collage, 12 equally sized stickers, or a uniformly tiny full-page inventory. DO NOT copy Main Cover header bands, badge placement or ornamental border geometry.',detailedReferences:5},
  3:{name:'MAXIMUM-COVERAGE FULL CATALOG GRID',
    layout:'A TRUE COMPLETE-COLLECTION INVENTORY BOARD. Use a SMALL compact title occupying no more than 8–12% of the height. Devote at least 75–85% of the 1024 square to a dense, tidy, regularly spaced catalog of many DIFFERENT original-reference motifs. When the selected collection is large, visually target approximately TEN TO TWELVE COLUMNS by EIGHT TO TEN ROWS of small independent items, each sitting neatly within a consistent light cell or separated by equal narrow spacing. Favor maximum recognizable variety and even thumbnail sizes over large feature illustrations. The provided reference boards are INPUT only; create a deliberately designed catalog page instead of copying their pixels or numbering. If only fewer assets are available, show fewer without inventing entries.',
    forbidden:'NO 4–6 giant featured images. NO dominant headline, hero collage, poster layout, upper showcase zone or large logo banner. DO NOT invent duplicates to reach a visual count or assert ALL items are shown if not.',detailedReferences:2},
  4:{name:'LARGE EDITORIAL BEST-ELEMENTS SHOWCASE',
    layout:'Create a spacious art-gallery showcase with TWO very large, detailed hero illustrations side by side across approximately the upper HALF of the image, and approximately FOUR TO EIGHT secondary standout illustrations at varied medium sizes across the lower portion. White space and subject clarity are the priority. Use a small elegant header, with little or no footer or sales badge. Each subject should be individually appreciable without a cramped cell, with lively natural scale differences.',
    forbidden:'NO dense small catalog grid, NO many equally sized cells, NO giant dark title panel, NO clone of the Main Cover collage. Do not reduce the hero assets to thumbnail-sized icons.',detailedReferences:5},
  5:{name:'LABELED CATEGORY SECTIONS',
    layout:'A clearly divided educational category board with TWO TO FIVE separate titled compartments/columns, each containing a small relevant group of illustrations whose actual source category exists. Use distinct whitespace or gentle dividers between compartments. Categories—not one general collage—are the visual hierarchy. Header small; all category labels concise and accurate.',
    forbidden:'NO generic hero strip plus grid, NO dense uniform master inventory, NO fictitious category names or repeated full Main Cover.',detailedReferences:3},
  6:{name:'MINIMAL FACT-LED FEATURE INFOGRAPHIC',
    layout:'Use a split editorial infographic: about HALF the page is a beautiful small original-art sample, the other half is a clean typographic information column with ONLY validated digital product facts. Use large readable factual labels and spacious alignment. If there are no verified details, omit feature chips and show only a restrained art preview.',
    forbidden:'NO hero collage, NO invented DPI, transparency, print size or licensing, NO dense inventory, NO fake feature icons or decorative badges.',detailedReferences:2},
  7:{name:'MAGNIFIED ARTWORK DETAIL STUDY',
    layout:'Create a detail-led close-up image. ONE large illustration/region dominates roughly TWO THIRDS of the square with realistic brushwork texture as seen in its reference; add ONE or TWO smaller intact source objects for context or compare fine details. The typography is a quiet small label only. Leave quiet light negative space.',
    forbidden:'NO dense grids, NO five-object hero strip, NO large display headline, NO artwork or strokes that do not exist in the source references.',detailedReferences:3},
  8:{name:'REALISTIC STICKER SHEET MOCKUP',
    layout:'Realistic photographed mockup of ONE sheet of paper with several distinct die-cut sticker applications and realistic matte paper, edge shadows and occasional visible craft-table tools. The whole design is about the sheet itself; keep the page header off the mockup or extremely small.',
    forbidden:'NO digital clipart inventory grid masquerading as stickers, NO main-cover typography banner, NO physical-sticker-included claim.',detailedReferences:4},
  9:{name:'APPAREL PRODUCT PHOTOGRAPH',
    layout:'A premium realistic lifestyle photo or flat-lay of ONE T-shirt or sweatshirt occupying approximately TWO THIRDS of the square, with one compact original-reference motif printed naturally on its front. Use real garment folds and plausible print perspective. A small corner explanatory label may fit.',
    forbidden:'NO collage of vehicles/animals floating around a garment, NO multiple unrelated apparel panels, NO thick Main Cover header or repeated inventory grid.',detailedReferences:2},
  10:{name:'SINGLE ACCESSORY LIFESTYLE MOCKUP',
    layout:'ONE believable accessory product, such as a tote bag, mug or tumbler, centered in an editorial lifestyle scene. Apply a real source-reference artwork motif onto its printable surface with accurate curvature and material lighting. Use a quiet background and a small text label.',
    forbidden:'NO collage of multiple unrelated accessories, NO poster grid, NO giant header and no false claim that a physical accessory is sold.',detailedReferences:2},
  11:{name:'PAPER PACKAGING FLAT-LAY',
    layout:'An elegant overhead or three-quarter photographic flat-lay of a few product labels, parcel packaging or paper tags, each naturally featuring one source-reference motif. Materials, print registration, perspective and shadows must look plausible. Light small explanatory lettering.',
    forbidden:'NO greeting/invitation/wedding cards by default, NO generic artwork grid, NO Main Cover copy, NO claim packaging is included.',detailedReferences:2},
  12:{name:'ONE FINISHED DIY CREATIVE SCENE',
    layout:'A realistic overhead craft desk or scrapbook/planner project showing source artwork actually used within ONE coherent creative project. Build foreground-background depth with restrained stationery props but keep the applied motifs recognizable. Use only a tiny instructional heading.',
    forbidden:'NO separate subject catalog, NO invitation-card or greeting-card mockup by default, NO oversized cover title and no claim physical tools are included.',detailedReferences:3},
  13:{name:'INVENTORY SUMMARY FACT PANEL',
    layout:'A clearly structured informational page: one compact actual-artwork preview on one side, a readable list of strictly VERIFIED bundle contents on the other, with generous typography and clean dividers. The legitimate count (when known) may be larger than the graphic. Show several visual examples without suggesting the graphic itself contains all assets.',
    forbidden:'NO invented item counts, file formats, rights, extras, resolutions or service guarantees; NO cover-style decorative giant title or tiny catalog grid.',detailedReferences:3},
  14:{name:'LARGE NUMBERED HOW-TO STEPS',
    layout:'A simple visual instructional infographic with THREE or FOUR numbered steps laid out top-to-bottom or left-to-right, each with concise wording, clean nonfigurative diagram accents and a very small original reference art flourish. Readability of the steps is the whole purpose.',
    forbidden:'NO dense illustration collage, NO creative product mockup grid, NO fabricated Etsy-interface screenshots or account-specific digital delivery claims.',detailedReferences:1},
  15:{name:'OPEN SPACIOUS FINAL GALLERY',
    layout:'A calm premium finale with a fresh asymmetrical cluster of about SIX TO TEN memorable original source reference motifs, styled like a final magazine spread or designer lookbook with generous negative space. One concise closing phrase, with slightly quieter type than Main Cover. Cohesive palette but new framing and object distribution.',
    forbidden:'NO recycled Main Cover, NO giant repeated title plaque, NO dense Complete Collection grid, NO fake discount/urgency text.',detailedReferences:4}
};

export function aiFirstLayoutArchetype(number:number){
  const info=AI_FIRST_LAYOUT_ARCHETYPES[number];
  if(!info)throw Error('No separate supporting-image layout for this listing type');
  return [
    '**NON-NEGOTIABLE VISUAL STRUCTURE — '+info.name+'**',
    info.layout,
    '**FORBIDDEN LAYOUTS:** '+info.forbidden,
    'This specific visual construction is MORE IMPORTANT than repeating any previous listing image layout. Preserve ONLY the collection art style, palette and professional finish from Main Cover; never use its composition, title panel, border, layout grid or large lettering as a template.'
  ].join('\n');
}

/** A few actual high-resolution source image files can supplement small JPEG
 * contact sheets and improve detail recognition, not guarantee pixel identity.
 */
export function aiFirstDetailedReferenceCount(number:number){
  if(number===1)return 5;
  return AI_FIRST_LAYOUT_ARCHETYPES[number]?.detailedReferences ?? 0;
}
