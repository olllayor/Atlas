import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProviderListPayload } from '../src/main/ai/providers/opencode/OpenCodeClient.js';
import {
  flattenOpenCodeModels,
  formatOpenCodeModelSlug,
  parseOpenCodeModelSlug
} from '../src/main/ai/providers/opencode/inventory.js';

const SYNCED_AT = '2026-01-01T00:00:00.000Z';

/** Trimmed copy of a real `GET /provider` body (opencode 1.18.23). */
const PAYLOAD = {
  all: [
    {
      id: 'opencode',
      name: 'OpenCode Zen',
      source: 'api',
      models: {
        'claude-opus-4-7': {
          id: 'claude-opus-4-7',
          providerID: 'opencode',
          name: 'Claude Opus 4.7',
          status: 'active',
          limit: { context: 1_000_000, output: 128_000 },
          cost: { input: 5, output: 25, cache: { read: 0.5, write: 6.25 } },
          capabilities: {
            temperature: false,
            reasoning: true,
            toolcall: true,
            input: { text: true, image: true, pdf: true, audio: false, video: false }
          }
        },
        'retired-model': {
          id: 'retired-model',
          name: 'Retired',
          status: 'deprecated',
          limit: { context: 8_000, output: 1_000 },
          cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
          capabilities: { temperature: true, reasoning: false, toolcall: true, input: {} }
        }
      }
    },
    {
      id: 'local',
      name: 'Local',
      models: {
        'tiny-free': {
          id: 'tiny-free',
          name: 'Tiny',
          limit: { context: 4_096, output: 512 },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          capabilities: { temperature: true, reasoning: false, toolcall: false, input: { image: false } }
        }
      }
    }
  ],
  default: { opencode: 'big-pickle' },
  connected: ['opencode']
};

test('normalizes the real provider payload shape (all/default/connected)', () => {
  const inventory = normalizeProviderListPayload(PAYLOAD);

  assert.deepEqual(
    inventory.providers.map((provider) => provider.id),
    ['opencode', 'local']
  );
  assert.deepEqual(inventory.connected, ['opencode']);
  assert.deepEqual(inventory.defaults, { opencode: 'big-pickle' });
  // Counts every model opencode knows, connected or not.
  assert.equal(inventory.modelCount, 3);

  const opus = inventory.providers[0]!.models.find((model) => model.id === 'claude-opus-4-7')!;
  assert.equal(opus.contextWindow, 1_000_000);
  assert.equal(opus.maxOutputTokens, 128_000);
  assert.deepEqual(opus.costPerMillion, { input: 5, output: 25 });
  assert.equal(opus.capabilities.temperature, false);
  assert.equal(opus.capabilities.pdf, true);
});

test('normalizing survives a junk payload instead of throwing', () => {
  const inventory = normalizeProviderListPayload({ all: [{ nope: true }, null], connected: 'no' });
  assert.deepEqual(inventory.providers, []);
  assert.deepEqual(inventory.connected, []);
  assert.equal(inventory.modelCount, 0);
});

test('unreported capabilities stay unknown rather than false', () => {
  const inventory = normalizeProviderListPayload({
    all: [{ id: 'p', name: 'P', models: { m: { id: 'm', name: 'M' } } }],
    connected: ['p']
  });
  const model = inventory.providers[0]!.models[0]!;
  assert.equal(model.contextWindow, null);
  assert.equal(model.costPerMillion, null);
  assert.deepEqual(model.capabilities, {
    temperature: null,
    reasoning: null,
    toolcall: null,
    image: null,
    pdf: null
  });
});

test('flatten lists only connected providers, skipping deprecated models', () => {
  const models = flattenOpenCodeModels({
    inventory: normalizeProviderListPayload(PAYLOAD),
    syncedAt: SYNCED_AT
  });

  assert.deepEqual(
    models.map((model) => model.id),
    ['opencode/claude-opus-4-7']
  );

  const [opus] = models;
  assert.equal(opus!.providerId, 'opencode');
  assert.equal(opus!.label, 'Claude Opus 4.7');
  assert.equal(opus!.contextWindow, 1_000_000);
  assert.equal(opus!.maxOutputTokens, 128_000);
  assert.equal(opus!.supportsVision, true);
  assert.equal(opus!.supportsDocumentInput, true);
  assert.equal(opus!.supportsTools, true);
  // Atlas cannot pass sampling parameters to opencode, so no model claims it.
  assert.equal(opus!.supportsTemperature, false);
  assert.equal(opus!.supportsReasoning, true);
  assert.equal(opus!.isFree, false);
  assert.equal(opus!.lastSyncedAt, SYNCED_AT);
});

