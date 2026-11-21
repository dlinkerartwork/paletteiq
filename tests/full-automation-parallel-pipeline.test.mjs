import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  AUTOMATION_LIMITS, activeExpansionSlots, planExpansionSlots,
  pendingImageIds, availableImageSlots,
} from '../lib/automation-parallel.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const flow=read('app/api/full-automation/route.ts');
const research=read('app/api/research-jobs/route.ts');
const prompts=read('app/api/prompt-jobs/route.ts');
const page=read('app/page.tsx');

test('requested 3/3/4/4 limits are explicit, durable and used by schedulers',()=>{
  assert.deepEqual({...AUTOMATION_LIMITS},
    {research:3,aiFill:3,prompts:4,imageBatches:4});
  assert.match(research,/splitResearchImages\(selectedImages, hybrid \? 3 : 1\)/);
  assert.match(prompts,/const PROGRESSIVE_ACTIVE_LIMIT=4/);
  assert.match(flow,/chunks\.length<capacity/);
  assert.match(flow,/availableImageSlots\(occupied\)/);
});

test('AI Fill never exceeds three paid slots and reserves unique missing counts',()=>{
  assert.deepEqual(planExpansionSlots(120,60,[],0,60),[15,15,15]);
  assert.deepEqual(planExpansionSlots(120,90,[{count:15}],1,60),[15]);
  assert.deepEqual(planExpansionSlots(120,119,[{count:1}],1,60),[]);
  assert.deepEqual(planExpansionSlots(20,0,[],2,3),[15]);
  assert.deepEqual(planExpansionSlots(20,20,[],0,5),[]);
  assert.deepEqual(planExpansionSlots(100,0,[{count:15},{count:15},{count:15}],0,60),[]);
});

test('legacy AI Fill receipt and new receipts remain individually discoverable',()=>{
  const old={responseId:'resp_old',count:15,startedAt:1,status:'queued'};
  const fresh={id:'a',responseId:'resp_new',count:15,startedAt:2,status:'in_progress'};
  assert.deepEqual(activeExpansionSlots({expansionBatch:old,expansionBatches:[fresh]}),
    [{...old,id:'legacy'},fresh]);
  assert.deepEqual(activeExpansionSlots({expansionBatches:[]}),[]);
});

test('pending image IDs are protected even when provider says completed',()=>{
  assert.deepEqual([...pendingImageIds([
    {status:'completed',items:JSON.stringify([{id:'a',status:'pending'}])},
    {status:'in_progress',items:JSON.stringify([{id:'b',status:'pending'},{id:'c',status:'done'}])},
    {status:'uncertain',items:JSON.stringify([{id:'d',status:'pending'}])},
  ])].sort(),['a','b','d']);
  assert.throws(()=>pendingImageIds([{status:'completed',items:'bad JSON'}]),/Unreadable saved/);
  assert.equal(availableImageSlots(0),4);
  assert.equal(availableImageSlots(3),1);
  assert.equal(availableImageSlots(4),0);
  assert.equal(availableImageSlots(8),0);
});

