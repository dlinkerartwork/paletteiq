import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listingImageTextDefaults } from '../lib/etsy-listing-image-plan.ts';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const client=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const backend=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const plan=readFileSync(new URL('../lib/etsy-listing-image-plan.ts',import.meta.url),'utf8');

test('new per-image inputs default exactly to saved Etsy SEO title and primary keyword',()=>{
  const defaults=listingImageTextDefaults({ title:'Winter Woodland Clipart Digital Download | 80 Animals', primaryKeyword:'winter woodland watercolor animals' },'Collection Name');
  assert.deepEqual(defaults,{
    title:'Winter Woodland Clipart Digital Download | 80 Animals',
    subtitle:'winter woodland watercolor animals',
    badge:''
  });
  assert.equal(listingImageTextDefaults(undefined,'My Collection').title,'My Collection');
  assert.equal(listingImageTextDefaults(undefined,'My Collection').subtitle,'');
  assert.match(page,/primaryKeyword=\{project\.listing\?\.primaryKeyword\}/);
  assert.match(page,/seoTitle=\{project\.listing\?\.title\}/);
  assert.match(client,/listingImageTextDefaults\(\{ title: seoTitle, primaryKeyword \}, artDirection\.title\)/);
  for(const [label,field] of [['Listing image title','title'],['Listing image subtitle','subtitle'],['Listing image badge','badge']]){
    assert.ok(client.includes('aria-label="'+label+'"'),label);
    assert.match(client,new RegExp('value=\\{currentLettering\\.'+field+'\\}'));
    assert.match(client,new RegExp("editLettering\\('"+field+"', e\\.target\\.value\\)"));
  }
  assert.match(client,/Reset text to Etsy SEO defaults/);
});

test('every generate sends editable exact wording to the server and persists it per step',()=>{
  assert.match(client,/title: lettering\.title, subtitle: lettering\.subtitle, badge: lettering\.badge/);
  assert.match(client,/title: lettering\.title, subtitle: lettering\.subtitle,\s+badge: lettering\.badge/);
  assert.match(backend,/text: ListingImageText/);
  assert.match(backend,/title: typeof input\.title === 'string' \? sanitizedText\(input\.title, 140\)/);
  assert.match(backend,/subtitle: typeof input\.subtitle === 'string' \? sanitizedText\(input\.subtitle, 140\)/);
  assert.match(backend,/badge: typeof input\.badge === 'string' \? sanitizedText\(input\.badge, 60\)/);
  assert.match(backend,/Render EXACT user-supplied MAIN TITLE/);
  assert.match(backend,/Render EXACT user-supplied SUBTITLE/);
  assert.match(backend,/Render this OPTIONAL BADGE/);
  assert.match(backend,/NO BADGE: do not invent a badge/);
  assert.match(backend,/Invalid ' \+ key/);
  assert.match(plan,/title\?: string; subtitle\?: string; badge\?: string/);
  assert.match(backend,/title, subtitle, badge, notes:/);
});

test('edits after generated AI lettering require regeneration before rerender or approve',()=>{
  assert.match(client,/const letteringDirty = Boolean\(current\?\.backgroundUrl/);
  assert.match(client,/if \(letteringDirty\) return setMessage\('Title, Subtitle, or Badge changed/);
  assert.match(client,/if \(letteringDirty\) return setMessage\('Title, Subtitle, or Badge changed\. Regenerate the AI artwork/);
  assert.match(client,/disabled=\{!current\?\.renderedImageUrl \|\| !!working \|\| letteringDirty/);
});

test('Reject & Delete is a confirmed action restricted to the selected stored listing image',()=>{
  assert.match(client,/const rejectAndDelete = async \(\)/);
  assert.match(client,/window\.confirm\('Reject & permanently delete generated Image '/);
  assert.match(client,/action: 'reject', projectId, number: step/);
  assert.match(client,/result\.deleted/);
  assert.match(client,/setLetteringChanges\(old => \{ const next = \{ \.\.\.old \}; delete next\[step\]/);
  assert.match(client,/setChanges\(old => \{ const next = \{ \.\.\.old \}; delete next\[step\]/);
  assert.match(client,/setNotes\(old => \{ const next = \{ \.\.\.old \}; delete next\[step\]/);
  assert.match(client,/Reject &amp; Delete/);
  assert.match(backend,/action\?: 'generate' \| 'save' \| 'layout' \| 'reject'/);
  assert.match(backend,/if \(input\.action === 'reject'\)/);
  assert.match(backend,/const rejected = existing\.find\(item => item\.number === number\)/);
  assert.match(backend,/project\.listingImages = existing\.filter\(item => item\.number !== number\)/);
  assert.match(backend,/getDb\(\)\.update\(projects\)/);
  assert.match(backend,/const stillInUse = JSON\.stringify\(project\)/);
  assert.match(backend,/savedAssetKey\(url, project\.id, owner\)/);
  assert.match(backend,/await storage\.delete\(key\)/);
  assert.match(backend,/warning: errors\.length/);
  assert.match(backend,/return Response\.json\(\{ \.\.\.result, deleted: true \}\)/);
  assert.doesNotMatch(backend,/project\.characters = \[\]/);
});

test('rejection does not discard batch integrity: independent approvals, 1024 format and 15 images',()=>{
  assert.match(backend,/const existing = normalizedImages\(project\)/);
  assert.match(backend,/project\.listingImages = existing\.filter/);
  assert.match(client,/const approved = LISTING_IMAGE_SPECS\.filter/);
  assert.match(backend,/Approve all 15 square 1024 × 1024 JPG listing images before exporting/);
  assert.match(client,/width: LISTING_WIDTH, height: LISTING_HEIGHT/);
});
