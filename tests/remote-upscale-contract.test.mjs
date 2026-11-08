import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Remote GPU is the only configured upscale provider', () => {
  const settings = read('components/studio-settings.tsx');
  const api = read('app/api/settings/route.ts');
  const production = read('components/image-production.tsx');
  assert.match(settings, /upscaleProvider: 'remote'/);
  assert.match(api, /upscaleProvider: 'remote'/);
  assert.match(production, /Remote GPU upscale/);
  assert.doesNotMatch(settings, /Replicate API|Canva Companion|Fal\.ai —/);
  assert.doesNotMatch(production, /Send to Canva|Replicate upscale/);
});

test('GPU key only travels through backend route', () => {
  const route = read('app/api/upscale/route.ts');
  assert.match(route, /PALETTEIQ_UPSCALE_SERVER_KEY/);
  assert.match(route, /'X-API-Key': key/);
  assert.match(route, /parsed\.protocol !== 'https:'/);
  assert.match(route, /PALETTEIQ_DESKTOP === '1'/);
  assert.match(route, /upscaleJob =/);
  assert.doesNotMatch(read('components/image-production.tsx'), /PALETTEIQ_UPSCALE_SERVER_KEY|NEXT_PUBLIC_UPSCALE/);
});