test('new paid expansion slots are checkpointed before concurrent remote POSTs',()=>{
  const reserve=flow.indexOf('expansionBatches:[...(latest.fullAutomation?.expansionBatches||[]),...claims]');
  const submit=flow.indexOf('const submitted=await Promise.allSettled(claims.map');
  const remote=flow.indexOf('const responseId=await submitStandardTextResponse(secret,textModel(fresh)');
  assert.ok(reserve>=0 && submit>reserve && remote>submit);
  assert.match(flow,/slot\.id===claim\.id\?\{\.\.\.slot,responseId,status:'queued'/);
  assert.match(flow,/status:'uncertain' as const/);
  assert.match(flow,/never resubmit automatically/);
  assert.match(flow,/receipt\.id==='legacy'/);
});

test('prompt groups can feed image batches while other groups remain active',()=>{
  const promptStage=flow.indexOf("} else if (f.stage === 'prompts')");
  const imageStage=flow.indexOf("} else if (f.stage === 'images')",promptStage);
  assert.ok(promptStage>=0 && imageStage>promptStage, 'Prompt stage must precede Image stage');
  const promptCode=flow.slice(promptStage,imageStage);
  const overlapPattern=/if\s*\(missing\.length\)\s*await\s+scheduleReadyImageWave\(req,owner,id,true\);/;
  assert.match(promptCode,overlapPattern);
  // Windows Git checkouts may use CRLF instead of LF. Assert that the same
  // pipeline test works on both platforms, regardless of newline style.
  assert.match(promptCode.replace(/\r?\n/g,'\r\n'),overlapPattern);
  assert.match(flow,/partialPrompts && usable\.length<groupSize/);
  assert.match(flow,/const groupSize=f\.imageBatchSize===10\?10:20/);
  assert.match(flow,/Math\.ceil\(f\.target\/groupSize\)/);
  assert.match(flow,/pendingImageIds\(records\)/);
  assert.match(flow,/Promise\.allSettled\(chunks\.map\(chunk=>apiPost/);
});

test('network outages retry saved status IDs on reconnection without blind paid retry',()=>{
  assert.match(flow,/new TransientStatusError\('Saved AI Fill status unavailable/);
  assert.match(flow,/if \(error instanceof TransientStatusError\)/);
  assert.match(page,/window\.addEventListener\('online',onOnline\)/);
  assert.match(page,/networkPollFailures\.current\.delete\('automation'\)/);
  assert.match(page,/networkPollFailures\.current\.delete\('prompts'\)/);
  assert.match(flow,/throw Error\('Parallel AI Fill submission has uncertain receipts/);
});

test('paused expansion may be explicitly rearmed only with no existing paid receipts',()=>{
  assert.match(flow,/body\.action==='resume-expansion'/);
  assert.match(flow,/f\.stage!=='paused' \|\| f\.resumeStage!=='expanding'/);
  assert.match(flow,/activeExpansionSlots\(f\)\.length/);
  assert.match(flow,/const extra=6/);
  assert.match(flow,/expandAttempts:Math\.max\(0,maxAttempts-extra\)/);
  assert.match(page,/Continue AI Fill — up to 6 paid attempts \(confirm\)/);
  assert.match(page,/window\.confirm\([\s\S]*?SIX NEW PAID OpenAI AI Fill requests/);
  assert.match(flow,/const firstPass=selectDiverseConcepts\(candidates,latest\.characters/);
  assert.match(flow,/remaining-firstPass\.length,variation,focus,true/);
  assert.match(page,/Manual AI Fill can recover a paused workflow/);
  assert.match(page,/await api\(\{action:'save',id:current\.id,name:current\.name,data:current\}\)/);
});

test('user can accept saved partial characters without any new paid AI Fill',()=>{
  const start=flow.indexOf("if (body.action==='accept-current-characters')");
  const end=flow.indexOf("if (body.action==='resume-expansion')",start);
  assert.ok(start>0 && end>start,'acceptance endpoint precedes the paid retry endpoint');
  const accept=flow.slice(start,end);
  assert.match(accept,/flow\.stage!=='paused'/);
  assert.match(accept,/flow\.resumeStage!=='expanding'/);
  assert.match(accept,/activeExpansionSlots\(flow\)\.length/);
  assert.match(accept,/activeExpansionSlots\(f\)\.length/);
  assert.match(accept,/characterTarget:acceptedCount/);
  assert.match(accept,/target:acceptedCount/);
  assert.match(accept,/resumeStage:'prompts'/);
  assert.match(accept,/lastError:undefined/);
  assert.match(accept,/acceptedCharacterCount:accepted\.characters\.length/);
  assert.doesNotMatch(accept,/submitStandardTextResponse|apiPost|submitImageBatch/);
  assert.match(page,/const acceptCurrentCharacters = async \(\) =>/);
  assert.match(page,/action:'accept-current-characters'/);
  assert.match(page,/NO new paid OpenAI request is sent by accepting/);
  assert.match(page,/setTarget\(accepted\)/);
  assert.match(page,/Accept '\+project\.characters\.length\+' characters & continue'/);
});

test('accepting partial characters reloads saved collection before AI Prompts view',()=>{
  const begin=page.indexOf('const acceptCurrentCharacters = async () =>');
  const end=page.indexOf('const retryPausedExpansion = async () =>',begin);
  assert.ok(begin>=0 && end>begin);
  const handler=page.slice(begin,end);
  const response=handler.indexOf("action:'accept-current-characters'");
  const reload=handler.indexOf('await fetchSavedPromptSnapshot(project.id)');
  const navigate=handler.indexOf("setTab('prompts')");
  assert.ok(response>=0 && reload>response && navigate>reload,
    'accept should refresh saved characters/prompts and open prompts without paid requests');
  assert.match(handler,/saved\.fullAutomation\?\.target!==accepted/);
  assert.doesNotMatch(handler,/submitStandardTextResponse|apiPost\(/);
  assert.match(page,/oldStage==='paused' \? automationStageTab\(view\.project\.fullAutomation\?\.resumeStage/);
});
