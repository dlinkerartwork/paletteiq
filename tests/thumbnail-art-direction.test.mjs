import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const planner = readFileSync(new URL('../app/api/thumbnail-art-direction/route.ts', import.meta.url),'utf8');
const designer = readFileSync(new URL('../components/thumbnail-designer.tsx', import.meta.url),'utf8');
const generator = readFileSync(new URL('../app/api/thumbnail-ai-image/route.ts', import.meta.url),'utf8');

test('AI positioning is restricted to saved original collection images, not invented assets', () => {
  assert.match(planner,/collection\.characters/);
  assert.match(planner,/filter\(c => !!c\.imageUrl\)/);
  assert.match(planner,/allowed\.has\(item\.characterId\)/);
  assert.match(planner,/used\.has\(item\.characterId\)/);
  assert.match(planner,/assetSource:'original'/);
  assert.match(designer,/source: 'original'/);
});

test('AI planner checks text collision, rotated bounds and intersections with other clipart', () => {
  assert.match(planner,/const box = bounds\(slot\)/);
  assert.match(planner,/collides\(box,titleArea,5\)/);
  assert.match(planner,/placed\.some\(p => collides\(box,bounds\(p\),2\)\)/);
});

test('One-click batch uses AI layout positions and background with AI lettering and badges', () => {
  assert.match(designer,/fetch\('\/api\/thumbnail-art-direction'/);
  assert.match(designer,/plan\.slots\.map\(position =>/);
  assert.match(designer,/layout: plannedElements\.map/);
  assert.match(generator,/INCLUDES artistic typography, tasteful ornamental badges/);
  assert.match(generator,/DO NOT draw any clipart subjects/);
});
