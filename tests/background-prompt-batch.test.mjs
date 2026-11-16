import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPromptBatchInput, isActivePromptBatch, parsePromptBatchOutput,
  projectPromptContext, promptFingerprint,
} from '../lib/prompt-batch-jobs.ts';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/prompt-jobs/route.ts', import.meta.url), 'utf8');
const save = readFileSync(new URL('../app/api/studio/route.ts', import.meta.url), 'utf8');

const sample = (id, index, prompt = '') => ({
  id, name: 'Original baby farm animal ' + index, family: 'pig', expression: 'happy closed-eye grin',
  description: 'Pastel birthday scarf with strawberry pattern', prompt,
});
const project = {
  id: 'sample-project', name: 'Birthday Animals', title: 'Cute Happy Baby Strawberry Farm Birthday',
  theme: 'Farm Animals', subtheme: 'Baby Animals', microtheme: 'Pink Strawberry Birthday',
  keywords: ['strawberry clipart'], emotionDirection: 'happy',
  characters: [],
};

test('120-character prompt generation becomes one durable Batch containing twelve groups', () => {
  const subjects = Array.from({ length: 120 }, (_, i) => sample('subject-' + i, i));
  const { jsonl, groups } = buildPromptBatchInput(project, subjects, 'gpt-4.1-mini');
  assert.equal(groups.length, 12);
  assert.equal(groups[0].ids.length, 10);
  assert.equal(groups[11].ids.length, 10);
  assert.equal(groups.flatMap(g => g.ids).length, 120);
  const rows = jsonl.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows.length, 12);
  assert.ok(rows.every(row => row.url === '/v1/responses' && row.body.model === 'gpt-4.1-mini'));
  assert.ok(rows.every(row => row.body.text.format.type === 'json_object'));
  assert.ok(rows.every(row => row.body.input[0].content[0].text.includes('Pink Strawberry Birthday')));
  assert.ok(rows.every(row => row.body.input[0].content[0].text.includes('happy')));
  assert.deepEqual(rows.map(r => r.custom_id), groups.map(g => g.key));
});

test('creative prompt context inherits research, keywords, mood and baby directions', () => {
  const context = projectPromptContext({
    ...project, ageDirection: 'baby proportions', cutenessDirection: 'soft kawaii',
  });
  assert.equal(context.microtheme, 'Pink Strawberry Birthday');
  assert.equal(context.emotionProfile.dominantMood, 'happy');
  assert.deepEqual(context.emotionProfile.ageCues, ['baby proportions']);
  assert.deepEqual(context.emotionProfile.styleCues, ['soft kawaii']);
});

test('finished Batch output matches each prompt with the exact intended character ID', () => {
  const groups = [{ key:'prompt-group-0', ids:['cow', 'pig'] }];
  const text = JSON.stringify({ prompts: [
    { id:'cow', prompt:'A highly detailed happy baby watercolor cow with rounded ears, isolated PNG, pink strawberry bow, no background.' },
    { id:'pig', prompt:'A soft and delicate little baby watercolor piglet in a joyful pose, transparent background, clean edge, pastel.' },
    { id:'intruder', prompt:'This one must never get imported under an unrelated character ID, regardless of its contents.' },
  ] });
  const output = JSON.stringify({ custom_id:'prompt-group-0', response:{ body:{
    output:[{ content:[{ type:'output_text',text }] }],
  } } });
  const result = parsePromptBatchOutput(output, groups);
  assert.equal(result.prompts.size, 2);
  assert.ok(result.prompts.get('cow')?.includes('baby watercolor cow'));
  assert.equal(result.prompts.has('intruder'), false);
  assert.equal(result.errors.size, 0);
});

test('incomplete response or invalid JSON is reported without corrupting other IDs', () => {
  const groups = [{ key:'prompt-group-0', ids:['cow','pig'] }, { key:'prompt-group-1',ids:['duck'] }];
  const output = JSON.stringify({ custom_id:'prompt-group-0', response:{ body:{ output:[{ content:[{ text: JSON.stringify({
    prompts:[{ id:'cow', prompt:'A richly detailed original happy baby cow, expressive eyes, soft watercolor texture, isolated clipart.' }],
  }) }] }] } } });
  const parsed = parsePromptBatchOutput(output + '\n' + JSON.stringify({
    custom_id:'prompt-group-1', response:{ body:{ output:[{ content:[{ text: '{"prompts":{"not":"an array"}}' }] }] } },
  }), groups);
  assert.ok(parsed.prompts.has('cow'));
  assert.match(parsed.errors.get('pig') || '', /Missing or invalid prompt/);
  assert.match(parsed.errors.get('duck') || '', /Missing or invalid prompt/);
});

test('prompt fingerprint detects manual edits and exact previous values', () => {
  assert.equal(promptFingerprint('old prompt'), promptFingerprint('old prompt'));
  assert.notEqual(promptFingerprint('old prompt'), promptFingerprint('new prompt'));
  assert.notEqual(promptFingerprint(''), promptFingerprint(' '));
});

test('completed, failed or expired jobs cannot be accidentally resubmitted', () => {
  const job = { id:'a', status:'validating' };
  assert.equal(isActivePromptBatch(job), true);
  assert.equal(isActivePromptBatch({ ...job,status:'importing' }), true);
  assert.equal(isActivePromptBatch({ ...job,status:'completed' }), false);
  assert.equal(isActivePromptBatch({ ...job,status:'completed_with_errors' }), false);
  assert.equal(isActivePromptBatch({ ...job,status:'expired' }), false);
});

test('server submits one /v1/responses Batch and preserves its tracking ID', () => {
  assert.match(route, /form.set\('purpose', 'batch'\)/);
  assert.match(route, /endpoint: '\/v1\/responses'/);
  assert.match(route, /completion_window: '24h'/);
  assert.match(route, /batchId: remote.id/);
  assert.match(route, /if \(isActivePromptBatch\(saved.data.promptJob\)\)/);
  assert.match(route, /eq\(projects.updatedAt, saved.row.updatedAt\)/);
  assert.match(route, /const result = parsePromptBatchOutput/);
  assert.match(route, /promptFingerprint\(character.prompt \|\| ''\) !== item.originalFingerprint/);
  assert.match(route, /if \(!commit.length\) return Response.json\(\{ job: safeJob\(job\), retryImport: true \}\)/);
  assert.match(route, /status: 'skipped'/);
});

test('UI resumes background prompts without a full-page reload or repeat API charges', () => {
  assert.match(page, /fetch\('\/api\/prompt-jobs', \{/);
  assert.match(page, /fetch\('\/api\/prompt-jobs\?projectId=' \+/);
  assert.match(page, /hasActivePromptJob\(project.promptJob\)/);
  assert.match(page, /window.setInterval\(\(\) => void pollPrompts\(\), 10000\)/);
  assert.match(page, /onClick=\{\(\) => generatePrompts\(\)\}/);
  assert.match(page, /OpenAI Batch running/);
  assert.doesNotMatch(route, /window.location.reload/);
});

test('older project saves preserve completed paid prompts and all remote job IDs', () => {
  assert.match(save, /const serverPromptJob =/);
  assert.match(save, /incoming.promptJob = serverPromptJob/);
  assert.match(save, /const completedIds = new Set/);
  assert.match(save, /prompt: \(saved as SubjectInput\).prompt/);
  assert.match(save, /const serverResearch =/);
});
