import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {splitResearchImages,hybridMergeInstruction} from '../lib/hybrid-research.ts';

const research=readFileSync(new URL('../app/api/research-jobs/route.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const prompts=readFileSync(new URL('../lib/prompt-batch-jobs.ts',import.meta.url),'utf8');

test('three research workers partition exact selected images with no duplicates',()=>{
  const selected=Array.from({length:8},(_,i)=>'https://etsy.example/'+i);
  const groups=splitResearchImages(selected,3);
  assert.deepEqual(groups.map(g=>g.length),[3,3,2]);
  assert.deepEqual([...groups.flat()].sort(),selected.sort());
  assert.deepEqual(splitResearchImages(['one'],3),[['one']]);
});
test('hybrid Style DNA merge uses all completed worker evidence',()=>{
  const source={title:'Happy Baby Farm Clipart',description:'Pink and blue art',tags:['baby','watercolor']};
  const workers=Array.from({length:3},(_,index)=>({index,status:'completed',images:['image-'+index],
    resultText:JSON.stringify({theme:'baby farm',characters:[{name:'original animal '+index}]})}));
  const instruction=hybridMergeInstruction(source,workers,50);
  assert.match(instruction,/EXACTLY 50 original/);
  assert.match(instruction,/STYLE DNA/);
  assert.match(instruction,/original animal 0/);
  assert.match(instruction,/original animal 1/);
  assert.match(instruction,/original animal 2/);
  assert.match(instruction,/do not invent/);
});
test('worker submission is durable and polling never resubmits worker',()=>{
  assert.ok(research.includes("const partitions = splitResearchImages(selectedImages, hybrid ? 3 : 1)"));
  assert.match(research,/await Promise\.all\(submissions\)/);
  assert.match(research,/updateWorker\(user\.userId,projectId,job\.id,worker\.index/);
  assert.match(research,/eq\(projects\.updatedAt, saved\.row\.updatedAt\)/);
  assert.match(research,/job\.workers\.filter\(w=>\['queued','in_progress'\]/);
  assert.match(research,/let claimed=false/);
  assert.match(research,/claimed=old\.mergeStatus==='planned' && !old\.responseId/);
  assert.match(research,/mergeStatus:'uncertain'/);
  assert.match(research,/workersCompleted: job\.workers\?\.filter/);
});
test('Auto-follow skips Character Library after merge and prompt generation remains batched',()=>{
  assert.match(page,/stage === 'expanding'\) return 'analysis'/);
  assert.match(page,/if \(stage === 'prompts'\) return 'prompts'/);
  assert.match(page,/Hybrid Parallel Research:/);
  assert.match(prompts,/index \+= 10/);
  assert.match(prompts,/custom_id: key, method: 'POST', url: '\/v1\/responses'/);
});

test('Multi-reference Research defaults to parallel standard Responses and preserves paid IDs',()=>{
  assert.match(page,/Research &amp; Analysis uses up to 3 parallel standard OpenAI Responses workers/);
  assert.match(page,/hybridResearch: chosenImages.length > 1/);
  assert.match(research,/const hybrid = selectedImages.length > 1 && body.retryFailed !== true/);
  assert.match(research,/Worker submission interrupted before a tracking ID was saved/);
  assert.match(research,/transport:'standard', workers/);
});

test('hybrid receipts accept real OpenAI response IDs and no response is silently re-sent',()=>{
  assert.equal(research.includes(String.raw`/^resp_[\\w-]+$/`),false,'double-escaped regexp would reject all real response IDs');
  assert.ok(research.split(String.raw`/^resp_[\w-]+$/`).length>=3,'worker and merge must validate true response IDs');
  assert.match(research,/Worker submission may have reached OpenAI/);
  assert.match(research,/Style DNA merge may have been submitted/);
});
