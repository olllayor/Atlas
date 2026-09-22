import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildModelSelectorViewModel,
  modelNeedsApiKey,
  modelShortName
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
    view.rows.map((row) => row.model.id).sort(),
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

test('strip has one entry per provider with correct counts and order', () => {
  const view = buildModelSelectorViewModel({
    models: [
      model('a', { providerId: 'custom:zeta' }),
      model('b', { providerId: 'custom:zeta' }),
      model('c', { providerId: 'custom:alpha' })
    ],
    customProviders: [
      { id: 'custom:zeta', name: 'Zeta' },
      { id: 'custom:alpha', name: 'Alpha' }
    ],
    credentials: [credential('custom:zeta', true), credential('custom:alpha', false)],
    showFreeOnly: false
  });

  assert.deepEqual(
    view.strip.map((item) => [item.label, item.modelCount, item.configured]),
    [
      ['Zeta', 2, true],
      ['Alpha', 1, false]
    ]
  );
});

test('models strip under their configured provider name', () => {
  const view = buildModelSelectorViewModel({
    models: [model('a', { providerId: 'custom:one' }), model('b', { providerId: 'custom:two' })],
    customProviders: [
      { id: 'custom:one', name: 'NVIDIA' },
      { id: 'custom:two', name: 'Together' }
    ],
    showFreeOnly: false
  });

  assert.deepEqual(view.strip.map((item) => item.label).sort(), ['NVIDIA', 'Together']);
});

test('a model whose provider was deleted still groups under a readable label', () => {
  const view = buildModelSelectorViewModel({
    models: [model('orphan', { providerId: 'custom:gone' })],
    customProviders: [],
    showFreeOnly: false
  });

  assert.equal(view.strip[0]?.label, 'Removed provider');
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
    view.strip.map((item) => [item.label, item.configured]),
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

  assert.equal(view.strip[0]?.configured, true);
  assert.equal(modelNeedsApiKey(model('a')), false);
});

test('modelNeedsApiKey flags only providers that are known to lack a key', () => {
  const credentials = [credential('custom:one', false), credential('custom:two', true)];

  assert.equal(modelNeedsApiKey(model('a', { providerId: 'custom:one' }), credentials), true);
  assert.equal(modelNeedsApiKey(model('b', { providerId: 'custom:two' }), credentials), false);
  // A provider missing from the credential list has no key saved either.
  assert.equal(modelNeedsApiKey(model('c', { providerId: 'custom:abc' }), credentials), true);
});

test('an empty catalog yields no strip entries and no rows', () => {
  const view = buildModelSelectorViewModel({ models: [], showFreeOnly: true });

  assert.deepEqual(view.strip, []);
  assert.deepEqual(view.rows, []);
  assert.equal(view.totalCount, 0);
  assert.equal(view.hasFreeModels, false);
});

test('providerFilter narrows rows to one provider but strip stays full', () => {
  const view = buildModelSelectorViewModel({
    models: [
      model('z-one', { providerId: 'custom:zeta', label: 'Z One' }),
      model('a-one', { providerId: 'custom:alpha', label: 'A One' }),
      model('a-two', { providerId: 'custom:alpha', label: 'A Two' })
    ],
    customProviders: [
      { id: 'custom:zeta', name: 'Zeta' },
      { id: 'custom:alpha', name: 'Alpha' }
    ],
    credentials: [credential('custom:zeta', true), credential('custom:alpha', true)],
    showFreeOnly: false,
    providerFilter: 'custom:alpha'
  });

  assert.equal(view.strip.length, 2, 'strip keeps every provider');
  assert.deepEqual(view.rows.map((row) => row.model.id), ['a-one', 'a-two']);
});

test('searchQuery matches provider display name, not only model name and id', () => {
  const view = buildModelSelectorViewModel({
    models: [
      // Ids and labels never mention the vendor; only the provider name does.
      model('nv-llama-3-70b', { providerId: 'custom:nv', label: 'Llama 3 70B' }),
      model('gpt-5', { providerId: 'custom:oa', label: 'GPT-5' })
    ],
    customProviders: [
      { id: 'custom:nv', name: 'NVIDIA' },
      { id: 'custom:oa', name: 'OpenAI' }
    ],
    showFreeOnly: false,
    searchQuery: 'nvidia'
  });

  assert.deepEqual(view.rows.map((row) => row.model.id), ['nv-llama-3-70b']);

  const byVendor = buildModelSelectorViewModel({
    models: [
      model('nv-llama-3-70b', { providerId: 'custom:nv', label: 'Llama 3 70B' }),
      model('gpt-5', { providerId: 'custom:oa', label: 'GPT-5' })
    ],
    customProviders: [
      { id: 'custom:nv', name: 'NVIDIA' },
      { id: 'custom:oa', name: 'OpenAI' }
    ],
    showFreeOnly: false,
    searchQuery: 'openai'
  });
  assert.deepEqual(byVendor.rows.map((row) => row.model.id), ['gpt-5']);
});

