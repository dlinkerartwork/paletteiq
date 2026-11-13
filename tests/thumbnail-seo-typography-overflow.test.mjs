import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { thumbnailSeoDefaults } from '../lib/thumbnail-seo-defaults.ts';
import { buildThumbnailDesignBrief } from '../lib/thumbnail-design-brief.ts';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const designer = readFileSync(new URL('../components/thumbnail-designer.tsx', import.meta.url), 'utf8');
const endpoint = readFileSync(new URL('../app/api/thumbnail-ai-image/route.ts', import.meta.url), 'utf8');

test('new thumbnail cover uses saved Etsy SEO title and keyword instead of source listing title', () => {
  const seo = thumbnailSeoDefaults({
    title: 'Japanese Food & Café Watercolor Clipart | Printable Digital Art',
    primaryKeyword: 'Japanese Food Watercolor Clipart',
    categorySuggestion: 'Clipart Bundles'
  }, 'Old Collection Name');
  assert.equal(seo.title, 'Japanese Food & Café Watercolor Clipart');
  assert.equal(seo.subtitle, 'Japanese Food Watercolor Clipart');
  assert.equal(seo.hasSeoTitle, true);
  assert.equal(seo.hasSeoSubtitle, true);
  assert.match(page, /seoListing=\{project\.listing\}/);
  assert.match(designer, /newDesign\(designs\.length \+ 1, seoDefaults\)/);
  assert.match(designer, /packHeadline: seo\.title, packSubtitle: seo\.subtitle/);
  assert.match(designer, /Use SEO defaults from Etsy Listing Draft/);
});
test('missing SEO never invents file specs and uses safe collection fallback', () => {
  assert.deepEqual(thumbnailSeoDefaults(undefined, 'Winter Woodland Animals'), {
    title: 'Winter Woodland Animals', subtitle: 'Digital Clipart Collection',
    hasSeoTitle: false, hasSeoSubtitle: false
  });
  assert.equal(thumbnailSeoDefaults({title:'Themed Clipart',primaryKeyword:'Themed Clipart',categorySuggestion:'Digital Designs'},'Fallback').subtitle,'Digital Designs');
  assert.ok(thumbnailSeoDefaults({title:'Long '.repeat(50)},'Fallback').title.length <= 100);
});
test('AI typography checkbox is enabled by default and gates all three text fields', () => {
  assert.match(designer, /packAiTypographyEnabled: true/);
  assert.match(designer, /packAiTypographyEnabled !== false/);
  assert.match(designer, /aria-label="Enable AI typography" type="checkbox" checked=\{typographyEnabled\}/);
  for(const label of ['Canvas main title','Canvas subtitle','Canvas badge text']) {
    const line=designer.split('\n').find(x=>x.includes('aria-label="'+label+'"'));
    assert.ok(line?.includes('disabled={aiBusy || !typographyEnabled}'),label);
  }
  assert.match(designer, /const hasLettering = enabled && Boolean\(heading \|\| subtitle \|\| badge\)/);
  assert.match(designer, /mode: hasLettering \? 'background-with-typography' as const : 'background-only' as const/);
});
test('background-only brief contains absolutely no old SEO text when checkbox is disabled', () => {
  const source = {
    layoutMode:'manual', scope:'single', slide:'Custom', headline:'Secret SEO words',
    subtitle:'Secret subtitle', badge:'SEO badge', typography:'editable',
    textDisabled:true, boldness:'bold', hierarchy:'dramatic',
    coverStyle:'watercolor', quality:'medium', backgroundStyle:'watercolor',
    intensity:'balanced', referenceInterpretation:'similar', hasReference:false,
    analysisProvider:'openai', analysisModel:'gpt-4.1-mini', imageModel:'gpt-image-1-mini'
  };
  const prompt=buildThumbnailDesignBrief(source);
  assert.match(prompt,/ZERO text or pseudo-text/);
  assert.match(prompt,/no title, subtitle or badge|no title, subtitle or badge|do not generate any words/i);
  assert.doesNotMatch(prompt,/Secret SEO words|Secret subtitle|SEO badge/);
  assert.match(endpoint,/textDisabled: mode === 'background-only'/);
  assert.match(endpoint,/NO title, NO subtitle, NO badge/);
  assert.match(endpoint,/FINAL STRICT RULE: ABSOLUTELY NO TEXT/);
});
test('partially off-canvas PNGs are permitted and only visible rectangles are sent to background AI', () => {
  assert.doesNotMatch(designer,/All original clipart layers must fit fully within the canvas/);
  assert.match(designer,/const hasVisibleAsset = imageLayers\.some/);
  assert.match(designer,/const overlapsType = hasLettering && imageLayers\.some/);
  assert.match(designer,/source: 'original' as const/);
  assert.match(endpoint,/x: Math\.max\(-100, Math\.min\(200/);
  assert.match(endpoint,/const visibleLayout = layout\.filter/);
  assert.match(endpoint,/JSON\.stringify\(visibleLayout\)/);
  assert.match(designer,/Clipart may bleed beyond the frame/);
});
test('AI lettering is artistically directed, optionally curved or hand-painted, without changing exact source assets', () => {
  assert.match(designer,/Artistic lettering composition/);
  assert.match(designer,/Arched &amp; curved lettering/);
  assert.match(designer,/Flowing brush calligraphy/);
  assert.match(designer,/packLetteringStyle: source\.packLetteringStyle \|\| 'auto'/);
  assert.match(endpoint,/const artisticStyles: Record<string, string>/);
  assert.match(endpoint,/not typed with a rigid stock font/);
  assert.match(endpoint,/Arched, curved, flowing, gently waved, offset, or layered typography/);
  assert.match(endpoint,/Do not draw a visual depiction of the title words/);
});
