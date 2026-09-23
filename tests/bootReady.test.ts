import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBootReadyGate } from '../src/main/bootstrap/bootReady';

test('ready settles once resolve is called', async () => {
  const gate = createBootReadyGate();
  let settled = false;
  void gate.ready.then(() => {
    settled = true;
  });

  assert.equal(settled, false);
  gate.resolve();
  await gate.ready;
  assert.equal(settled, true);
});

test('a second resolve is a no-op', async () => {
  const gate = createBootReadyGate();
  gate.resolve();
  await gate.ready;
  gate.resolve();
  await gate.ready;
});
