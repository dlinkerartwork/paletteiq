import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const route=read('app/api/prompt-jobs/route.ts');
const flow=read('app/api/full-automation/route.ts');
const page=read('app/page.tsx');

test('a paused Prompt Batch can inspect old paid IDs without starting a new OpenAI POST',()=>{
  const entry=route.indexOf("if(body.action==='recover-existing')");
  const ids=route.indexOf('const ids = body.characterIds;',entry);
  const provider=route.indexOf("method:'POST'",entry);
  assert.ok(entry>0&&ids>entry,'read-only action must be handled before paid POST validation');
  assert.ok(provider>ids,'read-only action must return before any paid provider request');
  assert.match(route.slice(entry,ids),/return await synchronize\(user.userId,projectId,true\)/);
  assert.match(route,/async function synchronize\(owner: string, projectId: string,recoverExisting=false\)/);
  assert.match(route,/if \(!isActivePromptBatch\(job\) && !recoverExisting\)/);
  assert.match(route,/synchronizeProgressive\(owner,projectId,job,recoverExisting\)/);
  assert.match(route,/if\(!recoverExisting\) await progressPromptBatches\(owner,id,job.id,key\)/);
});

test('a completed Prompt group can re-import only missing or invalid saved results',()=>{
  assert.match(route,/recoverExisting && \['completed','failed'\].includes\(g.status\)/);
  assert.match(route,/if\(!recoverExisting &&/);
  assert.match(route,/recoverExisting && item.status==='error'/);
  assert.match(route,/promptFingerprint\(character.prompt\|\|''\)!==item.originalFingerprint/);
  assert.match(route,/if\(!prompt\)return \{\.\.\.item,status:'error'/);
  assert.match(route,/const committed=await getDb\(\).update\(projects\).set/);
  assert.match(route,/eq\(projects.updatedAt,current.row.updatedAt\)/);
});

test('an explicit paid retry is guarded by completed receipts, latest missing IDs and preserved history',()=>{
  const header=route.slice(route.indexOf('if(body.recoveryRetry) {'),
    route.indexOf('  const byId = new Map(',route.indexOf('if(body.recoveryRetry) {')));
  assert.match(header,/automation.stage!=='paused'/);
  assert.match(header,/resumeStage!=='prompts'/);
  assert.match(header,/\['completed','completed_with_errors'\].includes\(prev.status\)/);
  assert.match(header,/!\['completed','failed'\].includes\(g.status\)/);
  assert.match(header,/!\(g.responseId\|\|g.batchId\)/);
  assert.match(header,/missing.length!==ids.length/);
  assert.match(header,/missing.some\(\(id,i\)=>id!==ids\[i\]\)/);
  assert.match(route,/promptJobHistory:retainedReceipts/);
  const studio=read('app/api/studio/route.ts');
  assert.match(studio,/incoming as typeof incoming & \{promptJobHistory\?:unknown\[\]\}/);
  assert.match(studio,/promptJobHistory=savedPromptHistory/);
  assert.match(route,/if \(isActivePromptBatch\(saved.data.promptJob\)\)/);
  assert.match(route,/!body.recoveryRetry/);
});

test('Full Automation counts prompts from fresh saved project and never bills on terminal prompt failures',()=>{
  const begin=flow.indexOf("} else if (f.stage === 'prompts')");
  const end=flow.indexOf("} else if (f.stage === 'images')",begin);
  const code=flow.slice(begin,end);
  assert.ok(begin>0&&end>begin);
  assert.match(code,/let current=\(await load\(owner,id\)\)\?\.p\|\|p/);
  assert.match(code,/let missing=current.characters.filter/);
  assert.match(code,/await apiGet\(req,promptGet,id\)/);
  assert.match(code,/current=\(await load\(owner,id\)\)\?\.p\|\|current/);
  assert.match(code,/missing=current.characters.filter/);
  assert.match(code,/if \(!missing.length\) await setStage\(owner,id,'images'\)/);
  assert.match(code,/\['failed','cancelled','expired','completed_with_errors'\]/);
  assert.match(code,/else if \(!current.promptJob &&/);
  assert.match(flow,/promptMissingCount: p.characters.filter/);
  assert.match(flow,/promptRecovery: p.promptJob \?/);
});

test('UI offers free receipt recovery and requires explicit cost confirmation for missing-only paid retry',()=>{
  assert.match(page,/Recover Existing Prompt Responses \(no new paid job\)/);
  assert.match(page,/Retry only missing prompts \(paid — confirm first\)/);
  assert.match(page,/const recoverSavedPromptResponses = async/);
  assert.match(page,/const retryOnlyMissingPrompts = async/);
  assert.match(page,/action:'recover-existing'/);
  assert.match(page,/if\(!window.confirm\(/);
  assert.match(page,/characterIds:missing.map\(c=>c.id\)/);
  assert.match(page,/recoveryRetry:true,regenerate:false/);
  assert.match(page,/savedPromptProgress\?\.projectId===project.id/);
  assert.match(page,/const savedPromptGroups = \(job\?:PromptJobPreview\)/);
  assert.match(page,/job\?\.progressiveBatches\?\.length \? job.progressiveBatches/);
  assert.match(page,/const groups=savedPromptGroups\(previous\)/);
  assert.match(page,/existing OpenAI receipts/i);
});
