import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  curatedListingHighlights, planListingPlacements, originalAssets, LISTING_IMAGE_SPECS
} from '../lib/etsy-listing-image-plan.ts';

const ui=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const api=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');

const images=Array.from({length:120},(_,index)=>({
  id:'art-'+index,name:'Original '+index,
  imageUrl:'/api/original/'+index+'.png',
  category:['Flowers','Leaves','Bouquets','Decor'][index%4]
}));

test('every listing stage permits a user-chosen count of original assets, not a fixed 7-item cap',()=>{
  assert.equal(LISTING_IMAGE_SPECS.length,15);
  for(const spec of LISTING_IMAGE_SPECS){
    assert.equal(planListingPlacements(spec.number,images,{count:3}).length,3,'image '+spec.number);
    assert.equal(planListingPlacements(spec.number,images,{count:17}).length,17,'image '+spec.number);
    assert.equal(new Set(planListingPlacements(spec.number,images,{count:17}).map(p=>p.assetId)).size,17);
    assert.equal(planListingPlacements(spec.number,images,{count:120}).length,120);
  }
  assert.equal(planListingPlacements(1,images).length,12,'new art-first cover defaults to 12; saved individual pre-layouts remain untouched');
  assert.equal(planListingPlacements(2,images).length,120,'bundle overview still includes every original by default');
  assert.equal(planListingPlacements(3,images).length,120,'complete collection still includes every original by default');
  assert.equal(planListingPlacements(15,images).length,9,'finale default is unchanged');
});

test('exact user-checked source IDs are preserved, without duplicates or invented assets',()=>{
  const chosen=['art-44','art-91','art-12','art-44','not-a-real-id'];
  const placements=planListingPlacements(1,images,{assetIds:chosen});
  assert.deepEqual(placements.map(p=>p.assetId),['art-44','art-91','art-12']);
  assert.equal(planListingPlacements(7,images,{assetIds:['art-70']}).length,1);
  assert.equal(planListingPlacements(1,images,{assetIds:['art-70'],count:1})[0].assetId,'art-70');
  assert.equal(planListingPlacements(1,images,{count:200}).length,120);
  assert.equal(planListingPlacements(1,images,{count:0}).length,1);
  assert.ok(planListingPlacements(1,images,{count:20}).some(p=>p.assetId==='art-60'||p.assetId==='art-59'));
  assert.equal(originalAssets(images).length,120);
  assert.equal(curatedListingHighlights(images,120).length,120);
});

test('dense cover layout does not reuse the same seven positions for more assets',()=>{
  const large=planListingPlacements(1,images,{count:18});
  assert.equal(large.length,18);
  assert.equal(new Set(large.map(p=>p.x+','+p.y)).size,large.length);
  assert.ok(large.some(p=>p.x<=3));
  assert.ok(large.some(p=>p.x>=70));
  assert.ok(large.some(p=>p.y>=75));
  assert.ok(large.every(p=>p.width>0&&p.height>0));
});

