import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CustomProviderService } from '../src/main/ai/core/CustomProviderService.js';
import type { ProviderRegistry } from '../src/main/ai/core/providerRegistry.js';
import type { SqliteDatabase } from '../src/main/db/client.js';
import { CustomProvidersRepo } from '../src/main/db/repositories/customProvidersRepo.js';
import { ModelsRepo } from '../src/main/db/repositories/modelsRepo.js';
import { SettingsRepo } from '../src/main/db/repositories/settingsRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import type { ProviderId } from '../src/shared/contracts.js';
import { normalizeModelInputs } from '../src/shared/customProviders.js';

// Runtime-built test keys avoid static scanner false-positives.
const FAKE_SECRET_KEY = ['sk', 'secret'].join('-');
const FAKE_SHORT_KEY = ['sk', 'a'].join('-');
const FAKE_KEY_B = ['sk', 'b'].join('-');

function createHarness(t: { after: (fn: () => void) => void }) {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-custom-providers-'));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));
  const database = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction:
      <TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) =>
      (...args: TArgs) => {
        raw.exec('BEGIN');
        try {
          const result = callback(...args);
          raw.exec('COMMIT');
          return result;
        } catch (error) {
          raw.exec('ROLLBACK');
          throw error;
        }
      }
  } as unknown as SqliteDatabase;

  applySchema(database);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const secrets = new Map<ProviderId, string>();
  const keychain = {
    async getSecret(providerId: ProviderId) {
      return secrets.get(providerId) ?? null;
    },
    async setSecret(providerId: ProviderId, secret: string) {
      secrets.set(providerId, secret);
    },
    async deleteSecret(providerId: ProviderId) {
      secrets.delete(providerId);
    }
  };

  const repo = new CustomProvidersRepo(database);
  const modelsRepo = new ModelsRepo(database);
  const settingsRepo = new SettingsRepo(database);
  const registry: ProviderRegistry = new Map();

  const service = new CustomProviderService({
    repo,
    modelsRepo,
    settingsRepo,
    keychain: keychain as never,
    registry
  });

  return { repo, modelsRepo, settingsRepo, registry, secrets, service };
}

test('CustomProvidersRepo round-trips a provider with its model list', async (t) => {
  const { repo } = createHarness(t);

  const created = repo.create({
    id: 'custom:one',
    name: 'NVIDIA',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiFormat: 'chat-completions',
    models: normalizeModelInputs([
      { id: 'z-ai/glm-5.2', contextWindow: 16_384 },
      { id: 'qwen/qwen3.5', contextWindow: 16_384 }
    ])
  });

  assert.equal(created.name, 'NVIDIA');
  assert.equal(created.enabled, true);
  assert.deepEqual(
    created.models.map((model) => model.id),
    ['z-ai/glm-5.2', 'qwen/qwen3.5']
  );
  // Insertion order is the display order in the settings list.
  assert.equal(repo.getById('custom:one')?.models[0]?.id, 'z-ai/glm-5.2');
});

test('CustomProvidersRepo round-trips per-model reasoning effort levels', async (t) => {
  const { repo } = createHarness(t);

  repo.create({
    id: 'custom:one',
    name: 'Gateway',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat-completions',
    models: normalizeModelInputs([
      { id: 'deepseek-v4-flash', reasoningEfforts: ['off', 'high', 'max'] },
      { id: 'mimo-v2.5', reasoningEfforts: [] },
      { id: 'unknown-model' }
    ])
  });

  const models = repo.getById('custom:one')?.models ?? [];
  assert.deepEqual(models.find((m) => m.id === 'deepseek-v4-flash')?.reasoningEfforts, ['off', 'high', 'max']);
  // Empty means "always reasons, no control" and must survive as [] rather than null.
  assert.deepEqual(models.find((m) => m.id === 'mimo-v2.5')?.reasoningEfforts, []);
  // Absent means the catalog never said, stored as NULL.
  assert.equal(models.find((m) => m.id === 'unknown-model')?.reasoningEfforts, null);
});

