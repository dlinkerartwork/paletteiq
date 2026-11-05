import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { originalImagePrompt } from '../lib/originality.ts';

const source = readFileSync(new URL('../lib/originality.ts', import.meta.url), 'utf8');
const single = readFileSync(new URL('../app/api/studio/route.ts', import.meta.url), 'utf8');
const batch = readFileSync(new URL('../app/api/image-batches/route.ts', import.meta.url), 'utf8');

test('originality guard supplies explicit design changes rather than generic originality language', () => {
  assert.match(source, /new, independent illustration/);
  assert.match(source, /composition, proportions, silhouette, pose/);
  assert.match(source, /copy its exact flower\/petal\/face configuration/);
});

test('both single and batch generation always apply the originality guard to saved prompts', () => {
  assert.match(single, /prompt: originalImagePrompt\(character\.prompt, character\.id, crypto\.randomUUID\(\)\)/);
  assert.match(batch, /prompt: originalImagePrompt\(c!\.prompt, c!\.id\)/);
});

test('regeneration retains originality guard and varies art direction', () => {
  const first = originalImagePrompt('watercolor bear', 'character-1', 'a');
  const next = originalImagePrompt('watercolor bear', 'character-1', 'b');
  assert.match(first, /ORIGINALITY REQUIREMENT/);
  assert.match(next, /ORIGINALITY REQUIREMENT/);
  assert.notEqual(first, next);
});

test('AI prompt creation directs original redesigns of subjects extracted from listing images', () => {
  assert.match(single, /For EVERY subject deliberately invent a NEW pose/);
  assert.match(single, /transform them into distinct, original alternatives/);
});
