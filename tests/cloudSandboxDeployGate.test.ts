import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PACKAGED_DEPLOY_UNAVAILABLE_ERROR,
  cloudSandboxDeployAvailability,
} from '../src/main/ai/tools/sandbox/cloudSandboxDeployAvailability.js';

test('packaged builds cannot deploy from source', () => {
  const availability = cloudSandboxDeployAvailability(true);

  assert.equal(availability.canDeploy, false);
  assert.equal(availability.code, 'packaged-unavailable');
  assert.equal(availability.error, PACKAGED_DEPLOY_UNAVAILABLE_ERROR);
  assert.match(availability.error ?? '', /source-checkout/i);
});

test('dev / source checkouts keep deploy available', () => {
  const availability = cloudSandboxDeployAvailability(false);

  assert.deepEqual(availability, { canDeploy: true });
});
