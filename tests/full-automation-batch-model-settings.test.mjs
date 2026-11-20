import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IMAGE_BATCH_MODELS, DEFAULT_IMAGE_BATCH_MODEL, isImageBatchModel, imageBatchModelError } from '../lib/image-batch-models.ts';

const load = name => readFileSync(new URL('../'+name, import.meta.url),'utf8');
const settings=load('app/api/settings/route.ts');
const settingsUi=load('components/studio-settings.tsx');
const flow=load('app/api/full-automation/route.ts');
const images=load('app/api/image-batches/route.ts');
const production=load('components/image-production.tsx');
const page=load('app/page.tsx');

test('image Batch capability is explicit and excludes unsupported regular image models', () => {
  assert.ok(IMAGE_BATCH_MODELS.length>0);
  assert.ok(isImageBatchModel(DEFAULT_IMAGE_BATCH_MODEL));
  assert.equal(isImageBatchModel('gpt-image-1-mini'),false);
  assert.equal(isImageBatchModel('gpt-image-2'),false);
  assert.match(imageBatchModelError('gpt-image-1-mini'), /No paid Batch was submitted/);
  assert.match(settings,/batchSupported: isImageBatchModel\(row\.id\)/);
  assert.match(images,/if \(!isImageBatchModel\(data\.model\)\) return fail\(imageBatchModelError\(data\.model\), 422\)/);
});

test('Settings lets user pick only supported accessible Image Batch models', () => {
  assert.match(settingsUi,/FULL AUTOMATION BATCH IMAGE MODEL/);
  assert.match(settingsUi,/openaiImageModels\.filter\(m => m\.batchSupported\)/);
  assert.match(settingsUi,/edit\('automationImageModel', e\.target\.value\)/);
  assert.match(settingsUi,/Only models verified for the OpenAI Image Batch endpoint/);
  assert.match(settings,/!isImageBatchModel\(prefs\.automationImageModel\)/);
});

test('Full Automation freezes selected batch model and quality at start', () => {
  assert.match(flow,/batchImageModel\?: string; imageQuality\?: string/);
  assert.match(flow,/selectedBatchImageModel=config\.automationImageModel \|\| DEFAULT_IMAGE_BATCH_MODEL/);
  assert.match(flow,/if \(!isImageBatchModel\(selectedBatchImageModel\)\) return bad\(imageBatchModelError/);
  assert.match(flow,/batchImageModel:selectedBatchImageModel,imageQuality:quality\(config\)/);
  assert.match(flow,/const selected = p\.fullAutomation\?\.batchImageModel \|\| prefs\.automationImageModel/);
  assert.match(flow,/if \(!isImageBatchModel\(selected\)\) throw Error\(imageBatchModelError/);
  assert.match(flow,/model:imageModel\(p,config\),quality:f\.imageQuality\|\|quality\(config\)/);
  assert.match(flow,/model:imageModel\(p,config\),quality:f\.imageQuality \|\| quality\(config\),regenerate:true/);
  assert.doesNotMatch(flow,/prefs\.automationImageModel! : 'gpt-image-2\.5-flare'/);
});

test('Image Production and automation progress display the chosen Batch model', () => {
  assert.match(page,/batchPreferredModel=\{project\.fullAutomation\?\.batchImageModel \|\| preferences\.automationImageModel\}/);
  assert.match(production,/useState\(batchPreferredModel\)/);
  assert.match(production,/setBatchModel\(batchPreferredModel\)/);
  assert.match(page,/Batch image model: \{project\.fullAutomation\.batchImageModel \|\| preferences\.automationImageModel\}/);
});