test('searchQuery filters by name and id, case-insensitively', () => {
  const models = [
    model('openai/gpt-5', { providerId: 'custom:a', label: 'GPT-5' }),
    model('anthropic/claude-sonnet-4-5', { providerId: 'custom:b', label: 'Claude Sonnet 4.5' }),
    model('google/gemini-3-pro', { providerId: 'custom:c', label: 'Gemini 3 Pro' })
  ];
  const customProviders = [
    { id: 'custom:a', name: 'A' },
    { id: 'custom:b', name: 'B' },
    { id: 'custom:c', name: 'C' }
  ];

  const byName = buildModelSelectorViewModel({
    models,
    customProviders,
    showFreeOnly: false,
    searchQuery: 'sonn'
  });
  assert.deepEqual(byName.rows.map((row) => row.model.id), ['anthropic/claude-sonnet-4-5']);

  const byId = buildModelSelectorViewModel({
    models,
    customProviders,
    showFreeOnly: false,
    searchQuery: 'GEMINI'
  });
  assert.deepEqual(byId.rows.map((row) => row.model.id), ['google/gemini-3-pro']);
});

test('ambiguous is true only when two visible rows share a short name', () => {
  const view = buildModelSelectorViewModel({
    models: [
      model('openai/gpt-4o', { providerId: 'custom:a', label: 'GPT-4o' }),
      model('azure/gpt-4o', { providerId: 'custom:b', label: 'GPT-4o' }),
      model('openai/o3', { providerId: 'custom:a', label: 'o3' })
    ],
    customProviders: [
      { id: 'custom:a', name: 'A' },
      { id: 'custom:b', name: 'B' }
    ],
    showFreeOnly: false
  });

  const gptRows = view.rows.filter((row) => row.name === 'GPT-4o');
  assert.equal(gptRows.length, 2);
  assert.ok(gptRows.every((row) => row.ambiguous));
  assert.equal(view.rows.find((row) => row.name === 'o3')?.ambiguous, false);
});

test('short name prefers the catalog label and strips gateway pricing suffixes', () => {
  assert.equal(modelShortName({ id: 'vendor/DeepSeek-V4-Flash-01:free', label: 'DeepSeek V4 Flash' }), 'DeepSeek V4 Flash');
  assert.equal(modelShortName({ id: 'vendor/DeepSeek-V4-Flash-01:free', label: 'vendor/DeepSeek-V4-Flash-01:free' }), 'DeepSeek-V4-Flash-01');
  assert.equal(modelShortName({ id: 'gpt-5@latest', label: 'gpt-5@latest' }), 'gpt-5');
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

test('OpenCode models strip under their own name and never ask for an API key', () => {
  const viewModel = buildModelSelectorViewModel({
    models: [
      model('opencode/claude-opus-4-7', { providerId: 'opencode', label: 'Claude Opus 4.7' }),
      model('gpt-5', { providerId: 'custom:openai' })
    ],
    customProviders: [{ id: 'custom:openai', name: 'OpenAI' }],
    credentials: [credential('custom:openai', true)],
    showFreeOnly: false
  });

  const opencode = viewModel.strip.find((item) => item.label === 'OpenCode');
  assert.ok(opencode, 'OpenCode strip entry is present');
  // opencode signs itself in, so it counts as configured without a stored key.
  assert.equal(opencode.configured, true);
  const opencodeRow = viewModel.rows.find((row) => row.providerId === 'opencode');
  assert.ok(opencodeRow);
  assert.equal(modelNeedsApiKey(opencodeRow.model, [credential('custom:openai', true)]), false);
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

  assert.equal(view.strip.length, 2, 'grouped by provider, not by display name');
  const agent = view.strip.find((item) => item.providerId === 'opencode');
  const endpoint = view.strip.find((item) => item.providerId === 'custom:oc');
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

test('Antigravity models strip under their own name, count as self-managed, and never ask for an API key', () => {
  const viewModel = buildModelSelectorViewModel({
    models: [
      model('gemini-3.8-flash-high', { providerId: 'antigravity', label: 'Gemini 3.8 Flash (High)' }),
      model('gpt-5', { providerId: 'custom:openai' })
    ],
    customProviders: [{ id: 'custom:openai', name: 'OpenAI' }],
    credentials: [credential('custom:openai', true)],
    showFreeOnly: false
  });

  const antigravity = viewModel.strip.find((item) => item.providerId === 'antigravity');
  assert.ok(antigravity, 'Antigravity strip entry is present');
  assert.equal(antigravity.configured, true);
  assert.equal(antigravity.selfManaged, true);
  const antigravityRow = viewModel.rows.find((row) => row.providerId === 'antigravity');
  assert.ok(antigravityRow);
  assert.equal(modelNeedsApiKey(antigravityRow.model, [credential('custom:openai', true)]), false);
});
