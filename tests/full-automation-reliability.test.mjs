import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const flow = read('app/api/full-automation/route.ts');
const image = read('app/api/image-batches/route.ts');
const page = read('app/page.tsx');
const electron = read('desktop/main.cjs');
const monitor = read('desktop/background-batch-monitor.cjs');

test('100/100 prompts advance before terminal errors block paid retries',()=>{
  const begin=flow.indexOf("} else if (f.stage === 'prompts')");
  const end=flow.indexOf("} else if (f.stage === 'images')",begin);
  const source=flow.slice(begin,end);
  assert.ok(source.indexOf("if (!missing.length) await setStage(owner,id,'images')") < source.indexOf("['failed','cancelled','expired','completed_with_errors']"));
  assert.match(source,/if\(current\.promptJob && isActivePromptBatch\(current\.promptJob\)\)/);
  assert.match(source,/await apiGet\(req,promptGet,id\)/);
  assert.match(source,/missing=current\.characters\.filter/);
});
test('AI Fill validates exact response receipt on import',()=>{
  assert.match(flow,/const present=receipt\.id==='legacy'/);
  assert.match(flow,/present\.responseId!==receipt\.responseId/);
  assert.match(flow,/planExpansionSlots\(flow\.target,fresh\.characters\.length,active/);
  assert.match(flow,/expansionBatches:\[\.\.\.\(latest\.fullAutomation\?\.expansionBatches\|\|\[\]\),\.\.\.claims\]/);
});
test('image batch reserves character IDs before OpenAI POST',()=>{
  const reservation=image.indexOf('await db.insert(imageBatches).values(record)');
  const remote=image.indexOf("openai(key, 'batches',", reservation);
  assert.ok(reservation!==-1 && remote>reservation);
  assert.match(image,/openaiBatchId: 'pending:' \+ reservationId/);
  assert.match(image,/status:'uncertain'/);
  assert.match(flow,/row\.openaiBatchId\.startsWith\('pending:'\)/);
  assert.match(image,/Some characters already have a pending Batch job/);
});
test('image importer uses optimistic compare-and-swap instead of overwriting concurrent edits',()=>{
  assert.match(image,/mergeNewBatchResults\(project\.characters, items, changedIds\)/);
  assert.match(image,/eq\(projects\.updatedAt,saved\[0\]\.updatedAt\)/);
  assert.match(image,/if \(!committed\) throw Error\('Collection changed during image import/);
});
test('polling only loads active JSON rows and keeps lease as JSON1 field',()=>{
  assert.match(flow,/leaseUntil: sql<number>`CAST\(COALESCE\(json_extract/);
  assert.match(flow,/data: sql`json_set\(\$\{projects\.data\}, '\$\.fullAutomation\.leaseUntil'/);
  assert.doesNotMatch(flow,/rows\.map\(x=>\(\{id:x\.id,flow:\(JSON\.parse/);
  assert.match(page,/fetch\('\/api\/studio\?projectId=' \+ encodeURIComponent\(item\.id\)/);
});
test('image bytes are decoded in chunks rather than as one large V8 string',()=>{
  assert.match(image,/function decodeImageBase64/);
  assert.match(image,/offset \+= 65536/);
  assert.match(image,/decodeImageBase64\(b64\)/);
  assert.doesNotMatch(image,/Uint8Array\.from\(atob\(b64\)/);
});
test('desktop supervises backend with bounded restarts, and nonoverlapping hidden monitor',()=>{
  assert.match(electron,/const maxRecoveries = 2/);
  assert.match(electron,/stopOwnedBackend\(old\)/);
  assert.match(electron,/Three consecutive HTTP health failures/);
  assert.match(monitor,/if \(polling\) return false/);
  assert.match(page,/may submit NEW paid image batches/);
});

test('research retry requires explicit payment confirmation and remote token-limit verification',()=>{
  const research=read('app/api/research-jobs/route.ts');
  assert.match(research,/body\.action === 'retry-token-limited'/);
  assert.match(research,/data\.status!=='incomplete' \|\| data\.incomplete_details\?\.reason!=='max_output_tokens'/);
  assert.match(research,/max_output_tokens:13000/);
  assert.match(research,/retryClaimId=crypto\.randomUUID\(\)/);
  assert.match(research,/claim\.retryClaimId!==retryClaimId/);
  assert.match(research,/retryHistory:\[/);
  assert.match(research,/current\.workers!\.map\(w=>failed\.some/);
  assert.match(research,/status:'uncertain',error:'Retry submission may have reached OpenAI/);
  assert.match(page,/retryTokenLimitedResearch/);
  assert.match(page,/action:'retry-token-limited'/);
  assert.match(page,/window\.confirm\(/);
  assert.match(page,/Retry token-limited Research workers \(paid/);
});

test('small Research targets use one response with a strict character quota',()=>{
  const research=read('app/api/research-jobs/route.ts');
  const prompts=read('lib/creative-research-prompts.ts');
  assert.match(research,/const hybrid = requested > 20 && selectedImages\.length > 1/);
  assert.match(research,/requested <= 20 \? \{ reasoning: \{ effort: 'low' \} \}/);
  assert.match(research,/requested <= 20\s*\? Math\.min\(13000, Math\.max\(8192, 3200 \+ requested \* 250\)\)/);
  assert.match(prompts,/const fullCatalog = true/);
  assert.match(prompts,/Return EXACTLY \$\{subjectCount\} ORIGINAL, distinct character concepts/);
  assert.match(research,/const needed = Math\.max\(0, job\.target - uniquePrevious\.length\)/);
  assert.match(research,/selectDiverseConcepts\(candidates, uniquePrevious, job\.target, needed/);
});

test('adaptive single-worker research finishes without a second paid merge',()=>{
  const research=read('app/api/research-jobs/route.ts');
  const completed=research.indexOf("if (!latest.mergeStatus && latest.workers?.length===1");
  const merge=research.indexOf("if (latest.mergeStatus==='planned')",completed);
  assert.ok(completed>0 && merge>completed,'single worker must be imported before merge handling');
  assert.match(research.slice(completed,merge),/latest\.workers\[0\]\.status==='completed'/);
  assert.match(research.slice(completed,merge),/return finish\(user\.userId,projectId,latest/);
  assert.match(research.slice(completed,merge),/resultText/);
});
