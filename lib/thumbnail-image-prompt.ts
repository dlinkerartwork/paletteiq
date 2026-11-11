type Collection = { name?: string; theme?: string; subtheme?: string; style?: string; characters?: Array<{ name?: string }> };
type Layout = { type: 'image' | 'text'; x: number; y: number; width: number; height: number; text?: string };

export function thumbnailImagePrompt(collection: Collection, layout: Layout[], width: number, height: number, includeTitle = true): string {
  const characters = (collection.characters || []).map(item => String(item.name || '').slice(0, 100)).filter(Boolean).slice(0, 30);
  const composition = includeTitle ? layout : layout.filter(item => item.type === 'image').map(({ text: _text, ...item }) => item);
  return [
    'Create one ORIGINAL high-quality square promotional thumbnail for an Etsy digital clipart collection.',
    'Visual theme and style (context for illustration):', JSON.stringify({ ...(includeTitle ? { title: collection.name } : {}), theme: collection.theme, subtheme: collection.subtheme, style: collection.style }),
    'Suggested characters (generate original illustrations, do not copy any third-party reference):', JSON.stringify(characters),
    'Approximate composition (percentage coordinates; abstract layout only):', JSON.stringify(composition),
    'Use an organic, irregular, playful asymmetric arrangement with characters of varied scale distributed to fill the canvas, including some edge-cropped ornaments.',
    includeTitle
      ? 'Preserve a clear central or intentionally placed text zone. Use a theme-specific elegant readable main title, show the exact count ' + (collection.characters?.length || 0) + ' PNG Clipart and legible text 300 DPI. Make typography premium, polished and readable.'
      : 'Create an illustration-only thumbnail with NO TEXT anywhere. Do not render a title, theme heading, captions, words, letters, numbers, labels, badges, PNG Clipart, DPI specifications, typography or lettering. Theme and character names are visual context only, never text to print. Fill the canvas with artwork; do not reserve a text zone.',
    'Never use third-party shop names, brands, logos, or watermarks.',
    'This is a promotional graphic, not a source for individually editable characters. Make visual elements cohesive.',
    'Target canvas dimensions: ' + width + 'x' + height + ' pixels. Provider may generate a nearby supported size; the editor will resize the result precisely.'
  ].join('\n');
}
