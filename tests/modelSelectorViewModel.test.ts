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

test('a new chat opens on the model the user last picked', async () => {
  const { chooseDefaultModel } = await import('../src/renderer/stores/useAppStore.js');

  const models = [
    { id: 'gateway/cheap-free', providerId: 'custom:a', isFree: true, archived: false },
    { id: 'gateway/the-one-i-use', providerId: 'custom:b', isFree: false, archived: false },
  ] as never;

  // The remembered pick wins over the free-model preference: it is the only
  // signal that reflects a real choice.
  assert.equal(chooseDefaultModel(models, null, 'gateway/the-one-i-use'), 'gateway/the-one-i-use');

  // Without a memory the previous preference order is unchanged.
  assert.equal(chooseDefaultModel(models, null, null), 'gateway/cheap-free');

  // A remembered model that is gone (provider removed, or archived) is ignored
  // rather than selecting something unusable.
  assert.equal(chooseDefaultModel(models, null, 'gateway/deleted'), 'gateway/cheap-free');

  const archived = [
    { id: 'gateway/cheap-free', providerId: 'custom:a', isFree: true, archived: false },
    { id: 'gateway/stale', providerId: 'custom:b', isFree: false, archived: true },
  ] as never;
  assert.equal(chooseDefaultModel(archived, null, 'gateway/stale'), 'gateway/cheap-free');
});

test('OpenCode models group under their own name and never ask for an API key', () => {
  const viewModel = buildModelSelectorViewModel({
    models: [
      model('opencode/claude-opus-4-7', { providerId: 'opencode', label: 'Claude Opus 4.7' }),
      model('gpt-5', { providerId: 'custom:openai' })
    ],
    customProviders: [{ id: 'custom:openai', name: 'OpenAI' }],
    credentials: [credential('custom:openai', true)],
    showFreeOnly: false
  });

  const opencode = viewModel.groups.find((group) => group.label === 'OpenCode');
  assert.ok(opencode, 'OpenCode group is present');
  // opencode signs itself in, so it counts as configured without a stored key.
  assert.equal(opencode.configured, true);
  assert.equal(modelNeedsApiKey(opencode.models[0]!, [credential('custom:openai', true)]), false);
});

test('the integration and a same-named endpoint stay separate, and the agent one says so', () => {
  const view = buildModelSelectorViewModel({
    models: [
      model('opencode/mimo', { providerId: 'opencode' }),
      // Someone pointed a plain base-URL provider at their OpenCode server and
      // named it the same thing. Same heading, nothing else in common.
      model('mimo', { providerId: 'custom:oc' })
    ],
    customProviders: [{ id: 'custom:oc', name: 'OpenCode' }],
    credentials: [credential('custom:oc', true)],
    showFreeOnly: false
  });

  assert.equal(view.groups.length, 2, 'grouped by provider, not by display name');
  const agent = view.groups.find((group) => group.providerId === 'opencode');
  const endpoint = view.groups.find((group) => group.providerId === 'custom:oc');
  assert.ok(agent && endpoint);
  assert.equal(agent.label, 'OpenCode');
  assert.equal(endpoint.label, 'OpenCode');
  assert.equal(agent.selfManaged, true);
  assert.equal(endpoint.selfManaged, false);
  // Neither is missing a key: one holds its own, the other has one saved.
  assert.equal(agent.configured, true);
  assert.equal(endpoint.configured, true);
});

test('the send gate exempts a provider that signs itself in', () => {
  // Exactly what the composer asks before starting a turn (`useAppStore`):
  // OpenCode holds its own credentials, so there is no Atlas key to save and
  // the turn must not be refused for the lack of one.
  const credentials = [credential('custom:one', true), credential('custom:two', false)];

  assert.equal(modelNeedsApiKey(model('opencode/mimo', { providerId: 'opencode' }), credentials), false);
  assert.equal(modelNeedsApiKey(model('m', { providerId: 'custom:two' }), credentials), true);
});

test('Antigravity models group under their own name, count as self-managed, and never ask for an API key', () => {
  const viewModel = buildModelSelectorViewModel({
    models: [
      model('gemini-3.8-flash-high', { providerId: 'antigravity', label: 'Gemini 3.8 Flash (High)' }),
      model('gpt-5', { providerId: 'custom:openai' })
    ],
    customProviders: [{ id: 'custom:openai', name: 'OpenAI' }],
    credentials: [credential('custom:openai', true)],
    showFreeOnly: false
  });

  const antigravity = viewModel.groups.find((group) => group.providerId === 'antigravity');
  assert.ok(antigravity, 'Antigravity group is present');
  assert.equal(antigravity.configured, true);
  assert.equal(antigravity.selfManaged, true);
  assert.equal(modelNeedsApiKey(antigravity.models[0]!, [credential('custom:openai', true)]), false);
});