test('flatten can include unconnected providers and reads free pricing', () => {
  const models = flattenOpenCodeModels({
    inventory: normalizeProviderListPayload(PAYLOAD),
    includeUnconnected: true,
    syncedAt: SYNCED_AT
  });

  const tiny = models.find((model) => model.id === 'local/tiny-free');
  assert.ok(tiny);
  assert.equal(tiny.isFree, true);
  assert.equal(tiny.supportsTools, false);
  // opencode advertises temperature support for this one; Atlas still cannot
  // send a value, so the catalog must not promise the control works.
  assert.equal(tiny.supportsTemperature, false);
});

test('a provider whose models arrive as an array normalizes the same way', () => {
  // The live server sends a Record keyed by model id; the SDK's own types
  // describe an array. Both shapes have to land on the same rows.
  const inventory = normalizeProviderListPayload({
    all: [
      {
        id: 'p',
        name: 'P',
        models: [{ id: 'm', name: 'M', limit: { context: 100, output: 10 } }]
      }
    ],
    connected: ['p']
  });

  assert.equal(inventory.modelCount, 1);
  const model = inventory.providers[0]!.models[0]!;
  assert.equal(model.id, 'm');
  assert.equal(model.name, 'M');
  assert.equal(model.contextWindow, 100);
  assert.equal(model.maxOutputTokens, 10);
});

test('labels disambiguate only when two providers ship the same model name', () => {
  const inventory = normalizeProviderListPayload({
    all: [
      { id: 'a', name: 'Alpha', models: { x: { id: 'x', name: 'Shared' } } },
      { id: 'b', name: 'Beta', models: { y: { id: 'y', name: 'Shared' }, z: { id: 'z', name: 'Solo' } } }
    ],
    connected: ['a', 'b']
  });

  const labels = new Map(
    flattenOpenCodeModels({ inventory, syncedAt: SYNCED_AT }).map((model) => [model.id, model.label])
  );
  assert.equal(labels.get('a/x'), 'Shared (Alpha)');
  assert.equal(labels.get('b/y'), 'Shared (Beta)');
  assert.equal(labels.get('b/z'), 'Solo');
});

test('custom slugs are appended, deduped against the live catalog, and validated', () => {
  const models = flattenOpenCodeModels({
    inventory: normalizeProviderListPayload(PAYLOAD),
    customModels: [
      'opencode/claude-opus-4-7', // already live — must not overwrite metadata
      'openrouter/anthropic/claude-3',
      'bogus',
      '/leading',
      'trailing/',
      'has space/model'
    ],
    syncedAt: SYNCED_AT
  });

  assert.deepEqual(
    models.map((model) => model.id),
    ['opencode/claude-opus-4-7', 'openrouter/anthropic/claude-3']
  );
  assert.equal(models[0]!.contextWindow, 1_000_000);

  const custom = models[1]!;
  assert.equal(custom.label, 'anthropic/claude-3');
  assert.equal(custom.contextWindow, null);
  assert.equal(custom.supportsTools, null);
});

test('slug parsing splits on the first separator only', () => {
  assert.deepEqual(parseOpenCodeModelSlug('anthropic/claude-4.5'), {
    providerID: 'anthropic',
    modelID: 'claude-4.5'
  });
  assert.deepEqual(parseOpenCodeModelSlug(' openrouter/x/y '), {
    providerID: 'openrouter',
    modelID: 'x/y'
  });
  assert.equal(parseOpenCodeModelSlug('nope'), null);
  assert.equal(parseOpenCodeModelSlug('/nope'), null);
  assert.equal(parseOpenCodeModelSlug('nope/'), null);
  assert.equal(parseOpenCodeModelSlug('two words/model'), null);
  assert.equal(formatOpenCodeModelSlug({ providerID: 'a', modelID: 'b/c' }), 'a/b/c');
});
