import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planListingPlacements } from '../lib/etsy-listing-image-plan.ts';
import {
  fitListingPlacementsToReference, isListingPlacementSafe,
  referenceTextZones, heroTextZone
} from '../lib/listing-reference-composition.ts';
import { isListingPlacementTextSafe } from '../lib/listing-text-safe.ts';

const studio = readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const api = readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const images = Array.from({length:15},(_,i)=>({
 id:'original-'+i,name:'Distinct original '+i,imageUrl:'/api/assets?assetId='+i
}));
const originals = planListingPlacements(1,images);
const geometry = [
 {x:2,y:2,width:28,height:24},{x:35,y:2,width:28,height:24},
 {x:69,y:2,width:29,height:24},{x:2,y:32,width:26,height:24},
 {x:72,y:32,width:26,height:24},{x:2,y:64,width:26,height:24},
 {x:72,y:64,width:26,height:24},{x:2,y:89,width:29,height:10},
 {x:35,y:89,width:28,height:10},{x:69,y:89,width:29,height:10}
];

test('reference upper title is protected where it actually appears',()=>{
 const ref={texts:[{x:28,y:2,width:44,height:18}],
   slots:geometry.filter(s=>s.y>=32)};
 const zones=referenceTextZones(ref);
 assert.equal(zones.length,1);
 assert.ok(zones[0].y<=2);
 const fitted=fitListingPlacementsToReference(1,originals,true,ref);
 assert.equal(fitted.length,originals.length);
 assert.ok(fitted.every(p=>isListingPlacementSafe(p,1,true,ref)));
});

test('reference lower title is protected, and PNGs can appear above it',()=>{
 const ref={texts:[{x:17,y:76,width:66,height:20}],
   slots:geometry.filter(s=>s.y<64)};
 const fitted=fitListingPlacementsToReference(1,originals,true,ref);
 assert.equal(fitted.length,originals.length);
 assert.ok(fitted.some(p=>p.y<30),'artwork appears above reference bottom headline');
 assert.ok(fitted.every(p=>isListingPlacementSafe(p,1,true,ref)));
});

test('reference side headline does not become a fixed top or center title',()=>{
 const ref={texts:[{x:2,y:15,width:25,height:60}],
   slots:geometry.filter(s=>s.x>30)};
 const fitted=fitListingPlacementsToReference(1,originals,true,ref);
 assert.equal(fitted.length,originals.length);
 assert.ok(fitted.every(p=>isListingPlacementSafe(p,1,true,ref)));
 const union=heroTextZone(ref);
 assert.ok(union.x<10);
 assert.ok(union.width<40);
});

test('separated reference text boxes protect each box independently',()=>{
 const ref={texts:[{x:4,y:5,width:35,height:12},{x:54,y:70,width:39,height:11}]};
 assert.equal(referenceTextZones(ref).length,2);
 const clear={assetId:'one',x:42,y:42,width:15,height:12,rotation:0};
 assert.equal(isListingPlacementSafe(clear,1,true,ref),true);
 assert.equal(isListingPlacementSafe({...clear,x:10,y:7},1,true,ref),false);
});

test('safe Vision-generated coordinates are retained when preserveSafe is requested',()=>{
 const ref={texts:[{x:28,y:28,width:44,height:37}],slots:geometry};
 const safe=fitListingPlacementsToReference(1,originals,true,ref);
 assert.equal(safe.length,originals.length);
 assert.deepEqual(fitListingPlacementsToReference(1,safe,true,ref,true),safe);
});

test('no reference still uses the standard protected top text band',()=>{
 const placed=fitListingPlacementsToReference(2,planListingPlacements(2,images),false);
 assert.ok(placed.every(p=>isListingPlacementTextSafe(p)));
});

test('prompt never forces center or top when a reference is selected',()=>{
 assert.match(api,/REFERENCE-DRIVEN TYPOGRAPHY/);
 assert.match(api,/Text may appear at the top, center, bottom, sides, or multiple locations/);
 assert.match(api,/referenceTextZones\(input.referenceDesign\)/);
 assert.match(studio,/fitListingPlacementsToReference\(step,vision.placements,Boolean\(config.referenceImage\),styleTokens,true\)/);
 assert.match(studio,/compositionMode: config.referenceImage \? 'reference-guided'/);
 const provider=studio.indexOf('>VISION PROVIDER</span>');
 const vision=studio.indexOf('>VISION MODEL</span>');
 const image=studio.indexOf('>OPENAI BACKGROUND GENERATION MODEL</span>');
 assert.ok(provider>0 && provider<vision && vision<image);
 assert.ok(vision-provider<1100,'Vision Model should be directly adjacent to Vision Provider');
 assert.match(studio,/className="listing-vision-pair"/);
 assert.match(studio,/gridTemplateColumns:'repeat\(2,minmax\(0,1fr\)\)'/);
});
