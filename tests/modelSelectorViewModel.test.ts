import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildModelSelectorViewModel,
  modelNeedsApiKey
} from '../src/renderer/components/modelSelectorViewModel.js';
import type { ModelSummary, ProviderId } from '../src/shared/contracts.js';

function model(id: string, overrides: Partial<ModelSummary> = {}): ModelSummary {
  return {
    id,
    providerId: 'custom:default',
    label: id,
    contextWindow: 128_000,
    isFree: false,
    supportsVision: false,
    supportsDocumentInput: false,
    supportsTools: true,
    archived: false,
    lastSyncedAt: new Date().toISOString(),
    lastSeenFreeAt: null,
    ...overrides
  };
}

function credential(providerId: ProviderId, hasSecret: boolean) {
  return { providerId, hasSecret, status: hasSecret ? ('valid' as const) : ('missing' as const), validatedAt: null };
}

test('the free filter keeps only models the provider does not charge for', () => {
  const view = buildModelSelectorViewModel({
    models: [
      model('free-one', { isFree: true }),
      model('paid-one'),
      model('gateway-free', { providerId: 'custom:abc', isFree: true })
    ],
    customProviders: [{ id: 'custom:abc', name: 'Gateway' }],
    showFreeOnly: true
  });

  assert.deepEqual(
    view.groups.flatMap((group) => group.models.map((entry) => entry.id)).sort(),
    ['free-one', 'gateway-free']
  );
});

test('turning the free filter off surfaces the whole catalog', () => {
  const models = [model('free-one', { isFree: true }), model('paid-one')];

  assert.equal(buildModelSelectorViewModel({ models, showFreeOnly: false }).totalCount, 2);
  assert.equal(buildModelSelectorViewModel({ models, showFreeOnly: true }).totalCount, 1);
});

test('the free filter is ignored when nothing in the catalog is free', () => {
  // Otherwise a user whose only provider is a custom endpoint sees an empty
  // picker with no obvious way to recover.
  const view = buildModelSelectorViewModel({
    models: [model('paid-one'), model('paid-two')],
    showFreeOnly: true
  });

  assert.equal(view.hasFreeModels, false);
  assert.equal(view.totalCount, 2);
});

test('models group under their configured provider name', () => {
  const view = buildModelSelectorViewModel({
    models: [model('a', { providerId: 'custom:one' }), model('b', { providerId: 'custom:two' })],
    customProviders: [
      { id: 'custom:one', name: 'NVIDIA' },
      { id: 'custom:two', name: 'Together' }
    ],
    showFreeOnly: false
  });

  assert.deepEqual(view.groups.map((group) => group.label).sort(), ['NVIDIA', 'Together']);
});

test('a model whose provider was deleted still groups under a readable label', () => {
  const view = buildModelSelectorViewModel({
    models: [model('orphan', { providerId: 'custom:gone' })],
    customProviders: [],
    showFreeOnly: false
  });

  assert.equal(view.groups[0]?.label, 'Removed provider');
});

test('providers with a saved key sort ahead of ones without', () => {
  const view = buildModelSelectorViewModel({
    models: [model('a', { providerId: 'custom:zeta' }), model('b', { providerId: 'custom:alpha' })],
    customProviders: [
      { id: 'custom:zeta', name: 'Zeta' },
      { id: 'custom:alpha', name: 'Alpha' }
    ],
    credentials: [credential('custom:zeta', true), credential('custom:alpha', false)],
    showFreeOnly: false
  });

  // Alphabetically Alpha would come first; readiness wins.
  assert.deepEqual(
    view.groups.map((group) => [group.label, group.configured]),
    [
      ['Zeta', true],
      ['Alpha', false]
    ]
  );
});

test('with no credential data every provider is treated as usable', () => {
  const view = buildModelSelectorViewModel({
    models: [model('a')],
    showFreeOnly: false
  });

  assert.equal(view.groups[0]?.configured, true);
  assert.equal(modelNeedsApiKey(model('a')), false);
});

test('modelNeedsApiKey flags only providers that are known to lack a key', () => {
  const credentials = [credential('custom:one', false), credential('custom:two', true)];

  assert.equal(modelNeedsApiKey(model('a', { providerId: 'custom:one' }), credentials), true);
  assert.equal(modelNeedsApiKey(model('b', { providerId: 'custom:two' }), credentials), false);
  // A provider missing from the credential list has no key saved either.
  assert.equal(modelNeedsApiKey(model('c', { providerId: 'custom:abc' }), credentials), true);
});

test('an empty catalog yields no groups', () => {
  const view = buildModelSelectorViewModel({ models: [], showFreeOnly: true });

  assert.deepEqual(view.groups, []);
  assert.equal(view.totalCount, 0);
  assert.equal(view.hasFreeModels, false);
});
