import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const flow=readFileSync(new URL('../app/api/full-automation/route.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const monitor=readFileSync(new URL('../desktop/background-batch-monitor.cjs',import.meta.url),'utf8');

test('Full Automation schedules three independent collections in parallel',()=>{
  assert.match(flow,/const MULTI_COLLECTION_TICK_LIMIT = 3/);
  assert.match(flow,/const available=active\.filter\(item=>!item\.leaseUntil/);
  assert.match(flow,/const selected=available\.slice\(0,MULTI_COLLECTION_TICK_LIMIT\)/);
  assert.match(flow,/const results=await Promise\.all\(selected\.map\(async item=>/);
  assert.match(flow,/projectId:item\.id,\.\.\.await tick\(req,user\.userId,item\.id\)/);
  assert.match(flow,/return Response\.json\(\{active:active\.length,processed:selected\.length,results\}\)/);
  assert.doesNotMatch(flow,/filter\(x=>isActive\(x\.flow\)\)\.slice\(0,2\)/);
});

test('each collection retains its own lease and paid job state',()=>{
  assert.match(flow,/const key = owner \+ ':' \+ id/);
  assert.match(flow,/if \(busy\.has\(key\)\)/);
  assert.match(flow,/flow\.leaseUntil && flow\.leaseUntil > Date\.now\(\)/);
  assert.match(flow,/eq\(projects\.id,id\)/);
  assert.match(flow,/eq\(projects\.updatedAt,initial\.row\.updatedAt\)/);
});

test('visible and hidden Desktop controllers tick multiple collections',()=>{
  assert.match(page,/const tickOtherCollections=async\(\)=>/);
  assert.match(page,/action:'tick',syncAll:true/);
  assert.match(page,/!\['paused','completed'\]\.includes\(p\.fullAutomation\.stage\)/);
  assert.match(page,/old\.id===latestWorkspace\.current\.project\.id/);
  assert.match(page,/collectionHasUnsavedEdits\(old,savedProjectSnapshots\.current\.get\(old\.id\)\)/);
  assert.match(monitor,/action: 'tick', syncAll: true/);
  assert.match(page,/Full Automation workflows running concurrently/);
  assert.match(page,/Full Automation: \{p\.fullAutomation\.stage\.replaceAll/);
  assert.match(page,/setTab\(p\.fullAutomation\?\.enabled \? \(automationStageTab/);
});