test('backfillModelFacts fills levels for models saved before they were recorded', async (t) => {
  const { repo, modelsRepo, settingsRepo, registry, secrets } = createHarness(t);

  const facts = new Map([
    ['deepseek-v4-flash', { supportsReasoning: true, reasoningEfforts: ['off', 'high', 'max'] }],
    // The catalog says this one cannot reason at all.
    ['some-embedder', { supportsReasoning: false, reasoningEfforts: null }]
  ]);
  const service = new CustomProviderService({
    repo,
    modelsRepo,
    settingsRepo,
    keychain: { getSecret: async () => null, setSecret: async () => {}, deleteSecret: async () => {} } as never,
    registry,
    modelsDev: { lookup: async (modelId: string) => facts.get(modelId) ?? null } as never
  });

  repo.create({
    id: 'custom:one',
    name: 'Gateway',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat-completions',
    models: normalizeModelInputs([
      { id: 'deepseek-v4-flash' },
      { id: 'some-embedder' },
      { id: 'unknown-model' },
      // Already recorded: the backfill must not touch it.
      { id: 'pinned', reasoningEfforts: ['off', 'low'] }
    ])
  });

  await service.backfillModelFacts();

  const models = repo.getById('custom:one')?.models ?? [];
  assert.deepEqual(models.find((m) => m.id === 'deepseek-v4-flash')?.reasoningEfforts, ['off', 'high', 'max']);
  assert.equal(models.find((m) => m.id === 'some-embedder')?.supportsReasoning, false);
  // Not in the catalog: stays unknown so a later launch can try again.
  assert.equal(models.find((m) => m.id === 'unknown-model')?.reasoningEfforts, null);
  assert.deepEqual(models.find((m) => m.id === 'pinned')?.reasoningEfforts, ['off', 'low']);

  // Nothing left to fill: a second run must not rewrite the models.
  const before = repo.getById('custom:one');
  await service.backfillModelFacts();
  assert.deepEqual(repo.getById('custom:one'), before);
});

test('backfillModelFacts corrects stale context windows from the catalog', async (t) => {
  const { repo, modelsRepo, settingsRepo, registry } = createHarness(t);

  const facts = new Map([
    ['glm-5.2', { contextWindow: 1_000_000, maxOutputTokens: 131_072, supportsReasoning: true, reasoningEfforts: null }],
    // Known model, but the catalog records no limits: nothing to correct with.
    ['limitless', { contextWindow: null, maxOutputTokens: null, supportsReasoning: false, reasoningEfforts: null }]
  ]);
  const service = new CustomProviderService({
    repo,
    modelsRepo,
    settingsRepo,
    keychain: { getSecret: async () => null, setSecret: async () => {}, deleteSecret: async () => {} } as never,
    registry,
    modelsDev: { lookup: async (modelId: string) => facts.get(modelId) ?? null } as never
  });

  repo.create({
    id: 'custom:one',
    name: 'Gateway',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat-completions',
    models: normalizeModelInputs([
      // Saved with a window an order of magnitude too small — the whole reason
      // an empty conversation could report a third of the context consumed.
      { id: 'glm-5.2', contextWindow: 16_384 },
      { id: 'limitless', contextWindow: 4_096 },
      { id: 'unknown-model', contextWindow: 8_192 }
    ])
  });

  await service.backfillModelFacts();

  const models = repo.getById('custom:one')?.models ?? [];
  assert.equal(models.find((m) => m.id === 'glm-5.2')?.contextWindow, 1_000_000);
  assert.equal(models.find((m) => m.id === 'glm-5.2')?.maxOutputTokens, 131_072);
  // The catalog said nothing about these two, so the saved values stand.
  assert.equal(models.find((m) => m.id === 'limitless')?.contextWindow, 4_096);
  assert.equal(models.find((m) => m.id === 'unknown-model')?.contextWindow, 8_192);

  const before = repo.getById('custom:one');
  await service.backfillModelFacts();
  assert.deepEqual(repo.getById('custom:one'), before);
});

test('CustomProvidersRepo setModels replaces the list rather than merging', async (t) => {
  const { repo } = createHarness(t);

  repo.create({
    id: 'custom:one',
    name: 'Gateway',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat-completions',
    models: normalizeModelInputs([{ id: 'a' }, { id: 'b' }])
  });

  const updated = repo.setModels('custom:one', normalizeModelInputs([{ id: 'b' }, { id: 'c' }]));

  assert.deepEqual(
    updated.models.map((model) => model.id),
    ['b', 'c']
  );
});

test('CustomProvidersRepo delete removes the provider and its models', async (t) => {
  const { repo } = createHarness(t);

  repo.create({
    id: 'custom:one',
    name: 'Gateway',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat-completions',
    models: normalizeModelInputs([{ id: 'a' }])
  });

  repo.delete('custom:one');

  assert.equal(repo.getById('custom:one'), null);
  assert.deepEqual(repo.list(), []);
});

