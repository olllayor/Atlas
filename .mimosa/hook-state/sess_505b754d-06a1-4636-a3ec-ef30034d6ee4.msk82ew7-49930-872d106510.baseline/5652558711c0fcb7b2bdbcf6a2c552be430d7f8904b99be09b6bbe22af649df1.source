/**
 * Disabling a provider takes its models out of the catalog while conversations
 * that had picked one still name it. These cover the re-pointing that keeps
 * those conversations sendable.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelSummary } from '../src/shared/contracts';
import { repointUnavailableModels } from '../src/renderer/stores/useAppStore';

function model(id: string, overrides: Partial<ModelSummary> = {}): ModelSummary {
  return {
    id,
    providerId: 'custom:one',
    label: id,
    contextWindow: 200_000,
    isFree: false,
    supportsVision: false,
    supportsDocumentInput: false,
    supportsTools: true,
    archived: false,
    lastSyncedAt: '2026-07-30T00:00:00.000Z',
    lastSeenFreeAt: null,
    ...overrides
  };
}

test('selections pointing at a disabled provider fall back to the default model', () => {
  const models = [model('kept-a'), model('kept-b')];

  const repointed = repointUnavailableModels(
    { chat1: 'kept-a', chat2: 'gone-from-disabled-provider' },
    models,
    'kept-b'
  );

  assert.deepEqual(repointed, { chat1: 'kept-a', chat2: 'kept-b' });
});

test('an unchanged map is returned by identity so subscribers do not churn', () => {
  const models = [model('kept-a')];
  const selections = { chat1: 'kept-a' };

  assert.equal(repointUnavailableModels(selections, models, 'kept-a'), selections);
});

test('archived models do not count as available', () => {
  const models = [model('archived-one', { archived: true }), model('live-one')];

  assert.deepEqual(
    repointUnavailableModels({ chat1: 'archived-one' }, models, 'live-one'),
    { chat1: 'live-one' }
  );
});

test('with an empty catalog the stale entry is dropped rather than re-pointed', () => {
  assert.deepEqual(repointUnavailableModels({ chat1: 'gone' }, [], null), {});
});
