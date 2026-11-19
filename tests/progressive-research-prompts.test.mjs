import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPromptBatchInput,parsePromptBatchOutput} from '../lib/prompt-batch-jobs.ts';

const route=readFileSync(new URL('../app/api/prompt-jobs/route.ts',import.meta.url),'utf8');
const research=readFileSync(new URL('../app/api/research-jobs/route.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const automation=readFileSync(new URL('../app/api/full-automation/route.ts',import.meta.url),'utf8');

test('Research returns completed worker preview without treating candidates as saved characters',()=>{
  assert.match(research,/const workerPreview = \(worker: HybridWorker\)/);
  assert.match(research,/workerPreviews:job\.workers\?\.map\(workerPreview\)/);
  assert.match(page,/Live Research previews \(provisional\)/);
  assert.match(page,/Incoming Research concepts — preview only/);
  assert.match(page,/These are candidate ideas, not saved final characters/);
});

test('Progressive prompt mode uses immutable JSONL, at most three concurrent paid Batches',()=>{
  assert.match(route,/const PROGRESSIVE_ACTIVE_LIMIT=3/);
  assert.match(route,/progressiveJsonl:generation\.jsonl/);
  assert.match(route,/const immutableInput=job\.progressiveJsonl\|\|jsonl/);
  assert.match(route,/const capacity=Math\.max\(0,PROGRESSIVE_ACTIVE_LIMIT-active\)/);
  assert.match(route,/claimed=group\?\.status==='planned'/);
  assert.match(route,/status:'uncertain',error:'Submission may have reached OpenAI/);
  assert.match(route,/if\(group\.status==='submitting'&&!group\.batchId/);
  assert.match(route,/group\.key===groupKey && !\['completed','failed','uncertain'\]/);
  assert.match(route,/if\(job\.mode==='progressive'\) return synchronizeProgressive/);
  assert.match(route,/progressPromptBatches\(owner,id,job\.id,key\)/);
  assert.match(automation,/progressive:p\.progressivePrompts===true/);
});

test('Progressive prompts are imported one group at a time and shown immediately',()=>{
  assert.match(route,/const groupSpec=job\.groups\.filter\(g=>g\.key===group\.key\)/);
  assert.match(route,/promptFingerprint\(character\.prompt\|\|''\)!==item\.originalFingerprint/);
  assert.match(route,/data:JSON\.stringify\(\{\.\.\.current\.data,characters:chars,promptJob:newJob\}\)/);
  assert.match(route,/return Response\.json\(\{job:safeJob\(fresh\?\.data\.promptJob\|\|updated\),project:fresh\?\.data\}\)/);
  assert.match(page,/if \(result\.project\) \{/);
  assert.match(page,/Completed groups are imported and rendered without waiting for the other groups/);
  assert.match(page,/Progressive Parallel \(up to 3 small Batches/);
  assert.match(page,/Progressive Parallel Prompt Batches \(import groups of 10/);
});

test('Prompt generation remains grouped by ten characters, retaining original Batch mode',()=>{
  const characters=Array.from({length:50},(_,i)=>({id:'char-'+i,name:'Fairy '+i,prompt:''}));
  const input=buildPromptBatchInput({id:'proj',name:'Fairy Garden',characters},characters,'gpt-4.1-mini');
  assert.equal(input.groups.length,5);
  assert.deepEqual(input.groups.map(g=>g.ids.length),[10,10,10,10,10]);
  const rows=input.jsonl.trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(x=>x.custom_id),input.groups.map(g=>g.key));
  assert.equal(rows.every(row=>row.body.model==='gpt-4.1-mini'),true);
  assert.match(route,/if \(job\.mode==='progressive'\)/);
  assert.match(route,/let remoteBatchId: string \| null = null;/);
});
