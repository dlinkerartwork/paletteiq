import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const imageRoute=readFileSync(new URL('../app/api/image-batches/route.ts',import.meta.url),'utf8');
const production=readFileSync(new URL('../components/image-production.tsx',import.meta.url),'utf8');

test('Image Production submits multiple independent groups without awaiting OpenAI Batch completion',()=>{
  assert.match(production,/const \[batchGroupSize, setBatchGroupSize\] = useState<10\|25\|50>\(10\)/);
  assert.match(production,/for\(let offset=0;offset<ids\.length;offset\+=batchGroupSize\)/);
  assert.match(production,/const workers=Array\.from\(\{length:Math\.min\(3,chunks\.length\)\},async\(\)=>/);
  assert.match(production,/await Promise\.all\(workers\)/);
  assert.match(production,/setJobs\(previous=>\[data\.job,\.\.\.previous\.filter/);
  assert.match(production,/Each completed group is imported immediately when its output file becomes available/);
  assert.match(production,/Check OpenAI Batch activity before any manual resubmission/);
  assert.match(production,/groups of \{batchGroupSize\} images/);
});

test('per-collection polling imports independent Batch result files instead of only first active job',()=>{
  assert.match(imageRoute,/const IMAGE_BATCH_SYNC_PER_COLLECTION = 4/);
  assert.match(imageRoute,/const syncingProjectIds = new Set<string>\(\)/);
  assert.match(imageRoute,/if \(syncingJobIds\.has\(job\.id\) \|\| syncingProjectIds\.has\(job\.projectId\)\) return job/);
  assert.match(imageRoute,/const pendingRows=rows\.filter\(row=>isActiveBatchStatus\(row\.status\)\)/);
  assert.match(imageRoute,/for\(const row of pendingRows\)\{/);
  assert.doesNotMatch(imageRoute,/const syncTarget = rows\.find\(row => isActiveBatchStatus/);
  assert.match(imageRoute,/return Response\.json\(\{jobs:rows\.map\(row=>freshById\.get\(row\.id\)\|\|safeJob\(row\)\)\}\)/);
});

test('background tray monitoring handles more than one Batch per collection',()=>{
  assert.match(imageRoute,/const perProject = new Map<string,number>\(\)/);
  assert.match(imageRoute,/if\(count>=IMAGE_BATCH_SYNC_PER_COLLECTION\)return false/);
  assert.match(imageRoute,/for \(const row of active\) \{/);
  assert.match(imageRoute,/await syncJob\(row, key, user\.userId, user\.email, user\.displayName\)/);
});

test('an in-progress OpenAI Batch cannot advertise imported images without result file',()=>{
  assert.match(imageRoute,/const isTerminal = \['completed', 'expired', 'cancelled', 'failed'\]\.includes\(batch\.status\)/);
  assert.match(imageRoute,/if \(isTerminal && bucket\) \{/);
  assert.match(imageRoute,/if \(!item \|\| item\.status !== 'pending'\) continue/);
  assert.match(imageRoute,/await bucket\.put\(batchAssetKey/);
  assert.match(imageRoute,/if \(changedIds\.size\) \{/);
  assert.match(imageRoute,/mergeNewBatchResults\(project\.characters, items, changedIds\)/);
});
