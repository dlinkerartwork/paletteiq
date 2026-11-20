import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectionHasUnsavedEdits } from '../lib/collection-unsaved.ts';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const saved={id:'collection-1',name:'Baby Animals',theme:'Farm',characters:[{id:'a',name:'Cow',prompt:''}],images:['source'],listing:{title:'draft'},fullAutomation:{enabled:true,stage:'research',target:50},researchJob:{id:'a',status:'queued'},promptJob:{id:'b',status:'queued'}};

test('Background Full Automation changes never count as unsaved manual edits',()=>{
  const current={...saved,fullAutomation:{...saved.fullAutomation,stage:'prompts',leaseUntil:432},researchJob:{id:'a',status:'completed'},promptJob:{id:'b',status:'in_progress'}};
  assert.equal(collectionHasUnsavedEdits(current,JSON.stringify(saved)),false);
});

test('All real manual edits are still protected, whether automation is enabled or not',()=>{
  for(const edit of [
    {...saved,name:'Edited title'},
    {...saved,characters:[{id:'a',name:'Cow',prompt:'New prompt'}]},
    {...saved,images:['different source']},
    {...saved,listing:{title:'New Etsy title'}},
    {...saved,thumbnails:[{id:'user-design'}]},
  ]) assert.equal(collectionHasUnsavedEdits(edit,JSON.stringify(saved)),true);
  const manual={...saved,fullAutomation:undefined};
  assert.equal(collectionHasUnsavedEdits({...manual,theme:'Manually changed'},JSON.stringify(manual)),true);
  assert.equal(collectionHasUnsavedEdits({...manual,promptJob:{id:'b',status:'completed'}},JSON.stringify(manual)),false);
  assert.equal(collectionHasUnsavedEdits(manual,undefined),true,'new unsaved collections require protection');
  assert.equal(collectionHasUnsavedEdits(manual,'invalid JSON'),true);
});

test('switch guards and history use the same remote-job-aware predicate',()=>{
  assert.match(page,/const collectionDirty = collectionHasUnsavedEdits\(current\.project, savedProjectSnapshots\.current\.get\(current\.project\.id\)\)/);
  assert.match(page,/collectionHasUnsavedEdits\(current\.project, savedProjectSnapshots\.current\.get\(current\.project\.id\)\)/);
  assert.match(page,/const clean = !collectionHasUnsavedEdits\(view\.project, savedProjectSnapshots\.current\.get\(id\)\)/);
  assert.match(page,/if \(clean\) \{\s*setProjects\(previous => \[updated/);
  assert.match(page,/if \(!hasLocalEdits\) \{\s*savedProjectSnapshots\.current\.set\(projectId, JSON\.stringify\(result\.project\)\)/);
  assert.match(page,/const canSwitchCollection = \(\) =>/);
  assert.match(page,/const openCollection = \(p: Project\)/);
  assert.match(page,/const createCollection = \(\)/);
});
