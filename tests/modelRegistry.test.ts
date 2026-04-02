import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ModelRegistry } from '../src/main/ai/core/ModelRegistry.js';
import type { ProviderRegistry } from '../src/main/ai/core/providerRegistry.js';
import { ModelsRepo } from '../src/main/db/repositories/modelsRepo.js';
import { SettingsRepo } from '../src/main/db/repositories/settingsRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import type { SqliteDatabase } from '../src/main/db/client.js';
import type { ModelSummary, ProviderId } from '../src/shared/contracts.js';

function createDatabase() {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-model-registry-'));
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
      },
  } as unknown as SqliteDatabase;

  applySchema(database);

  return {
    tempDir,
    raw,
    modelsRepo: new ModelsRepo(database),
    settingsRepo: new SettingsRepo(database)
  };
}

function createKeychain(secrets: Partial<Record<ProviderId, string>>) {
  return {
    async getSecret(providerId: ProviderId) {
      return secrets[providerId] ?? null;
    },
    async setSecret(providerId: ProviderId, secret: string) {
      secrets[providerId] = secret;
    }
  };
}

function createModel(id: string, providerId: ProviderId): ModelSummary {
  return {
    id,
    providerId,
    label: id,
    contextWindow: 8192,
    isFree: false,
    supportsVision: false,
    supportsTools: false,
    archived: false,
    lastSyncedAt: new Date().toISOString(),
    lastSeenFreeAt: null
  };
}

test('ModelRegistry refresh merges provider catalogs and prefers configured provider in settings summary', async (t) => {
  const { tempDir, raw, modelsRepo, settingsRepo } = createDatabase();
  const keychain = createKeychain({ openrouter: 'or-key' });

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const providers: ProviderRegistry = new Map([
    [
      'openrouter',
      {
        providerId: 'openrouter',
        async validateCredential() {},
        async listModels() {
          return [createModel('openrouter/test-model', 'openrouter')];
        },
        async streamChat() {
          throw new Error('not implemented');
        }
      }
    ],
    [
      'glm',
      {
        providerId: 'glm',
        async validateCredential() {},
        async listModels() {
          return [createModel('glm-5', 'glm')];
        },
        async streamChat() {
          throw new Error('not implemented');
        }
      }
    ]
  ]);

  const registry = new ModelRegistry(modelsRepo, settingsRepo, keychain as never, providers);
  const models = await registry.refresh();

  assert.deepEqual(
    models.map((model) => model.id),
    ['glm-5', 'openrouter/test-model']
  );

  const summary = registry.getSettingsSummary();
  assert.equal(summary.defaultProviderId, 'openrouter');
  assert.equal(summary.providers.find((provider) => provider.providerId === 'openrouter')?.status, 'valid');
  assert.equal(summary.appearance.themeMode, 'dark');
  assert.equal(summary.appearance.uiFontSize, 15);
  assert.equal(summary.appearance.codeFontSize, 13);
  assert.equal(summary.appearance.uiFontFamily, null);
  assert.equal(summary.appearance.codeFontFamily, null);
});

test('ModelRegistry validateProviderKey updates provider credential status', async (t) => {
  const { tempDir, raw, modelsRepo, settingsRepo } = createDatabase();
  const keychain = createKeychain({ glm: 'glm-key' });
  let validated = false;

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const providers: ProviderRegistry = new Map([
    [
      'glm',
      {
        providerId: 'glm',
        async validateCredential(apiKey: string) {
          validated = apiKey === 'glm-key';
        },
        async listModels() {
          return [createModel('glm-5', 'glm')];
        },
        async streamChat() {
          throw new Error('not implemented');
        }
      }
    ]
  ]);

  const registry = new ModelRegistry(modelsRepo, settingsRepo, keychain as never, providers);
  await registry.validateProviderKey('glm');

  assert.equal(validated, true);
  assert.equal(settingsRepo.getCredential('glm').status, 'valid');
});

test('ModelRegistry refresh returns available catalogs when another provider refresh fails', async (t) => {
  const { tempDir, raw, modelsRepo, settingsRepo } = createDatabase();
  const keychain = createKeychain({ openrouter: 'or-key' });

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const providers: ProviderRegistry = new Map([
    [
      'openrouter',
      {
        providerId: 'openrouter',
        async validateCredential() {},
        async listModels() {
          throw new Error('fetch failed');
        },
        async streamChat() {
          throw new Error('not implemented');
        }
      }
    ],
    [
      'glm',
      {
        providerId: 'glm',
        async validateCredential() {},
        async listModels() {
          return [createModel('glm-4.5-flash', 'glm')];
        },
        async streamChat() {
          throw new Error('not implemented');
        }
      }
    ]
  ]);

  const registry = new ModelRegistry(modelsRepo, settingsRepo, keychain as never, providers);
  const models = await registry.refresh();

  assert.deepEqual(
    models.map((model) => model.id),
    ['glm-4.5-flash']
  );
});