test('CustomProviderService normalizes input and stores the key out of band', async (t) => {
  const { service, secrets, registry } = createHarness(t);

  const provider = await service.create({
    name: '  My   Gateway ',
    // Pasting the completion path is the common mistake; it must be corrected.
    baseUrl: 'https://api.example.com/v1/chat/completions',
    apiFormat: 'chat-completions',
    apiKey: FAKE_SECRET_KEY,
    models: [{ id: 'model-a', contextWindow: 32_000 }]
  });

  assert.equal(provider.name, 'My Gateway');
  assert.equal(provider.baseUrl, 'https://api.example.com/v1');
  assert.equal(provider.hasApiKey, true);
  assert.equal(secrets.get(provider.id), FAKE_SECRET_KEY);
  assert.equal(registry.has(provider.id), true);
});

test('CustomProviderService rejects a duplicate provider name', async (t) => {
  const { service } = createHarness(t);

  await service.create({
    name: 'Gateway',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat-completions',
    apiKey: FAKE_SHORT_KEY
  });

  await assert.rejects(
    service.create({
      name: 'gateway',
      baseUrl: 'https://other.example.com/v1',
      apiFormat: 'chat-completions',
      apiKey: FAKE_KEY_B
    }),
    /already uses that name/
  );
});

test('CustomProviderService keeps a disabled provider out of the live registry', async (t) => {
  const { service, registry } = createHarness(t);

  const provider = await service.create({
    name: 'Gateway',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat-completions',
    apiKey: FAKE_SHORT_KEY
  });

  await service.update({ providerId: provider.id, enabled: false });
  assert.equal(registry.has(provider.id), false);

  await service.update({ providerId: provider.id, enabled: true });
  assert.equal(registry.has(provider.id), true);
});

test('CustomProviderService adapter serves the configured models as the catalog', async (t) => {
  const { service, registry } = createHarness(t);

  const provider = await service.create({
    name: 'Gateway',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat-completions',
    apiKey: FAKE_SHORT_KEY,
    models: [{ id: 'model-a', contextWindow: 32_000, maxOutputTokens: 8_000 }]
  });

  const adapter = registry.get(provider.id);
  assert.ok(adapter);

  const models = await adapter.listModels(null);
  assert.equal(models.length, 1);
  assert.equal(models[0]?.id, 'model-a');
  assert.equal(models[0]?.providerId, provider.id);
  assert.equal(models[0]?.contextWindow, 32_000);
  assert.equal(models[0]?.maxOutputTokens, 8_000);
  // BYO-billing endpoints have no free tier to advertise.
  assert.equal(models[0]?.isFree, false);
});

test('CustomProviderService delete clears the secret, catalog and registry entry', async (t) => {
  const { service, registry, secrets, modelsRepo, settingsRepo } = createHarness(t);

  const provider = await service.create({
    name: 'Gateway',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat-completions',
    apiKey: FAKE_SHORT_KEY,
    models: [{ id: 'model-a' }]
  });

  const adapter = registry.get(provider.id);
  modelsRepo.upsertModels(await adapter!.listModels(null));
  assert.equal(modelsRepo.list().length, 1);

  await service.delete(provider.id);

  assert.equal(registry.has(provider.id), false);
  assert.equal(secrets.has(provider.id), false);
  assert.deepEqual(modelsRepo.list(), []);
  assert.equal(settingsRepo.getCredential(provider.id).hasSecret, false);
  assert.deepEqual(await service.list(), []);
});

test('CustomProviderService syncRegistry rebuilds adapters saved in a previous session', async (t) => {
  const { service, registry, repo, secrets } = createHarness(t);

  repo.create({
    id: 'custom:persisted',
    name: 'Persisted',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'anthropic-messages',
    models: normalizeModelInputs([{ id: 'claude-x' }])
  });
  secrets.set('custom:persisted', FAKE_SHORT_KEY);

  assert.equal(registry.has('custom:persisted'), false);

  await service.syncRegistry();

  assert.equal(registry.has('custom:persisted'), true);
});

test('CustomProviderService probes unsaved form values so a provider can be tested first', async (t) => {
  const { service } = createHarness(t);

  // No providerId and no key: the form has not supplied enough to probe.
  await assert.rejects(
    service.discoverModels({ baseUrl: 'https://api.example.com/v1', apiFormat: 'chat-completions' }),
    /Enter an API key/
  );

  await assert.rejects(
    service.discoverModels({ apiFormat: 'chat-completions', apiKey: FAKE_SHORT_KEY }),
    /Enter the API base URL/
  );
});

