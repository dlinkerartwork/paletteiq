import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireProductionLocks } from '../lib/production-locks.ts';

test('overlapping character submissions are rejected until release', () => {
  const release = acquireProductionLocks('owner', 'collection', ['one', 'two']);
  assert.equal(typeof release, 'function');
  assert.equal(acquireProductionLocks('owner', 'collection', ['two', 'three']), null);
  const unrelated = acquireProductionLocks('owner', 'collection', ['three']);
  assert.equal(typeof unrelated, 'function');
  unrelated();
  release();
  release();
  const again = acquireProductionLocks('owner', 'collection', ['two']);
  assert.equal(typeof again, 'function');
  again();
});

test('different collections and owners do not block each other', () => {
  const one = acquireProductionLocks('owner-a', 'collection-a', ['one']);
  const two = acquireProductionLocks('owner-a', 'collection-b', ['one']);
  const three = acquireProductionLocks('owner-b', 'collection-a', ['one']);
  assert.ok(one && two && three);
  one(); two(); three();
});
