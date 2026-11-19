import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const endpoint = readFileSync(new URL('../app/api/full-automation/route.ts', import.meta.url), 'utf8');

test('analysis tab restores authoritative saved Full Automation flow', () => {
  assert.match(page, /const refreshAutomationStatus = async/);
  assert.match(page, /\/api\/full-automation\?projectId=/);
  assert.match(page, /tab !== 'analysis'/);
  assert.match(page, /fullAutomation: flow \?\? undefined/);
  assert.match(page, /\[project\.id, project\.fullAutomation\?\.enabled\]/);
});

test('restarting analysis with existing flow is blocked BEFORE collection save or paid job submission', () => {
  const begin = page.indexOf('const runAnalyze = async');
  const end = page.indexOf('const generatePrompts = async', begin);
  const analyze = page.slice(begin, end);
  const refresh = analyze.indexOf('await refreshAutomationStatus(project.id)');
  const guard = analyze.indexOf("previous?.enabled && previous.stage !== 'completed'");
  const save = analyze.indexOf("await api({ action: 'save'");
  const submit = analyze.indexOf("fetch('/api/research-jobs'");
  assert.ok(refresh !== -1 && guard > refresh && save > guard && submit > save);
  assert.match(analyze, /Use Resume Full Automation above/);
});

test('failure path cannot pause a pre-existing paid workflow', () => {
  const begin = page.indexOf('const runAnalyze = async');
  const end = page.indexOf('const generatePrompts = async', begin);
  const analyze = page.slice(begin, end);
  assert.match(analyze, /let startedNewAutomation = false/);
  assert.match(analyze, /startedNewAutomation = true/);
  assert.match(analyze, /if \(startedNewAutomation\)/);
  assert.match(endpoint, /An automation workflow already exists/);
  assert.match(page, /Resume Full Automation \(review costs\/jobs first\)/);
});
