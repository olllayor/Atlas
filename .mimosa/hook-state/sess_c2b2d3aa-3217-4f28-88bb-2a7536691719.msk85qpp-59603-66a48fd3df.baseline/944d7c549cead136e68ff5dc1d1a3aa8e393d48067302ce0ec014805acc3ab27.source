import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { migrateLegacyBuiltInProviders } from '../src/main/ai/core/legacyProviderMigration.js';
import type { SqliteDatabase } from '../src/main/db/client.js';
import { CustomProvidersRepo } from '../src/main/db/repositories/customProvidersRepo.js';
import { ModelsRepo } from '../src/main/db/repositories/modelsRepo.js';
import { SettingsRepo } from '../src/main/db/repositories/settingsRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import type { ModelSummary, ProviderId } from '../src/shared/contracts.js';

function createHarness(t: { after: (fn: () => void) => void }) {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-legacy-migration-'));
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
  const remaps: Array<[ProviderId, ProviderId]> = [];

  const deps = {
    customProvidersRepo: new CustomProvidersRepo(database),
    modelsRepo: new ModelsRepo(database),
    settingsRepo: new SettingsRepo(database),
    keychain: {
      async getSecret(id: ProviderId) {
        return secrets.get(id) ?? null;
      },
      async setSecret(id: ProviderId, secret: string) {
        secrets.set(id, secret);
      },
      async deleteSecret(id: ProviderId) {
        secrets.delete(id);
      }
    },
    remapConversationProvider: (from: ProviderId, to: ProviderId) => {
      remaps.push([from, to]);
    }
  };

  return { deps, secrets, remaps };
}

function legacyModel(id: string, providerId: ProviderId): ModelSummary {
  return {
    id,
    providerId,
    label: id,
    contextWindow: 128_000,
    isFree: id.endsWith(':free'),
    supportsVision: false,
    supportsDocumentInput: false,
    supportsTools: true,
    archived: false,
    lastSyncedAt: new Date().toISOString(),
    lastSeenFreeAt: null
  };
}

test('a saved OpenRouter key becomes a user-configured provider', async (t) => {
  const { deps, secrets, remaps } = createHarness(t);
  secrets.set('openrouter', 'sk-or-legacy');
  deps.modelsRepo.upsertModels([legacyModel('vendor/model:free', 'openrouter')]);

  const result = await migrateLegacyBuiltInProviders(deps);

  const providers = deps.customProvidersRepo.list();
  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.name, 'OpenRouter');
  assert.equal(providers[0]?.baseUrl, 'https://openrouter.ai/api/v1');
  assert.deepEqual(
    providers[0]?.models.map((model) => model.id),
    ['vendor/model:free']
  );

  // The key moved to the new id, and the old keychain entry is gone.
  const newId = providers[0]!.id;
  assert.equal(secrets.get(newId), 'sk-or-legacy');
  assert.equal(secrets.has('openrouter'), false);

  // Old conversations must still resolve a live provider.
  assert.deepEqual(remaps, [['openrouter', newId]]);
  assert.equal(result.remapped.get('openrouter'), newId);
  assert.deepEqual(result.migratedProviderNames, ['OpenRouter']);
});

test('the legacy provider stops occupying the shared model cache and credentials', async (t) => {
  const { deps } = createHarness(t);
  deps.modelsRepo.upsertModels([legacyModel('glm-4.7', 'glm')]);
  deps.settingsRepo.syncSecretPresence('glm', true);

  await migrateLegacyBuiltInProviders(deps);

  // The catalog is rebuilt from the new provider, so the old rows must go.
  assert.deepEqual(deps.modelsRepo.list({ includeArchived: true }), []);
  assert.equal(deps.settingsRepo.getCredential('glm').hasSecret, false);
});

test('a provider that was never configured is not resurrected', async (t) => {
  const { deps, remaps } = createHarness(t);

  const result = await migrateLegacyBuiltInProviders(deps);

  assert.deepEqual(deps.customProvidersRepo.list(), []);
  assert.deepEqual(remaps, []);
  assert.deepEqual(result.migratedProviderNames, []);
});

test('running the migration twice does not duplicate the provider', async (t) => {
  const { deps, secrets } = createHarness(t);
  secrets.set('glm', 'sk-glm');

  await migrateLegacyBuiltInProviders(deps);
  const afterFirst = deps.customProvidersRepo.list();

  const second = await migrateLegacyBuiltInProviders(deps);

  assert.equal(deps.customProvidersRepo.list().length, afterFirst.length);
  // Nothing was migrated the second time, but the mapping is still reported so
  // a caller can rewrite anything it missed.
  assert.deepEqual(second.migratedProviderNames, []);
});

test('a huge legacy catalog is truncated rather than imported wholesale', async (t) => {
  const { deps, secrets } = createHarness(t);
  secrets.set('openrouter', 'sk-or');
  deps.modelsRepo.upsertModels(
    Array.from({ length: 120 }, (_, index) => legacyModel(`vendor/model-${index}`, 'openrouter'))
  );

  await migrateLegacyBuiltInProviders(deps);

  // A hand-managed list of thousands of entries would be unusable.
  assert.equal(deps.customProvidersRepo.list()[0]?.models.length, 50);
});