test('real UI has per-image count, visual asset picker, multi-select, add/remove and free re-render',()=>{
  assert.match(ui,/aria-label="Number of listing cliparts"/);
  assert.match(ui,/min=\{1\} max=\{assets\.length\}/);
  assert.match(ui,/changeArtworkCount\(Number\(e\.target\.value\)\)/);
  assert.match(ui,/Auto Select \(\{positions\.length\}\)/);
  assert.match(ui,/Select Cliparts/);
  assert.match(ui,/visibleAssetChoices\.map\(asset =>/);
  assert.match(ui,/type="checkbox" aria-label=\{'Include ' \+ asset\.name\}/);
  assert.match(ui,/toggleArtwork\(asset\.id, e\.target\.checked\)/);
  assert.match(ui,/Remove Selected Clipart/);
  assert.match(ui,/const changeArtworkSelection = \(ids: string\[\], preservePositions = true\)/);
  assert.match(ui,/const previous = new Map\(positions\.map\(p => \[p\.assetId, p\]\)\)/);
  assert.match(ui,/const next = planned\.map\(p => preservePositions \? previous\.get\(p\.assetId\) \|\| p : p\)/);
  assert.match(ui,/Apply layout & save JPG/);
  assert.match(ui,/selectedAssetIds\.slice\(0, count\)/);
  assert.match(ui,/featuredCount: effectivePositions\.length/);
});

test('Auto Arrange uses actual background Vision, with larger-count fallback and critique feedback',()=>{
  assert.match(ui,/const autoArrangeArtwork = async \(\)/);
  assert.match(ui,/positions\.length > 24/);
  assert.match(ui,/action:'layout', projectId, number:step, backgroundUrl:current\.backgroundUrl/);
  assert.match(ui,/critiqueFeedback: current\.finalReview\?\.improvements\.join\('; '\)/);
  assert.match(api,/input\.critiqueFeedback \? 'FINAL-COMPOSITION REVIEW FEEDBACK/);
  assert.match(api,/p\.x>=0 && p\.y>=0/);
  assert.match(api,/Return each listed assetId EXACTLY ONCE/);
});

test('generator respects user count, does not redraw images and prioritizes coherent handmade creative typography',()=>{
  assert.match(api,/featuredCount\?: number/);
  assert.match(api,/selectedArtworkCount: input\.featuredCount/);
  assert.match(api,/project\.selectedArtworkCount \|\| DEFAULT_MAIN_COVER_CLIPART_COUNT/);
  assert.match(api,/MERCHANDISING HIERARCHY/);
  assert.match(api,/original collection artwork is the product and must remain prominent/);
  assert.match(api,/Never claim PNG, transparency/);
  assert.match(api,/The actual collection images are NOT provided to you/);
});

test('final review analyzes actual composited JPG and provides detailed subjective score',()=>{
  assert.match(api,/async function critiqueFinalImage\(project: StoredProject, number: number, owner: string\)/);
  assert.match(api,/savedAssetKey\(imageUrl,project\.id,owner\)/);
  assert.match(api,/new Uint8Array\(await saved\.arrayBuffer\(\)\)/);
  assert.match(api,/data:image\/jpeg;base64,/);
  assert.match(api,/after all real source PNG cliparts have been composited/i);
  assert.match(api,/Assess strictly as a 128px Etsy search thumbnail/);
  assert.match(api,/headline readability 30%/);
  assert.match(api,/artwork prominence 20%/);
  assert.match(api,/score:rate\(parsed\.score\)/);
  assert.match(api,/serverReview\.analyzedImageUrl/);
  assert.match(api,/current image|saved JPG changed during review/i);
  assert.match(api,/if \(input\.action === 'critique'\)/);
  assert.match(api,/if \(serverReview && serverReview\.analyzedImageUrl === normalized\.renderedImageUrl\)/);
  assert.match(api,/Client-provided ratings are never trusted/);
});

test('quality recommendations are shown but the user can approve deliberately',()=>{
  assert.match(ui,/data-final-design-critique="true"/);
  assert.match(ui,/current\.finalReview\.score < 8\.5/);
  assert.match(ui,/Approve anyway\?/);
  assert.match(ui,/current\.finalReview\.improvements\.map/);
  assert.match(ui,/artworkProminence\.toFixed\(1\)/);
  assert.match(ui,/Automaticall?y critique|Automatically critique/);
  assert.match(ui,/aria-label="Automatically critique final JPG"/);
  assert.match(ui,/const recheckFinalQuality = async \(\)/);
  assert.match(ui,/action: 'critique', projectId, number: step/);
  assert.match(ui,/if \(autoFinalCritique\)/);
  assert.match(ui,/Use AI Suggestions as Revision Notes/);
  assert.match(ui,/Final Vision critique unavailable; inspect the result manually/);
  assert.match(ui,/Additional paid Vision API request|additional paid Vision API request/);
});
