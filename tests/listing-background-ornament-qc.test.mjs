import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const route = readFileSync(new URL('../app/api/listing-image-studio/route.ts',import.meta.url),'utf8');

test('generation prompt forbids themed original-asset imitations but allows integrated abstract decoration',()=>{
  assert.match(route,/CRITICAL ASSET SEPARATION/);
  assert.match(route,/NO cars, buses, caravans, scooters, road signs, Route 66 shields/);
  assert.match(route,/Original PNG assets will be composited later by PaletteIQ/);
  assert.match(route,/ALLOWED FLAT DESIGN ORNAMENTS/);
  assert.match(route,/tiny four-point sparkle accents/);
  assert.match(route,/Leave those object locations completely empty/);
  assert.match(route,/NO pictorial road signs, mini vehicle graphics/);
});
test('QC allows ornamental stars and signage-shaped lettering frame without allowing invented collection subjects',()=>{
  assert.match(route,/Decorative star shapes are NOT automatically clipart/);
  assert.match(route,/A standalone illustrated road sign with its own pictorial detail counts as inventedClipart/);
  assert.match(route,/A simple unillustrated shield outline used solely as the title frame does NOT/);
  assert.match(route,/DISTINCT, INDEPENDENT, RECOGNIZABLE illustrated subject/);
  assert.match(route,/Set printedProductArtwork=true ONLY when an illustration or printed graphic actually appears/);
  assert.match(route,/if \(parsed\.inventedClipart !== false \|\| parsed\.printedProductArtwork !== false\)/);
  assert.match(route,/AI background contains possible invented art/);
});
