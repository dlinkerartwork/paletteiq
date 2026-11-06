import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Image Production renders cached Batch jobs before OpenAI sync', () => {
  const component = readFileSync('components/image-production.tsx', 'utf8');
  assert.match(component, /batchJobSnapshot = new Map/);
  assert.match(component, /useState<Job\[\]>\(\(\) => batchJobSnapshot\.get\(project\.id\)/);
  assert.match(component, /await refresh\(false, false\)/);
  assert.match(component, /await refresh\(false, true\)/);
  assert.match(component, /sync=\$\{sync \? '1' : '0'\}/);
  assert.match(component, /Loading saved Batch progress/);
  assert.match(component, /!jobsLoaded \|\| !ids\.length/);
});
