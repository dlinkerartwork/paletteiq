import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  SIMILARITY_RECHECK_LIMIT,SIMILARITY_RECHECK_PER_TICK,SIMILARITY_RECHECK_COOLDOWN_MS,
  unverifiedImages,similarityDue,similarityExhausted,similarityRetryKey,
  canAutoRecoverSimilarityPause,
} from '../lib/automation-similarity.ts';

const flow=readFileSync(new URL('../app/api/full-automation/route.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const image=readFileSync(new URL('../app/api/image-batches/route.ts',import.meta.url),'utf8');

test('only unverified saved images are rechecked, never clear or flagged ones',()=>{
  const images=[
    {id:'a',imageUrl:'saved-a',similarityReview:{status:'clear'}},
    {id:'b',imageUrl:'saved-b',similarityReview:{status:'needs_review'}},
    {id:'c',imageUrl:'saved-c',similarityReview:{status:'unverified',reason:'Similarity review unavailable'}},
    {id:'d',imageUrl:'saved-d'},
    {id:'e',similarityReview:{status:'unverified'}},
  ];
  assert.deepEqual(unverifiedImages(images).map(x=>x.id),['c','d']);
  assert.deepEqual(similarityDue(images,{},1).map(x=>x.id),['c','d']);
});

test('similarity retry budget and cooldown are per image version, bounded and durable',()=>{
  const image={id:'c',imageUrl:'/api/images/c?batch=123',similarityReview:{status:'unverified'}};
  const key=similarityRetryKey(image);
  assert.equal(SIMILARITY_RECHECK_LIMIT,3);
  assert.equal(SIMILARITY_RECHECK_PER_TICK,4);
  assert.ok(SIMILARITY_RECHECK_COOLDOWN_MS>=10000);
  assert.deepEqual(similarityDue([image],{attempts:{[key]:1},nextAt:{[key]:100}},99),[]);
  assert.deepEqual(similarityDue([image],{attempts:{[key]:1},nextAt:{[key]:100}},100),[image]);
  assert.deepEqual(similarityExhausted([image],{attempts:{[key]:2}}),[]);
  assert.deepEqual(similarityExhausted([image],{attempts:{[key]:3}}),[image]);
  assert.deepEqual(similarityDue([image],{attempts:{[key]:3}},999),[]);
  assert.notEqual(similarityRetryKey({...image,imageUrl:'replacement'}),key);
});

test('retry selects at most four images, leaving remaining images for next tick',()=>{
  const images=Array.from({length:9},(_,i)=>({id:String(i),imageUrl:'saved-'+i,similarityReview:{status:'unverified'}}));
  assert.deepEqual(similarityDue(images,{},Date.now()).map(x=>x.id),['0','1','2','3']);
});

test('only the exact old automatic unavailable-review pause is recoverable',()=>{
  const valid={enabled:true,stage:'paused',resumeStage:'images',
    lastError:'4 image(s) have unverified similarity checks. Review required.'};
  assert.equal(canAutoRecoverSimilarityPause(valid),true);
  assert.equal(canAutoRecoverSimilarityPause({...valid,lastError:'Paused by user'}),false);
  assert.equal(canAutoRecoverSimilarityPause({...valid,resumeStage:'research'}),false);
  assert.equal(canAutoRecoverSimilarityPause({...valid,enabled:false}),false);
  assert.equal(canAutoRecoverSimilarityPause({...valid,
    lastError:'Image Batch submission uncertain. Review required.'}),false);
});

test('review stage persists retry BEFORE potential paid visual comparison and updates same image version only',()=>{
  const entry=flow.indexOf('async function recheckUnverifiedSimilarity(');
  const claim=flow.indexOf('similarityRetries:retries,similarityNextAt:nextAt',entry);
  const remote=flow.indexOf('reviewStoredBatchImage(bucket,key,mime,secret,references)',entry);
  const commit=flow.indexOf('c.imageUrl===target.character.imageUrl',remote);
  assert.ok(entry>0 && claim>entry && remote>claim && commit>remote);
  assert.match(flow,/item.imageUrl===character.imageUrl/);
  assert.match(flow,/const exhausted=similarityExhausted/);
  assert.match(flow,/const due=similarityDue/);
  assert.match(flow,/const results=await Promise.allSettled\(targets.map/);
});

test('offline connection is probed with a free GET before claiming a billable similarity retry',()=>{
  const begin=flow.indexOf('async function recheckUnverifiedSimilarity(');
  const code=flow.slice(begin,flow.indexOf('async function tick(',begin));
  const probe=code.indexOf("await fetch('https://api.openai.com/v1/models'");
  const claim=code.indexOf('similarityRetries:retries,similarityNextAt:nextAt');
  const paid=code.indexOf('reviewStoredBatchImage(bucket,key,mime,secret,references)');
  assert.ok(probe>=0 && claim>probe && paid>claim);
  assert.match(code,/new TransientStatusError\('OpenAI connection offline/);
  assert.match(code,/connectivity.status===429 \|\| connectivity.status>=500/);
  assert.doesNotMatch(code.slice(0,probe),/reviewStoredBatchImage\(/);
});

test('initial images transition to recheck stage, then flagged items to revised prompts',()=>{
  const start=flow.indexOf("} else if (f.stage === 'images')");
  const review=flow.indexOf("} else if (f.stage === 'reviewing')",start);
  const revise=flow.indexOf("} else if (f.stage === 'revising')",review);
  assert.ok(start>=0 && review>start && revise>review);
  assert.match(flow.slice(start,review),/await setStage\(owner,id,'reviewing'\)/);
  assert.match(flow.slice(review,revise),/recheckUnverifiedSimilarity\(owner,id\)/);
  assert.match(flow.slice(review,revise),/await setStage\(owner,id,'revising'/);
  assert.match(flow.slice(revise),/await setStage\(owner,id,'regenerating'\)/);
});

test('existing regeneration receipts block duplicate paid replacements after disconnect',()=>{
  const section=flow.slice(flow.indexOf("} else if (f.stage === 'regenerating')"),
    flow.indexOf("} else if (f.stage === 'listing')"));
  const existing=section.indexOf('const existing=records.find(');
  const post=section.indexOf('const result=await apiPost(req,imagePost');
  assert.ok(existing>=0 && post>existing);
  assert.match(section,/existing\.openaiBatchId\.startsWith\('pending:'\)/);
  assert.match(section,/item.replaceFromImageUrl/);
  assert.match(section,/await setStage\(owner,id,'verifying',\{regenerationBatchId:existing.id\}\)/);
  assert.match(section,/await recheckUnverifiedSimilarity\(owner,id\)/);
  assert.match(section,/One automatic regeneration was already attempted/);
  assert.match(image,/openaiBatchId: 'pending:' \+ reservationId/);
});

test('scheduler recovers only old similarity pauses; UI exposes each progress stage',()=>{
  assert.match(flow,/canAutoRecoverSimilarityPause\(initial.p.fullAutomation\)/);
  assert.match(flow,/stage:'reviewing',resumeStage:undefined,lastError:undefined/);
  assert.match(flow,/LIKE '% image\(s\) have unverified similarity checks\. Review required\.'/);
  assert.match(page,/Similarity verification \/ retry/);
  assert.match(page,/Generate revised similarity-safe prompts/);
  assert.match(page,/Regenerate flagged images/);
  assert.match(page,/stage==='reviewing'/);
  assert.match(page,/stage==='verifying'/);
});
