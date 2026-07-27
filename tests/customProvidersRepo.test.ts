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
    apiKey: 'sk-secret',
    models: [{ id: 'model-a', contextWindow: 32_000 }]
  });

  assert.equal(provider.name, 'My Gateway');
  assert.equal(provider.baseUrl, 'https://api.example.com/v1');
  assert.equal(provider.hasApiKey, true);
  assert.equal(secrets.get(provider.id), 'sk-secret');
  assert.equal(registry.has(provider.id), true);
});

test('CustomProviderService rejects a duplicate provider name', async (t) => {
  const { service } = createHarness(t);

  await service.create({
    name: 'Gateway',
    baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat-completions',
    apiKey: 'sk-a'
  });

  await assert.rejects(
    service.create({
      name: 'gateway',
      baseUrl: 'https://other.example.com/v1',
      apiFormat: 'chat-completions',
      apiKey: 'sk-b'
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
    apiKey: 'sk-a'
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
    apiKey: 'sk-a',
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
    apiKey: 'sk-a',
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
  secrets.set('custom:persisted', 'sk-a');

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
    service.discoverModels({ apiFormat: 'chat-completions', apiKey: 'sk-a' }),
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
    apiKey: 'sk-a',
    models: [{ id: 'model-a', contextWindow: 32_000 }]
  });

  const { ModelRegistry } = await import('../src/main/ai/core/ModelRegistry.js');
  const keychain = { async getSecret(id: ProviderId) { return id === provider.id ? 'sk-a' : null; } };
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
    apiKey: 'sk-a',
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
