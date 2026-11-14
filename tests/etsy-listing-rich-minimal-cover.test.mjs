import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_MAIN_COVER_CLIPART_COUNT,
  originalAssets, planListingPlacements
} from '../lib/etsy-listing-image-plan.ts';

const api = readFileSync(new URL('../app/api/listing-image-studio/route.ts', import.meta.url),'utf8');
const ui = readFileSync(new URL('../components/etsy-listing-image-studio.tsx', import.meta.url),'utf8');

const assets = Array.from({length:36},(_,i)=>({
  id:'original-'+i,name:'Flower '+i,imageUrl:'/original/flower-'+i+'.png',
  category:['Roses','Leaves','Wildflowers','Bouquets'][i%4]
}));

test('new main cover defaults to 12 unique original collection cliparts, or collection size if smaller',()=>{
  assert.equal(DEFAULT_MAIN_COVER_CLIPART_COUNT,12);
  assert.equal(planListingPlacements(1,assets).length,12);
  assert.equal(new Set(planListingPlacements(1,assets).map(p=>p.assetId)).size,12);
  assert.equal(planListingPlacements(1,assets.slice(0,5)).length,5);
  assert.equal(planListingPlacements(1,assets.slice(0,1)).length,1);
  assert.ok(planListingPlacements(1,assets).every(p=>assets.some(a=>a.id===p.assetId)));
});

test('cover uses focal/medium/accent sizes with a deliberately open center and no repeated slots',()=>{
  const placements=planListingPlacements(1,assets);
  const counts={
    large:placements.filter(p=>p.width>=25),
    medium:placements.filter(p=>p.width>=18&&p.width<25),
    accent:placements.filter(p=>p.width<15)
  };
  assert.deepEqual(Object.fromEntries(Object.entries(counts).map(([k,v])=>[k,v.length])),
    {large:2,medium:4,accent:6});
  assert.equal(new Set(placements.map(p=>p.x+','+p.y)).size,12);
  assert.ok(placements.some(p=>p.x<5));
  assert.ok(placements.some(p=>p.x>=70));
  assert.ok(placements.some(p=>p.y>=75));
  assert.ok(placements.every(p=>p.x>=0&&p.y>=0&&p.x+p.width<=100&&p.y+p.height<=100));
});

test('manual count and exact selection override the new cover default without cloning originals',()=>{
  assert.equal(planListingPlacements(1,assets,{count:7}).length,7);
  assert.equal(planListingPlacements(1,assets,{count:14}).length,14);
  assert.equal(planListingPlacements(1,assets,{count:23}).length,23);
  const chosen=['original-28','original-3','original-20','original-28'];
  assert.deepEqual(planListingPlacements(1,assets,{assetIds:chosen}).map(p=>p.assetId),
    ['original-28','original-3','original-20']);
  assert.equal(originalAssets([...assets,{...assets[0],id:'different-id'}]).length,36);
  assert.ok(planListingPlacements(1,assets,{count:36}).every(p=>p.width>=2&&p.height>=2));
  assert.match(ui,/Recommended \{Math\.min\(DEFAULT_MAIN_COVER_CLIPART_COUNT, assets\.length\)\}-Clipart Cover/);
  assert.match(ui,/!window\.confirm\('Replace the current Main Cover placement/);
  assert.match(ui,/setChanges\(old => \(\{ \.\.\.old, \[step\]: richLayout \}\)\)/);
  assert.match(ui,/Apply layout & save JPG to update the existing background without another image generation/);
});

test('small art-first typography and quiet theme-matched background are default and user overridable',()=>{
  assert.match(api,/TYPOGRAPHY SCALE — COMPACT \(default\)/);
  assert.match(api,/about 14–16% of canvas height/);
  assert.match(api,/subtitle only about 3–5%/);
  assert.match(api,/combined lettering generally below 24%/);
  assert.match(api,/backgroundStyle: 'plain' \| 'minimal' \| 'soft-texture' = 'minimal'/);
  assert.match(api,/BACKGROUND STYLE — MINIMAL \(default\)/);
  assert.match(api,/BACKGROUND STYLE — PLAIN/);
  assert.match(api,/BACKGROUND STYLE — SOFT TEXTURE/);
  assert.match(api,/no strong frames, layered geometries, golden swirls or large decoration/);
  assert.match(api,/Do not enlarge the heading merely to fill empty space/);
  assert.match(api,/two large focal originals, 4 medium supporting originals/);
  assert.match(api,/The actual collection images are NOT provided to you/);
  assert.match(api,/Do NOT generate clipart/);
  assert.match(api,/input\.backgroundStyle \?\? 'minimal'/);
  assert.match(ui,/useState<'plain' \| 'minimal' \| 'soft-texture'>\('minimal'\)/);
  assert.match(ui,/aria-label="Listing background style"/);
  assert.match(ui,/<option value="plain">Plain/);
  assert.match(ui,/<option value="minimal">Minimal/);
  assert.match(ui,/placements: effectivePositions, textScale, backgroundStyle/);
  assert.match(ui,/data-listing-advanced-settings="always-visible"/);
});
