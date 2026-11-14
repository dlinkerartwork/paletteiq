import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planListingPlacements } from '../lib/etsy-listing-image-plan.ts';
import { fitListingPlacementsToReference, isListingPlacementSafe, heroTextZone, isCentralHero } from '../lib/listing-reference-composition.ts';
import { isListingPlacementTextSafe } from '../lib/listing-text-safe.ts';

const studio = readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const api = readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const images = Array.from({length:15},(_,i)=>({
 id:'original-'+i,name:'Different object '+i,imageUrl:'/api/assets?assetId='+i
}));

test('Hero Cover reserves center title and positions ten distinct PNGs on all four sides',()=>{
 const original=planListingPlacements(1,images);
 const placed=fitListingPlacementsToReference(1,original,true);
 assert.equal(placed.length,10);
 assert.deepEqual(placed.map(p=>p.assetId), original.map(p=>p.assetId));
 assert.ok(placed.every(p=>isListingPlacementSafe(p,1,true)));
 const top=placed.filter(p=>p.y<21), sides=placed.filter(p=>p.x<25||p.x>=75), bottom=placed.filter(p=>p.y>=80);
 assert.ok(top.length>=2,'top band is populated');
 assert.ok(sides.length>=4,'side bands frame the title');
 assert.ok(bottom.length>=2,'bottom band is populated');
 assert.ok(new Set(placed.map(p=>p.width)).size>=2,'clipart scale is not uniform');
});

test('Reference-derived central title protection stays compatible with usable perimeter',()=>{
 const zone=heroTextZone({texts:[{x:21,y:28,width:61,height:63}]});
 assert.ok(zone.x>=24 && zone.x+zone.width<=76);
 assert.ok(zone.y>=21 && zone.y+zone.height<=79);
 const placements=fitListingPlacementsToReference(1,planListingPlacements(1,images),true,
  {texts:[{x:21,y:28,width:61,height:63}]});
 assert.equal(placements.length,10);
 assert.ok(placements.every(p=>isListingPlacementSafe(p,1,true,
  {texts:[{x:21,y:28,width:61,height:63}]})));
});

test('AI Vision placements that are already safe are preserved rather than overwritten',()=>{
 const proposed=fitListingPlacementsToReference(1,planListingPlacements(1,images),true);
 const adjusted=proposed.map((p,i)=>i===0?{...p,width:p.width-2}:p);
 assert.deepEqual(fitListingPlacementsToReference(1,adjusted,true),adjusted);
});

test('Bundle Overview and non-hero pages retain top-safe gallery placement',()=>{
 assert.equal(isCentralHero(2,true),false);
 const placed=fitListingPlacementsToReference(2,planListingPlacements(2,images),true);
 assert.equal(placed.length,images.length);
 assert.ok(placed.every(p=>isListingPlacementTextSafe(p)));
 assert.ok(placed.every(p=>p.y>=38));
});

test('Hero with no selected reference retains top-title configuration',()=>{
 assert.equal(isCentralHero(1,false),false);
 const placed=fitListingPlacementsToReference(1,planListingPlacements(1,images),false);
 assert.ok(placed.every(p=>isListingPlacementTextSafe(p)));
});

test('actual image generation prompt and Vision pipeline honor reference-centered hero composition',()=>{
 assert.match(api,/REFERENCE-LED CENTRAL HERO COMPOSITION/);
 assert.match(api,/THIS IS NOT A TOP-HEADING GRID/);
 assert.match(api,/HERO COVER ART DIRECTION/);
 assert.match(api,/MATCH THIS REFERENCE SPATIAL COMPOSITION/);
 assert.match(api,/CENTERED REFERENCE HERO/);
 assert.match(api,/fitListingPlacementsToReference\(input.number,candidates,hero,input.referenceDesign\)/);
 assert.match(studio,/fitListingPlacementsToReference\(step,positions,Boolean\(config.referenceImage\),styleTokens\)/);
 assert.match(studio,/compositionMode:.*'hero-center'/);
 assert.match(studio,/protectedTextZone:/);
 assert.match(studio,/isListingPlacementSafe\(p,step/);
});
