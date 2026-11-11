import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Multi-Collection Production always initializes Live mode without environment selector', () => {
  const source = readFileSync('components/multi-collection-production.tsx', 'utf8');
  assert.match(source, /useState<'mock' \| 'live'>\('live'\)/);
  assert.doesNotMatch(source, /setEnvironment/);
  assert.doesNotMatch(source, /Generation environment/);
  assert.doesNotMatch(source, /Simulate success/);
  assert.match(source, /\/api\/image-batches/);
});