test('ModelRegistry refreshes user-configured providers alongside the built-ins', async (t) => {
  const { service, registry, modelsRepo, settingsRepo, repo } = createHarness(t);

  registry.set('openrouter', {
    providerId: 'openrouter',
    capabilities: { requiresApiKeyForCatalog: true },
    async validateCredential() {},
    async listModels() {
      throw new Error('should be skipped without a key');
    },
    async streamChat() {
      throw new Error('not implemented');
    }
  });

  const provider = await service.create({
    name: 'Gateway',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat-completions',
    apiKey: FAKE_SHORT_KEY,
    models: [{ id: 'model-a', contextWindow: 32_000 }]
  });

  const { ModelRegistry } = await import('../src/main/ai/core/ModelRegistry.js');
  const keychain = { async getSecret(id: ProviderId) { return id === provider.id ? FAKE_SHORT_KEY : null; } };
  const modelRegistry = new ModelRegistry(modelsRepo, settingsRepo, keychain as never, registry, repo);

  const models = await modelRegistry.refresh();

  assert.deepEqual(models?.map((model) => model.id), ['model-a']);

  const summary = modelRegistry.getSettingsSummary();
  assert.equal(summary.customProviders.length, 1);
  assert.equal(summary.customProviders[0]?.name, 'Gateway');
  assert.equal(summary.customProviders[0]?.hasApiKey, true);
  // The credential list must carry the custom provider so the UI can show it.
  assert.ok(summary.providers.some((entry) => entry.providerId === provider.id));
});

test('a gateway free-tier suffix marks the model free without any extra input', async (t) => {
  const { service, registry, modelsRepo } = createHarness(t);

  const provider = await service.create({
    name: 'Gateway',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat-completions',
    apiKey: FAKE_SHORT_KEY,
    // The `:free` suffix is the only price signal an OpenAI-compatible model
    // list carries, so it has to be read from the id.
    models: [{ id: 'vendor/model:free' }, { id: 'vendor/model' }]
  });

  modelsRepo.upsertModels(await registry.get(provider.id)!.listModels(null));

  assert.deepEqual(
    modelsRepo.list({ freeOnly: true }).map((model) => model.id),
    ['vendor/model:free']
  );
  assert.equal(modelsRepo.list().length, 2);
});

test('a saved custom model starts with unknown capabilities, not claimed ones', async (t) => {
  const { service } = createHarness(t);

  const provider = await service.create({
    name: 'Gateway',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat-completions',
    models: [{ id: 'vendor/model' }]
  });

  const model = provider.models[0]!;
  // Claiming support the endpoint never described is what produced 400s at
  // send time; claiming the opposite blocked models that can in fact see.
  assert.equal(model.supportsVision, null);
  assert.equal(model.supportsDocumentInput, null);
  // Tool support is the same argument: a refusal is recoverable and now
  // recorded, so claiming it up front buys nothing.
  assert.equal(model.supportsTools, null);
  // Everything else still defaults optimistically.
  assert.equal(model.supportsReasoning, true);
});

test('a capability rejection is recorded against the model that was refused', async (t) => {
  const { service, registry, modelsRepo } = createHarness(t);

  const provider = await service.create({
    name: 'Gateway',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat-completions',
    models: [{ id: 'text-only' }, { id: 'other-model' }]
  });

  modelsRepo.upsertModels(await registry.get(provider.id)!.listModels(null));
  assert.equal(modelsRepo.getById('text-only')?.supportsVision, null);

  assert.equal(await service.recordCapabilityRejection('text-only', 'image'), true);

  const saved = (await service.list())[0]!.models;
  assert.equal(saved.find((model) => model.id === 'text-only')?.supportsVision, false);
  // Only the refused model and only the refused modality.
  assert.equal(saved.find((model) => model.id === 'text-only')?.supportsDocumentInput, null);
  assert.equal(saved.find((model) => model.id === 'other-model')?.supportsVision, null);

  // Tool refusals ride the same path and land on their own field.
  assert.equal(await service.recordCapabilityRejection('other-model', 'tools'), true);
  const afterTools = (await service.list())[0]!.models;
  assert.equal(afterTools.find((model) => model.id === 'other-model')?.supportsTools, false);
  assert.equal(afterTools.find((model) => model.id === 'text-only')?.supportsTools, null);

  // A repeat rejection is not another write.
  assert.equal(await service.recordCapabilityRejection('text-only', 'image'), false);
  // A model no provider serves cannot be recorded against.
  assert.equal(await service.recordCapabilityRejection('unknown-model', 'image'), false);
});
