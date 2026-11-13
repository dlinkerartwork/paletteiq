import test from 'node:test';
import assert from 'node:assert/strict';
import { fitClipartAroundTypography, rotatedThumbnailBounds, boxesIntersect, boxOverlapRatio } from '../lib/thumbnail-fit.ts';

const title = { x: 22, y: 26, width: 57, height: 28 };
const subtitle = { x: 24, y: 57, width: 52, height: 12 };
const protectedAreas = [title, subtitle];
const noTextCollision = result => result.every(p => protectedAreas.every(area =>
  !boxesIntersect(rotatedThumbnailBounds(p), area, 3)));

test('fitter moves a large original without covering title or subtitle', () => {
  const clipart = [
    {characterId:'ramen', x: 30, y: 32, width: 34, height: 28, rotation: 2},
    {characterId:'dumplings', x: 5, y: 5, width: 29, height: 25, rotation: -3},
    {characterId:'teapot', x: 71, y: 70, width: 25, height: 24, rotation: 1}
  ];
  const fitted = fitClipartAroundTypography(clipart,[title],[subtitle],{minScale:.55});
  assert.ok(fitted.length >= 2, 'visible collection elements should remain');
  assert.equal(noTextCollision(fitted),true);
  for (const p of fitted) {
    const before = clipart.find(c => c.characterId === p.characterId);
    assert.ok(before);
    assert.ok(Math.abs(p.width / before.width - p.height / before.height) < 0.000001,'no distortion');
    const bounds = rotatedThumbnailBounds(p);
    assert.ok(bounds.x>=1 && bounds.y>=1 && bounds.x+bounds.width<=99 && bounds.y+bounds.height<=99);
  }
});

test('fitter never returns an unsafe original if all canvas is reserved for lettering', () => {
  const one = [{characterId:'ramen',x:25,y:30,width:40,height:40,rotation:0}];
  const fitted = fitClipartAroundTypography(one,[{x:0,y:0,width:100,height:100}],[],{minScale:.6});
  assert.deepEqual(fitted,[]);
});

test('fitter respects catalogue no-overlap and allows controlled editorial overlap', () => {
  const illustrations = [
    {characterId:'a',x:4,y:4,width:30,height:29,rotation:0},
    {characterId:'b',x:24,y:8,width:25,height:25,rotation:0},
    {characterId:'c',x:65,y:65,width:25,height:24,rotation:0}
  ];
  const grid = fitClipartAroundTypography(illustrations,[],[],{grid:true});
  for (let i=0;i<grid.length;i++) for (let j=i+1;j<grid.length;j++)
    assert.equal(boxOverlapRatio(rotatedThumbnailBounds(grid[i]),rotatedThumbnailBounds(grid[j])),0);
  const editorial = fitClipartAroundTypography(illustrations,[],[],{maxArtworkOverlap:.3});
  for (let i=0;i<editorial.length;i++) for (let j=i+1;j<editorial.length;j++)
    assert.ok(boxOverlapRatio(rotatedThumbnailBounds(editorial[i]),rotatedThumbnailBounds(editorial[j])) <= .300001);
});

test('invalid areas are ignored, and protected subtitle has independent clearance', () => {
  const layer = [{characterId:'a',x:20,y:58,width:45,height:16,rotation:0}];
  const fitted = fitClipartAroundTypography(layer,[],[subtitle],{subtitlePadding:4,minScale:.55});
  assert.equal(noTextCollision(fitted),true);
});
