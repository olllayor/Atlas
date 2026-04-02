import assert from 'node:assert/strict';
import test from 'node:test';

import { getToastDuration, hasToastAction } from '../src/renderer/lib/toastConfig.js';

test('getToastDuration keeps errors visible longer than other tones', () => {
  assert.equal(getToastDuration('success'), 2500);
  assert.equal(getToastDuration('info'), 2500);
  assert.equal(getToastDuration('error'), 4500);
});

test('hasToastAction only returns true when both label and handler exist', () => {
  assert.equal(hasToastAction({ actionLabel: 'Retry', onAction: () => undefined }), true);
  assert.equal(hasToastAction({ actionLabel: 'Retry' }), false);
  assert.equal(hasToastAction({ actionLabel: '   ', onAction: () => undefined }), false);
});
