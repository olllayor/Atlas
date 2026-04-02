import assert from 'node:assert/strict';
import test from 'node:test';

import { getGlmSeedModels } from '../src/shared/providerCatalogs.js';

test('getGlmSeedModels returns the curated GLM catalog', () => {
  const models = getGlmSeedModels();

  assert.deepEqual(
    models.map((model) => model.id),
    ['glm-5', 'glm-5-turbo', 'glm-4.7', 'glm-4.7-flash', 'glm-4.5-air', 'glm-4.5-flash']
  );
  assert.ok(models.every((model) => model.providerId === 'glm'));
  assert.ok(models.every((model) => model.supportsTools === false));
  assert.ok(models.every((model) => model.supportsVision === false));
  assert.equal(models.filter((model) => model.isFree).length, 2);
});
