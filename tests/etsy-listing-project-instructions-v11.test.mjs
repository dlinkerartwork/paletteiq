import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LISTING_IMAGE_SPECS,LISTING_WIDTH,LISTING_HEIGHT,
  listingImageTextDefaultsForStep,listingFilename} from '../lib/etsy-listing-image-plan.ts';
import {aiFirstConceptPrompt,aiFirstListingPrompt} from '../lib/etsy-listing-ai-first.ts';
const studio=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const route=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const designer=readFileSync(new URL('../components/thumbnail-designer.tsx',import.meta.url),'utf8');
const sample={
  theme:'Woodland Christmas',style:'Vintage watercolor storybook',palette:'forest green and cranberry',
  title:'Woodland Christmas',subtitle:'CLIPART BUNDLE',badge:'80 PNGs',
  selectedCount:80,collectionCount:80,
  sourceAssets:[{name:'christmas fox',category:'Woodland Animals'},{name:'pinecone wreath',category:'Winter Decor'}],
  observedSourceStyle:'Actual originals: translucent watercolor, warm cream with forest-green shading'
};

test('v1.1 uses fixed 15-tile square JPG plan, not a Thumbnail Designer replacement',()=>{
  assert.equal(LISTING_IMAGE_SPECS.length,15);
  assert.equal(LISTING_WIDTH,1024);
  assert.equal(LISTING_HEIGHT,1024);
  assert.equal(listingFilename(1),'01_Main_Cover.jpg');
  assert.equal(listingFilename(15),'15_Final_Showcase.jpg');
  assert.match(studio,/<h2>Etsy Clipart Listing Studio<\/h2>/);
  assert.match(studio,/Approve all preceding listing images before generating this one/);
  assert.match(studio,/const precedingApproved = LISTING_IMAGE_SPECS\.slice\(0, step - 1\)/);
  assert.match(studio,/Export 15 approved JPGs as ZIP/);
  assert.doesNotMatch(designer,/aiFirstListingPrompt|listingImageTextDefaultsForStep/);
});

test('only Main Cover inherits SEO keywords; supporting tiles get short purpose-led labels',()=>{
  const listing={title:'80 Christmas Woodland Watercolor Clipart PNGs | Cute Fox Forest Animals',
    primaryKeyword:'Christmas Woodland Clipart'};
  const cover=listingImageTextDefaultsForStep(1,listing,'Woodland Christmas');
  assert.equal(cover.title,listing.title);
  assert.equal(cover.subtitle,listing.primaryKeyword);
  for(let n=2;n<=15;n++){
    const defaults=listingImageTextDefaultsForStep(n,listing,'Woodland Christmas');
    assert.equal(defaults.title,LISTING_IMAGE_SPECS[n-1].headline);
    assert.equal(defaults.subtitle,'');
    assert.equal(defaults.badge,'');
    assert.notEqual(defaults.title,cover.title);
  }
  assert.throws(()=>listingImageTextDefaultsForStep(16,listing,'woodland'));
  assert.match(studio,/const imageTextDefaults=listingImageTextDefaultsForStep\(step,/);
  assert.match(studio,/\{step === 1 && <div/);
  assert.match(studio,/Reset to \{step === 1 \? 'Etsy SEO' : 'image type'\} text defaults/);
  assert.match(route,/listingImageTextDefaultsForStep\(input\.number,/);
});

test('Main Cover follows the uploaded five-point quality checklist without hard 12-object limit',()=>{
  const cover=aiFirstConceptPrompt(sample);
  assert.match(cover,/approximately 6–12 standout source illustrations/);
  assert.match(cover,/not a hard object limit/);
  assert.match(cover,/product is immediately recognizable/);
  assert.match(cover,/title readable when reduced/);
  assert.match(cover,/most appealing illustrations/);
  assert.match(cover,/without clutter/);
  assert.match(cover,/accurately represent the supplied references/);
  assert.match(cover,/Clean Commercial/);
  assert.match(cover,/OBSERVED|Actual source artwork style observed/);
  assert.match(cover,/Never invent or imply unverified asset counts/);
  assert.match(aiFirstListingPrompt(1,sample),/Final cover quality checklist/);
});

test('collection overview/detail/information uses verified source facts, not invented claims',()=>{
  for (const n of [2,3,4,5]) {
    assert.match(aiFirstListingPrompt(n,sample),/COLLECTION PRESENTATION POLICY/);
    assert.match(aiFirstListingPrompt(n,sample),/minimal duplicates/);
  }
  for (const n of [6,7,13]) {
    assert.match(aiFirstListingPrompt(n,sample),/VERIFIED PRODUCT DATA/);
    assert.match(aiFirstListingPrompt(n,sample),/Never invent asset counts|Never invent|Never invent.*claims/);
    assert.match(aiFirstListingPrompt(n,sample),/If a claim is uncertain, OMIT it/);
  }
  assert.match(aiFirstListingPrompt(14,sample),/download workflow|digital-download workflow/i);
  assert.match(aiFirstListingPrompt(15,sample),/visually cohesive/i);
});

test('mockup instructions prefer general-purpose products and prohibit default greeting/invitation cards',()=>{
  for(const n of [8,9,10,11,12]){
    const prompt=aiFirstListingPrompt(n,sample);
    assert.match(prompt,/GENERAL-PURPOSE MOCKUP POLICY/);
    assert.match(prompt,/DO NOT use greeting cards, invitation cards, wedding stationery/);
    assert.match(prompt,/physical mockup product is NOT included in the digital bundle/i);
  }
  const craft=aiFirstListingPrompt(12,sample);
  assert.match(craft,/scrapbook, planner spread or practical DIY craft/);
  assert.doesNotMatch(craft,/Show an appealing scrapbook, planner spread, invitation or DIY/);
  assert.match(aiFirstListingPrompt(10,sample),/ceramic mug or tumbler/);
  assert.match(aiFirstListingPrompt(11,sample),/product label, packaging tag, box or paper wrap/);
});

test('supporting prompts continue approved Main Cover style, keep distinct compositions',()=>{
  const prompt=aiFirstListingPrompt(5,{...sample,approvedCoverStyle:'Main Cover approved, cream storybook lettering and green/red palette'});
  assert.match(prompt,/VISUAL CONTINUITY: Main Cover was approved/);
  assert.match(prompt,/cream storybook lettering and green\/red palette/);
  assert.match(prompt,/DIFFERENT composition/);
  assert.match(route,/function studioV11Context\(project: StoredProject, number: number\)/);
  assert.doesNotMatch(route,/approved-main-cover-style-reference-ONLY\.jpg/);
  assert.match(route,/NEVER pass approved Main Cover pixels as an input image/);
  assert.match(route,/aiFirstLayoutArchetype\(input\.number\)/);
  assert.match(route,/detailedOriginalReferencesIncluded/);
  assert.match(route,/LISTING_IMAGE_SPECS\.slice\(0,input\.number-1\)/);
});

test('v1.1 final critique distinguishes 15 image purposes and single-layer vs exact PNG editing',()=>{
  assert.match(route,/PROJECT INSTRUCTIONS v1\.1: Examine listing image/);
  assert.match(route,/COVER CHECKLIST/);
  assert.match(route,/COLLECTION IMAGE CHECKLIST/);
  assert.match(route,/PRODUCT FACT CHECKLIST/);
  assert.match(route,/GENERAL-PURPOSE MOCKUP CHECKLIST/);
  assert.match(route,/CLOSING\/INFORMATION CHECKLIST/);
  assert.match(route,/record\.aiGeneratedFullCover\s*\? 'Up to THREE/);
});
