import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const promptApi = readFileSync(new URL('../app/api/prompt-jobs/route.ts', import.meta.url), 'utf8');
const flow = readFileSync(new URL('../app/api/full-automation/route.ts', import.meta.url), 'utf8');

test('AI Prompts use a separately saved Luna default rather than silently following Research', () => {
  assert.match(page, /const selectedModel = lockedPromptModel \\|\\| preferences\\.automationPromptModel/);
  assert.match(page, /project\\.fullAutomation\\.promptModel \\|\\| project\\.fullAutomation\\.textModel/);
  assert.match(page, /setPromptProvider\('openai'\)/);
  assert.match(page, /setPromptModel\(selectedModel\)/);
  assert.doesNotMatch(page, /options\.length && !options\.some\(m => m\.id === promptModel\)/);
});

test('active Full Automation prompt model is displayed and cannot be changed', () => {
  assert.match(page, /const lockedPromptModel = project\.fullAutomation\?\.enabled/);
  assert.match(page, /project\\.fullAutomation\\.promptModel \\|\\| project\\.fullAutomation\\.textModel/);
  assert.match(page, /value=\{lockedPromptModel \|\| promptModel\}/);
  assert.match(page, /disabled=\{!!busy \|\| hasActivePromptJob\(project\.promptJob\) \|\| !!lockedPromptModel\}/);
  assert.match(page, /Submitted Prompt Batch model: \{project\.promptJob\.model\}/);
  assert.match(page, /if \(busy \|\| hasActivePromptJob\(project\.promptJob\) \|\| lockedPromptModel\) return/);
});

test('server prevents a mismatched paid prompt batch model while automation is active', () => {
  assert.match(promptApi, /automation\?\.enabled && automation\.stage !== 'completed'/);
  assert.match(promptApi, /if \(selected && model !== selected\)/);
  assert.match(promptApi, /Full Automation Prompt model must match the frozen AI Prompts model/);
  assert.match(flow, /const model=p\\.fullAutomation\\?\\.promptModel \\|\\| config\\.automationPromptModel/);
});
