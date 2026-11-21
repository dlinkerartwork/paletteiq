import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { originalImagePrompt, normalizeSimilarityLimit, similarityOriginalityGuidance } from '../lib/originality.ts';
import { productionPromptInstruction } from '../lib/creative-research-prompts.ts';

const source = readFileSync(new URL('../lib/originality.ts', import.meta.url), 'utf8');
const single = readFileSync(new URL('../app/api/studio/route.ts', import.meta.url), 'utf8');
const batch = readFileSync(new URL('../app/api/image-batches/route.ts', import.meta.url), 'utf8');

test('originality guard supplies explicit design changes rather than generic originality language', () => {
  assert.match(source, /new, independent illustration/);
  assert.match(source, /composition, proportions, silhouette, pose/);
  assert.match(source, /copy its exact flower\/petal\/face configuration/);
});

test('both single and batch generation always apply the originality guard to saved prompts', () => {
  assert.match(single, /originalImagePrompt\(character\.prompt, character\.id, crypto\.randomUUID\(\), preferences\.maxReferenceSimilarityPercent \?\? 80\)/);
  assert.match(batch, /originalImagePrompt\(c!\.prompt, c!\.id, '', prefs\.maxReferenceSimilarityPercent \?\? 80\)/);
});

test('regeneration retains originality guard and varies art direction', () => {
  const first = originalImagePrompt('watercolor bear', 'character-1', 'a');
  const next = originalImagePrompt('watercolor bear', 'character-1', 'b');
  assert.match(first, /ORIGINALITY REQUIREMENT/);
  assert.match(next, /ORIGINALITY REQUIREMENT/);
  assert.notEqual(first, next);
});

test('AI prompt creation directs original redesigns while preserving niche and identity', () => {
  assert.match(single, /productionPromptInstruction\(/);
  const prompt = productionPromptInstruction({ title: 'Strawberry Farm', analysis: {
    theme: 'Farm Animals', subtheme: 'Baby Animals', microtheme: 'Strawberry Birthday',
  }, characters: [{ id: 'one', name: 'Duckling', family: 'duck' }] });
  assert.match(prompt, /vary pose, silhouette, point of view/);
  assert.match(prompt, /NEVER reproduce|Do NOT reproduce/);
  assert.match(prompt, /The subject must fit the source listing TITLE/);
});


test('similarity thresholds guide image prompts but do not claim a guaranteed visual outcome', () => {
  assert.equal(normalizeSimilarityLimit(60),60);
  assert.equal(normalizeSimilarityLimit(150),40);
  assert.equal(normalizeSimilarityLimit(-1),40);
  const generated=originalImagePrompt('Soft gouache fox','character-fox','',60);
  assert.match(generated,/no more than 60%/);
  assert.match(generated,/advisory creative target, not a measurable guarantee/);
  assert.match(similarityOriginalityGuidance(35),/no more than 35%/);
  const prompt=productionPromptInstruction({
    title:'Woodland Nursery',analysis:{theme:'Woodland Animals'},
    characters:[{id:'fox',name:'Fox'}],maxReferenceSimilarityPercent:35,
  });
  assert.match(prompt,/no more than 35%/);
  assert.match(prompt,/specific original pose, silhouette and visual arrangement/);
  assert.doesNotMatch(prompt,/no more than 60%/);
});
