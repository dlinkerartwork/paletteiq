import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const route=readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');
const studio=readFileSync(new URL('../components/etsy-listing-image-studio.tsx',import.meta.url),'utf8');
const plan=readFileSync(new URL('../lib/etsy-listing-image-plan.ts',import.meta.url),'utf8');

test('overlap and repeated clipart are review warnings, not fatal save errors',()=>{
  const prepared=route.slice(route.indexOf('function preparedRecord('),route.indexOf('async function updateImage('));
  assert.match(prepared,/const reviewWarnings: string\[\] = \[\]/);
  assert.match(prepared,/reviewWarnings\.push\('Some original clipart appears more than once/);
  assert.match(prepared,/reviewWarnings\.push\('Some clipart may overlap or extend into text areas/);
  assert.doesNotMatch(prepared,/throw Error\('Clipart must be distinct/);
  assert.match(prepared,/compositionMode, protectedTextZone, protectedTextZones, reviewWarnings/);
  assert.match(prepared,/throw Error\('One or more clipart files are missing/);
  assert.match(prepared,/if \(status === 'approved' && \(!renderedImageUrl \|\| !placements\.length\)\)/);
});

test('frontend renders and uploads JPG draft even when visual checks recommend a revision',()=>{
  const render=studio.slice(studio.indexOf('const renderAndSave = async'),studio.indexOf('const generate = async'));
  assert.match(render,/if \(!layout\.length\)/);
  assert.match(render,/const reviewWarnings: string\[\] = \[\]/);
  assert.match(render,/const file = await compose\(background, layout, assets\)/);
  assert.match(render,/status: 'draft'/);
  assert.match(render,/reviewWarnings, notes: info/);
  assert.doesNotMatch(render,/throw Error\('One or more original PNGs overlap/);
  assert.match(studio,/Draft saved — suggested revisions/);
  assert.match(studio,/current\.reviewWarnings\.map/);
  assert.match(studio,/review\('needs_revision'\)/);
  assert.match(studio,/Apply layout & save JPG \(no AI cost\)/);
});

test('saved collection schema supports review warnings without changing generated artwork',()=>{
  assert.match(plan,/reviewWarnings\?: string\[\]/);
  assert.match(studio,/await compose\(background, layout, assets\)/);
});
