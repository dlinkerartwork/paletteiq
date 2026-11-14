import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listingCreativeDirection, listingCreativeSummary, listingMockupScene } from '../lib/etsy-listing-creative-direction.ts';
import { LISTING_IMAGE_SPECS, LISTING_WIDTH, LISTING_HEIGHT,
  curatedListingHighlights, planListingPlacements, originalAssets } from '../lib/etsy-listing-image-plan.ts';

const route=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const studio=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');

test('v1.1 listing plan uses exact 15-image commercial sequence and 4:3 JPGs', () => {
  assert.equal(LISTING_WIDTH,3000);
  assert.equal(LISTING_HEIGHT,2250);
  assert.equal(LISTING_WIDTH/LISTING_HEIGHT,4/3);
  assert.deepEqual(LISTING_IMAGE_SPECS.map(x=>x.title),[
    'Main Cover','Bundle Overview','Complete Collection','Best Elements','Collection Categories',
    'File Features','Artwork Close-Up','Sticker Sheet Mockup','Apparel Mockup','Accessories Mockup',
    'Packaging & Labels Mockup','Creative Projects Mockup',"What's Included",
    'How to Download & Use','Final Bundle Showcase'
  ]);
  assert.equal(new Set(LISTING_IMAGE_SPECS.map(x=>x.key)).size,15);
});

test('art direction adapts to collection without asking the user to pick a style', () => {
  const floral=listingCreativeDirection({name:'Spring Florals',theme:'Florals & Blossoms',palette:'sage green, coral pink',style:'Watercolor'});
  assert.equal(floral.family,'floral');
  assert.equal(floral.palette,'sage green, coral pink');
  assert.match(listingCreativeSummary(floral),/Soft elegant airy editorial composition/);
  const cute=listingCreativeDirection({name:'Bunny',theme:'Cute Baby Animals',listing:{title:'Baby Bunny Clipart | Art Bundle'}});
  assert.equal(cute.family,'cute');
  assert.equal(cute.title,'Baby Bunny Clipart');
  assert.match(cute.typography,/playful/);
  assert.equal(listingCreativeDirection({name:'Winter Forest',theme:'Winter Woodland'}).family,'seasonal');
  assert.equal(listingCreativeDirection({name:'Vintage Travel',style:'Vintage retro Americana'}).family,'vintage');
  assert.equal(listingCreativeDirection({name:'Black & White',style:'Minimal line art'}).family,'minimal');
  assert.equal(listingCreativeDirection({name:'Japanese Food',style:'Watercolor painted'}).family,'watercolor');
  const fallback=listingCreativeDirection({name:'Abstract Bundle'});
  assert.equal(fallback.family,'classic');
  assert.match(fallback.palette,/light neutral/);
});

test('all 5 mockups are blank, commercial, theme-aware and avoid card-based stationery', () => {
  const floral=listingCreativeDirection({name:'Flowers',theme:'Flowers'}).family;
  const cute=listingCreativeDirection({name:'Bears',theme:'Cute woodland animals'}).family;
  assert.equal(listingMockupScene(8,floral)?.name,'sticker sheet');
  assert.equal(listingMockupScene(9,cute)?.name,'sweatshirt');
  assert.equal(listingMockupScene(9,floral)?.name,'T-shirt');
  assert.equal(listingMockupScene(10,cute)?.name,'mug');
  assert.equal(listingMockupScene(10,floral)?.name,'tote bag');
  assert.equal(listingMockupScene(11,floral)?.name,'packaging label');
  assert.equal(listingMockupScene(12,cute)?.name,'planner DIY spread');
  assert.equal(listingMockupScene(12,floral)?.name,'scrapbook DIY spread');
  for(const step of [8,9,10,11,12]) {
    const scene=listingMockupScene(step,cute);
    assert.ok(scene?.prompt.includes('blank') || scene?.prompt.includes('BLANK'), 'blank surface '+step);
    assert.doesNotMatch(scene?.name||'',/invitation|greeting|wedding|card/i);
  }
  assert.equal(listingMockupScene(13,floral),null);
  assert.match(route,/No greeting cards, invitation cards, wedding stationery or card-based mockups by default/);
});

