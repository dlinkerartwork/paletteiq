import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseResearchWorkerOutput } from '../lib/research-worker-output.ts';

const route=readFileSync(new URL('../app/api/research-jobs/route.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');

test('nested Research analysis recovers a usable character group without paying again',()=>{
  const parsed=parseResearchWorkerOutput(JSON.stringify({
    analysis:{theme:'Blush Safari',characters:[{name:'Sleepy gazelle',family:'gazelle'}],
      styleDNA:{visualLanguage:'watercolor'}}
  }),'Baby Safari Clipart');
  const data=JSON.parse(parsed.resultText);
  assert.equal(data.theme,'Blush Safari');
  assert.equal(data.characters[0].name,'Sleepy gazelle');
  assert.equal(parsed.conceptCount,1);
});

test('missing theme uses explicitly labeled source metadata, never invents a visual claim',()=>{
  const parsed=parseResearchWorkerOutput(JSON.stringify({
    characters:[{name:'Baby toucan'}],style:'Watercolor'
  }),'Baby Safari Clipart');
  assert.equal(JSON.parse(parsed.resultText).theme,'Baby Safari Clipart');
  assert.match(parsed.warning,/source listing title/);
});

test('alternative concepts and observed subjects can be retained for Style DNA merge',()=>{
  const parsed=parseResearchWorkerOutput(JSON.stringify({
    result:{generalTheme:'Woodland',observedSubjects:['Deer','Fox']}
  }),'Forest Clipart');
  assert.deepEqual(JSON.parse(parsed.resultText).characters.map(item=>item.name),['Deer','Fox']);
  assert.match(parsed.warning,/observedSubjects/);
});

test('style-only group is retained with a warning instead of silently fabricating characters',()=>{
  const parsed=parseResearchWorkerOutput(JSON.stringify({
    theme:'Pastel Nursery',styleDNA:{shapeLanguage:'Soft rounded silhouettes'},
    imageObservations:[{imageIndex:1,subjects:['a rabbit']}]
  }),'Pastel Nursery Clipart');
  assert.equal(parsed.conceptCount,0);
  assert.deepEqual(JSON.parse(parsed.resultText).characters,[]);
  assert.match(parsed.warning,/without character proposals/);
});

test('empty or corrupted output cannot be treated as a successful Research worker',()=>{
  assert.throws(()=>parseResearchWorkerOutput('{bad-json','listing'),/not valid JSON/);
  assert.throws(()=>parseResearchWorkerOutput(JSON.stringify({theme:'Safari',characters:[]}), 'listing'),
    /no usable character concepts or visual observations/);
  assert.throws(()=>parseResearchWorkerOutput('{}','listing'),/no usable character concepts/);
});

test('failed stored Research workers can be recovered by existing response ID only',()=>{
  assert.match(route,/body\.action === 'recover-existing'/);
  const recover=route.slice(route.indexOf("if (body.action === 'recover-existing')"),
    route.indexOf("if (active(saved.data.researchJob))"));
  assert.match(recover,/job\.status !== 'failed'/);
  assert.match(recover,/job\.transport !== 'standard'/);
  assert.match(recover,/job\.mergeStatus !== 'planned'/);
  assert.match(recover,/worker\.responseId!/);
  assert.match(recover,/parseResearchWorkerOutput\(extractText\(data\),job\.source\.title\)/);
  assert.match(recover,/status:'completed',resultText:worker\.resultText/);
  assert.match(recover,/status:'in_progress',error:undefined/);
  assert.doesNotMatch(recover,/method:'POST'|submitResearchBatch|submitStandardTextResponse|fetchResearchImageDataUrls/);
});

test('normal worker polling validates flexible schema without creating a new paid worker',()=>{
  assert.match(route,/parseResearchWorkerOutput\(raw, job\.source\.title\)/);
  assert.match(route,/status:'completed',resultText:parsed\.resultText/);
  assert.match(route,/warning:parsed\.warning,error:undefined/);
  assert.match(route,/Invalid research worker output:/);
});

test('manual recovery is visible for a failed job and requires confirmation',()=>{
  assert.match(page,/Recover Existing Research Responses/);
  assert.match(page,/action:'recover-existing',projectId,jobId:job\.id/);
  assert.match(page,/window\.confirm\(/);
  assert.match(page,/ONE new paid synthesis request/);
  assert.match(page,/project\.researchJob\.error\?\.includes\('Invalid research worker output'\)/);
});
