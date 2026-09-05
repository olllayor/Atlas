import assert from 'node:assert/strict';
import { test } from 'node:test';

import { repeatingToastId } from '../src/renderer/lib/notify';

test('repeatingToastId rotates through a bounded ring per key', () => {
  const key = `send-${Date.now()}`;
  assert.equal(repeatingToastId(key), `${key}:0`);
  assert.equal(repeatingToastId(key), `${key}:1`);
  assert.equal(repeatingToastId(key), `${key}:2`);
  // Wraps instead of minting forever: retained toast state stays capped.
  assert.equal(repeatingToastId(key), `${key}:0`);
});

test('repeatingToastId rings are independent per key', () => {
  const first = `first-${Date.now()}`;
  const second = `second-${Date.now()}`;
  assert.equal(repeatingToastId(first), `${first}:0`);
  assert.equal(repeatingToastId(second), `${second}:0`);
  assert.equal(repeatingToastId(first), `${first}:1`);
});
