import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {researchBatchJsonl,batchResearchResult} from '../lib/openai-batch-research.ts';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const research=read('app/api/research-jobs/route.ts');
const automation=read('app/api/full-automation/route.ts');
const prompts=read('app/api/prompt-jobs/route.ts');
const settings=read('components/studio-settings.tsx');
const route=read('app/api/settings/route.ts');
const studio=read('app/api/studio/route.ts');
const page=read('app/page.tsx');

test('Research and prompts default to separate Terra/Luna models; Image Production defaults to Flare Low',()=>{
  assert.match(settings,/analysisModel: 'gpt-6\.1-terra', automationPromptModel: 'gpt-6-luna'/);
  assert.match(route,/analysisModel: 'gpt-6\.1-terra', automationPromptModel: 'gpt-6-luna'/);
  assert.match(settings,/model: 'gpt-image-2\.5-flare', quality: 'low'/);
  assert.match(settings,/automationImageModel: 'gpt-image-2\.5-flare'/);
  assert.match(automation,/promptModel:savedPromptModel,batchImageModel:selectedBatchImageModel/);
  assert.match(automation,/const model=p\.fullAutomation\?\.promptModel \|\| p\.fullAutomation\?\.textModel/);
  assert.match(prompts,/automation\.promptModel \|\| automation\.textModel/);
  assert.match(page,/const selectedModel = lockedPromptModel \|\| preferences\.automationPromptModel/);
});

test('new Research/Hybrid and Style DNA use actual OpenAI Batch receipts',()=>{
  assert.match(research,/transport:'batch', workers/);
  assert.match(research,/if\(job\.transport==='batch'\) return pollResearchBatch/);
  assert.match(research,/completion_window:'24h'/);
  assert.match(research,/endpoint:'\/v1\/responses'/);
  assert.match(research,/batchId=await submitResearchBatch/);
  assert.match(research,/mergeBatchId:batchId,mergeStatus:'queued'/);
});

test('Batch response parser selects exact custom ID and validates JSON',()=>{
  const jsonl=researchBatchJsonl('test-research','gpt-6.1-terra',[{role:'user',content:[{type:'input_text',text:'test'}]}],2000);
  const request=JSON.parse(jsonl);
  assert.equal(request.custom_id,'test-research');
  assert.equal(request.body.model,'gpt-6.1-terra');
  assert.equal(request.url,'/v1/responses');
  assert.equal(request.body.background,undefined);
  const result=JSON.stringify({custom_id:'test-research',response:{status_code:200,body:{output:[{content:[{text:JSON.stringify({theme:'Fairy',characters:[{name:'Fairy'}]})}]}]}}});
  assert.deepEqual(batchResearchResult(result,'unrelated'),null);
  assert.deepEqual(JSON.parse(batchResearchResult(result,'test-research').text).theme,'Fairy');
  assert.match(batchResearchResult(JSON.stringify({custom_id:'test-research',error:{message:'bad'}}),'test-research').error,/bad/);
});

test('AI Fill and similarity rewrites use recoverable OpenAI Batches, no direct OpenAI text call in automation',()=>{
  assert.match(automation,/expansionBatch\?:/);
  assert.match(automation,/revisionBatch\?:/);
  assert.match(automation,/submitResearchBatch\(secret,'character-expansion'/);
  assert.match(automation,/submitResearchBatch\(secret,'similarity-revision'/);
  assert.match(automation,/getResearchBatchResult\(secret,receipt\.batchId,'character-expansion'\)/);
  assert.match(automation,/getResearchBatchResult\(secret,receipt\.batchId,'similarity-revision'\)/);
  assert.doesNotMatch(automation,/apiPost\(req,studioPost,\{\s*action:'expand'/);
  assert.doesNotMatch(automation,/apiPost\(req,rewritePost,/);
  assert.match(automation,/if\(!receipt\.batchId\)/);
});

test('Etsy Listing Draft preserves Etsy API title description tags by default; enriches other SEO with Gemini',()=>{
  assert.match(automation,/analyzeWithAi:false/);
  assert.match(automation,/seoProvider:'gemini'/);
  assert.match(automation,/if\(config\.seoProvider==='openai'\)/);
  assert.match(studio,/title:reference\.title\.trim\(\)\.slice\(0,ETSY_TITLE_MAX\)/);
  assert.match(studio,/description:reference\.description\.trim\(\)/);
  assert.match(studio,/tags:reference\.tags\.filter\(t=>typeof t==='string'\)\.slice\(0,13\)/);
  assert.match(studio,/\.\.\.candidate, \.\.\.faithfulSeo, imageAltTexts: \[alt\]/);
});
