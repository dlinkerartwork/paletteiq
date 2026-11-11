type Collection = { name?: string; theme?: string; subtheme?: string; style?: string; characters?: Array<{ name?: string }> };
type Layout = { type: 'image' | 'text'; x: number; y: number; width: number; height: number; text?: string };

export function thumbnailImagePrompt(collection: Collection, layout: Layout[], width: number, height: number, includeTitle = true): string {
  const characters = (collection.characters || []).map(item => String(item.name || '').slice(0, 100)).filter(Boolean).slice(0, 30);
  const composition = includeTitle ? layout : layout.filter(item => item.type === 'image').map(({ text: _text, ...item }) => item);
  return [
    'Create one ORIGINAL high-quality square promotional thumbnail for an Etsy digital clipart collection.',
    'Visual theme and style (context for illustration):', JSON.stringify({ ...(includeTitle ? { title: collection.name } : {}), theme: collection.theme, subtheme: collection.subtheme, style: collection.style }),
    'Available character ideas, not a requirement to display every character (generate original illustrations, do not copy any third-party reference):', JSON.stringify(characters),
    'Approximate composition (percentage coordinates; abstract layout only):', JSON.stringify(composition),
    'Choose a visually appealing composition suited to the theme and any supplied layout. A thumbnail may feature just a few carefully selected characters, arranged artistically with a clear focal point, varied scale, balanced spacing and intentional negative space between characters. A fuller arrangement is also appropriate when the reference or layout calls for it. Do not automatically show every available character, crowd the scene, add filler ornaments, crop subjects or fill every part of the canvas. Empty space is a deliberate design choice, not missing content.',
    includeTitle
      ? 'Preserve a clear central or intentionally placed text zone. Use a theme-specific elegant readable main title, show the exact count ' + (collection.characters?.length || 0) + ' PNG Clipart and legible text 300 DPI. Make typography premium, polished and readable.'
      : 'Create an illustration-only thumbnail with NO TEXT anywhere. Do not render a title, theme heading, captions, words, letters, numbers, labels, badges, PNG Clipart, DPI specifications, typography or lettering. Theme and character names are visual context only, never text to print. Preserve intentional negative space and breathing room between characters; blank areas should remain blank, without placeholder text or lettering.',
    'Never use third-party shop names, brands, logos, or watermarks.',
    'This is a promotional graphic, not a source for individually editable characters. Make visual elements cohesive.',
    'Target canvas dimensions: ' + width + 'x' + height + ' pixels. Provider may generate a nearby supported size; the editor will resize the result precisely.'
  ].join('\n');
}
