import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { researchAnalysisInstruction } from '../lib/creative-research-prompts.ts';
import { selectDiverseConcepts } from '../lib/creative-intelligence.ts';

const api = readFileSync(new URL('../app/api/research-jobs/route.ts', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../app/api/studio/route.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const production = readFileSync(new URL('../components/image-production.tsx', import.meta.url), 'utf8');

test('background prompt includes full 120-character research and niche/expressions', () => {
  const prompt = researchAnalysisInstruction({
    title: 'Cute Baby Farm Animals Strawberry Birthday Clipart',
    description: 'Little farm animals', tags: ['baby farm clipart', 'happy strawberry birthday'],
  }, 10, 120);
  assert.match(prompt, /FULL CATALOG MODE: Return EXACTLY 120 ORIGINAL/);
  assert.match(prompt, /Aim for 12–20 coherent subject families/);
  assert.match(prompt, /an expression \(or "not applicable" for faceless objects\)/);
  assert.match(prompt, /actual visible expressions|observedExpressions/);
  assert.match(prompt, /Cute Baby Farm Animals Strawberry Birthday/);
  assert.doesNotMatch(prompt, /SMALL observed sample ONLY/);
});

test('normal foreground analysis remains limited to 20 observed subjects', () => {
  const prompt = researchAnalysisInstruction({
    title: 'Farm Party', description: '', tags: [],
  }, 3);
  assert.match(prompt, /SMALL observed sample ONLY \(max 20\)/);
  assert.doesNotMatch(prompt, /FULL CATALOG MODE/);
});

test('a complete target must not add another proposed character', () => {
  assert.deepEqual(selectDiverseConcepts(
    [{ name: 'New baby cow', family: 'cow' }],
    [{ name: 'Existing pig', family: 'pig' }], 1, 0
  ), []);
});

test('research POST stores job before paid request, remote response survives disconnect', () => {
  assert.match(api, /export async function POST\(req: Request\)/);
  assert.match(api, /background: true, store: true/);
  assert.match(api, /responseId: response\.id/);
  assert.match(api, /eq\(projects\.updatedAt, saved\.row\.updatedAt\)/);
  assert.match(api, /if \(active\(saved\.data\.researchJob\)\)/);
  assert.match(api, /requested = Math\.min\(target, 160\)/);
  assert.match(api, /researchAnalysisInstruction\(source, selectedImages\.length, requested\)/);
  assert.match(api, /return Response\.json\(\{ job: safeJob\(savedJob/);
});

test('research GET restores completed catalog without resubmitting paid work', () => {
  const get = api.slice(api.indexOf('export async function GET(req: Request)'));
  assert.match(get, /responseId/);
  assert.match(get, /'responses\/' \+ encodeURIComponent\(job\.responseId\)/);
  assert.match(get, /if \(response\.status === 'completed'\) return finish/);
  assert.match(api, /selectDiverseConcepts\(candidates, uniquePrevious/);
  assert.match(api, /const updated: Collection = \{/);
  assert.match(api, /\.\.\.saved\.data, researchJob: updatedJob/);
  assert.doesNotMatch(get, /method: 'POST'/);
});

test('browser resumes a saved job and never blocks waiting for all generations', () => {
  assert.match(ui, /await api\(\{ action: 'save', id: project\.id/);
  assert.match(ui, /fetch\('\/api\/research-jobs', \{/);
  assert.match(ui, /fetch\('\/api\/research-jobs\?projectId=' \+/);
  assert.match(ui, /window\.setInterval\(\(\) => void pollResearch\(\), 8000\)/);
  assert.match(ui, /hasActiveResearch\(project\.researchJob\)/);
  assert.match(ui, /Reopen PaletteIQ to import the completed characters automatically/);
});

test('server preserves the research tracking ID against old browser snapshot saves', () => {
  assert.match(studio, /const serverResearch =/);
  assert.match(studio, /incoming\.researchJob = serverResearch/);
  assert.match(studio, /serverResearch\.status === 'completed'/);
  assert.match(studio, /incoming\.characters = \[\.\.\.persisted/);
});

test('remote GPU progress changes only in state; no full-page refresh remains', () => {
  assert.doesNotMatch(production, /window\.location\.reload\(\)/);
  assert.match(production, /pendingUpscaleKey/);
  assert.match(production, /latestUpscaleChange\.current\(characterId/);
  assert.match(production, /setRemoteProgress\(old =>/);
  assert.match(production, /latestUpscaleChange\.current\(c\.id/);
  assert.match(production, /\[project\.id, pendingUpscaleKey\]/);
  assert.match(ui, /onUpscaleChange=\{\(id,fields\) => updateChar\(id,fields\)\}/);
});
