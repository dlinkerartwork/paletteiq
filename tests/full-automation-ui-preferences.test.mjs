import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const page = file('app/page.tsx');
const flow = file('app/api/full-automation/route.ts');
const studio = file('app/api/studio/route.ts');
const rewrite = file('app/api/regenerate-prompt/route.ts');
const modelList = file('app/api/settings/route.ts');

test('Full Automation uses a user-chosen model initialized from saved Settings', () => {
  assert.match(page, /project\.fullAutomation\?\.textModel : undefined\) \|\|/);
  assert.match(page, /project\.researchModel \|\|/);
  assert.match(page, /project\.researchJob\?\.model \|\| preferences\.analysisModel/);
  assert.match(page, /id="source-analysis-model" value=\{visualModel\}/);
  assert.doesNotMatch(page, /id="source-analysis-model"[^\n]*disabled=\{!!busy \|\| fullAutoRequested\}/);
  assert.match(page, /update\(\{ researchModel:e\.target\.value \}\)/);
  assert.match(page, /action: 'start', projectId: project\.id, target, model: visualModel/);
  assert.match(page, /selectedImages: chosenImages, target, model: visualModel/);
  assert.match(flow, /textModel:requestedModel/);
  assert.match(flow, /researchModel:requestedModel/);
  assert.match(modelList, /slice\(0, 100\)/);
  assert.doesNotMatch(modelList, /codex\|mini\|nano\|micro\|lite/);
});

test('chosen GPT model remains bound to text stages, image Batch stays image-capable', () => {
  assert.ok(flow.includes("submitStandardTextResponse(secret,textModel(p)"));
  assert.ok(flow.includes("const model=p.fullAutomation?.promptModel || p.fullAutomation?.textModel || config.automationPromptModel"));
  assert.match(flow, /seoOpenaiModel:textModel\(p,config\.seoOpenaiModel/);
  assert.match(flow, /model:imageModel\(p,config\)/);
  assert.match(studio, /model: expansionModel, input/);
  assert.ok(flow.includes("p.fullAutomation?.promptModel||'gpt-6-luna'"));
});

test('character target stays at collection or active workflow count after settings load', () => {
  assert.match(page, /characterTarget\?: number/);
  assert.match(page, /project\.fullAutomation\?\.target \?\? project\.characterTarget/);
  assert.match(page, /project\.researchJob\?\.target \?\? preferences\.target/);
  assert.match(page, /setProject\(prev => \(\{ \.\.\.prev, characterTarget: next \}\)\)/);
  assert.match(page, /const p = \{ \.\.\.blank\(\), characterTarget: preferences\.target/);
  assert.match(page, /setCollectionTarget\(Number\(e\.target\.value\)\)/);
  assert.doesNotMatch(page, /setPreferences\(prefs\); setTarget\(prefs\.target\)/);
  assert.match(flow, /characterTarget:target/);
});

test('Auto-follow navigates only on a safe server-confirmed stage transition', () => {
  assert.match(page, /automationStageTab = \(stage\?: FullAutomation\['stage'\]\)/);
  assert.match(page, /stage === 'expanding'\) return 'analysis'/);
  assert.match(page, /stage === 'prompts'\) return 'prompts'/);
  assert.match(page, /stage === 'listing' \|\| stage === 'completed'/);
  assert.match(page, /oldStage !== newStage && fromTab && toTab && fromTab !== toTab/);
  assert.match(page, /view\.tab === fromTab && isStudioTabEnabled\(toTab\)/);
  assert.match(page, /!thumbnailSaveControlsRef\.current\?\.hasUnsaved\(\)/);
  assert.match(page, /const clean = !collectionHasUnsavedEdits\(view\.project, savedProjectSnapshots\.current\.get\(id\)\)/);
  assert.match(page, /autoFollowRef\.current && view\.project\.id === id && clean/);
  assert.match(page, /paletteiq-auto-follow-automation/);
  assert.match(page, /Auto Follow — switch tabs when the current stage finishes/);
  assert.match(page, /className="research-auto-follow"/);
  assert.match(page, /editor\.tab === 'analysis'/);
  assert.match(page, /editor\.tab === 'prompts'/);
});
