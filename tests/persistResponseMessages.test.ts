import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldPersistResponseMessages } from '../src/main/ai/core/persistResponseMessages.js';

test('shouldPersistResponseMessages only persists provider messages when tools are enabled', () => {
  assert.equal(shouldPersistResponseMessages([], true), false);
  assert.equal(shouldPersistResponseMessages([{ role: 'assistant', content: 'done' }], false), false);
  assert.equal(shouldPersistResponseMessages([{ role: 'assistant', content: 'done' }], true), true);
});