test('representative hero and best-element sets use diverse real collection IDs', () => {
  const assets=Array.from({length:80},(_,i)=>({
    id:'asset-'+i, name:'Image '+i, imageUrl:'/api/original/'+i,
    category:['Animals','Plants','Food','Objects'][i%4]
  }));
  const hero=curatedListingHighlights(assets,10);
  assert.equal(hero.length,10);
  assert.equal(new Set(hero.map(a=>a.id)).size,10);
  assert.equal(new Set(hero.map(a=>a.category)).size,4);
  assert.ok(hero.some(a=>Number(a.id.split('-')[1])>40));
  assert.equal(planListingPlacements(1,assets).length,10);
  assert.equal(planListingPlacements(4,assets).length,8);
  assert.equal(planListingPlacements(15,assets).length,9);
  for(const step of [1,4,15]) {
    assert.ok(planListingPlacements(step,assets).every(p=>assets.some(a=>a.id===p.assetId)));
  }
  assert.equal(planListingPlacements(2,assets).length,80);
  assert.equal(planListingPlacements(3,assets).length,80);
  assert.equal(originalAssets([...assets, {...assets[0],id:'duplicate'}]).length,80);
});

test('AI writes only backgrounds and types, keeping original composition and verified fact limits', () => {
  assert.match(route,/The actual collection images are NOT provided to you/);
  assert.match(route,/Do NOT generate clipart/);
  assert.match(route,/Never claim PNG, transparency, ZIP contents, DPI, license/);
  assert.match(route,/Only verified count of unique original images is/);
  assert.match(studio,/const file = await compose\(background, layout, assets\)/);
  assert.match(studio,/const url = byId\.get\(p\.assetId\)\?\.imageUrl/);
  assert.match(studio,/ctx\.drawImage\(image, bounds\.sx/);
  assert.match(route,/listingCreativeSummary\(direction\)/);
  assert.match(page,/seoTitle=\{project\.listing\?\.title\}/);
});

test('generate/revise/approve/next persists each independent step and resumes at first unapproved', () => {
  assert.match(studio,/revisionNotes: \(notes\[step\] \?\? current\?\.notes \?\? ''\)\.trim\(\)/);
  assert.match(route,/CURRENT IMAGE REVISION REQUEST from the user/);
  assert.match(route,/typeof input\.revisionNotes === 'string'/);
  assert.match(studio,/setStep\(LISTING_IMAGE_SPECS\.find\(s => !images\.some\(r => r\.number === s\.number && r\.status === 'approved'\)\)\?\.number \|\| 15\)/);
  assert.match(studio,/if \(!precedingApproved\)/);
  assert.match(studio,/if \(status === 'approved' && step < 15\)/);
  assert.match(studio,/Review spelling, crop, verified facts and mockup realism before approving/);
  assert.match(route,/Approve all 15 rendered listing images before exporting/);
});

test('QC warnings save paid backgrounds for manual review rather than silently rejecting them', () => {
  assert.match(route,/let reviewWarning = ''/);
  assert.match(route,/reviewWarning = 'Potential invented art or printed mockup/);
  assert.doesNotMatch(route,/return bad\('AI background contains possible invented art/);
  assert.match(route,/return Response\.json\(\{ backgroundUrl, number: input\.number, width: LISTING_WIDTH, height: LISTING_HEIGHT, reviewWarning \}\)/);
  assert.match(studio,/reviewWarning: response\.reviewWarning \|\| ''/);
  assert.match(studio,/if \(status === 'approved' && current\.reviewWarning &&/);
  assert.match(studio,/Manual quality review required/);
  assert.match(studio,/uploadListingJpg\(/);
  assert.match(studio,/Retry save JPG \(no AI cost\)/);
});
