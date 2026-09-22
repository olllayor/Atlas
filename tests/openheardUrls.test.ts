import assert from 'node:assert/strict';
import test from 'node:test';

import { openHeardPublicUrl } from '../src/shared/openheard.js';

test('openHeardPublicUrl returns the measured public paths', () => {
  assert.equal(openHeardPublicUrl({ kind: 'board' }), 'https://atlas.openheard.com/');
  assert.equal(openHeardPublicUrl({ kind: 'roadmap' }), 'https://atlas.openheard.com/roadmap');
  assert.equal(openHeardPublicUrl({ kind: 'changelog' }), 'https://atlas.openheard.com/changelog');
  assert.equal(openHeardPublicUrl({ kind: 'newPost' }), 'https://atlas.openheard.com/');
});
