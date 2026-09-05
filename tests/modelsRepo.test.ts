import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { ModelsRepo } from '../src/main/db/repositories/modelsRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import type { ModelSummary } from '../src/shared/contracts.js';

function createRepo(
  t: { after: (fn: () => void) => void },
  selfManaged: () => readonly string[] = () => []
) {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-models-repo-'));
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

  return new ModelsRepo(database, selfManaged);
}

function model(id: string, overrides: Partial<ModelSummary> = {}): ModelSummary {
  return {
    id,
    providerId: 'openrouter',
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

test('ModelsRepo round-trips per-model request limits', async (t) => {
  const repo = createRepo(t);

  repo.upsertModels([
    model('vendor/reasoner', { maxOutputTokens: 64_000, supportsTemperature: false, supportsReasoning: true })
  ]);

  const stored = repo.getById('vendor/reasoner');
  assert.ok(stored);
  assert.equal(stored.maxOutputTokens, 64_000);
  assert.equal(stored.supportsTemperature, false);
  assert.equal(stored.supportsReasoning, true);
});

test('ModelsRepo getRuntimeHints returns empty hints for an unknown model', async (t) => {
  const repo = createRepo(t);

  assert.deepEqual(repo.getRuntimeHints('vendor/missing'), {});
});

test('ModelsRepo getRuntimeHints defaults temperature support for legacy rows', async (t) => {
  const repo = createRepo(t);

  // A summary produced before the capability columns existed.
  repo.upsertModels([model('vendor/legacy')]);

  const hints = repo.getRuntimeHints('vendor/legacy');
  assert.equal(hints.supportsTemperature, true);
  assert.equal(hints.maxOutputTokens, null);
  assert.equal(hints.contextWindow, 128_000);
});

test('ModelsRepo archives models a complete catalog no longer serves', async (t) => {
  const repo = createRepo(t);

  repo.upsertModels([model('vendor/kept'), model('vendor/removed')], { pruneProviderId: 'openrouter' });
  assert.equal(repo.list().length, 2);

  repo.upsertModels([model('vendor/kept')], { pruneProviderId: 'openrouter' });

  assert.deepEqual(
    repo.list().map((entry) => entry.id),
    ['vendor/kept']
  );
  // Archived, not deleted, so history referencing it still resolves.
  assert.equal(repo.getById('vendor/removed')?.archived, true);
});

test('ModelsRepo pruning is scoped to the refreshed provider', async (t) => {
  const repo = createRepo(t);

  repo.upsertModels([model('vendor/openrouter-model'), model('glm-4.7', { providerId: 'glm' })]);
  repo.upsertModels([model('vendor/openrouter-model')], { pruneProviderId: 'openrouter' });

  assert.equal(repo.getById('glm-4.7')?.archived, false);
});

test('ModelsRepo prunes when a refresh returned nothing with pruneProviderId', async (t) => {
  const repo = createRepo(t);

  repo.upsertModels([model('vendor/kept')], { pruneProviderId: 'openrouter' });
  repo.upsertModels([], { pruneProviderId: 'openrouter' });

  assert.equal(repo.getById('vendor/kept')?.archived, true);
});

test('ModelsRepo remembers when a model was last free', async (t) => {
  const repo = createRepo(t);

  repo.upsertModels([model('vendor/free', { isFree: true })]);
  const freeAt = repo.getById('vendor/free')?.lastSeenFreeAt;
  assert.ok(freeAt);

  repo.upsertModels([model('vendor/free', { isFree: false })]);
  assert.equal(repo.getById('vendor/free')?.lastSeenFreeAt, freeAt);
});

function configureProvider(repo: ModelsRepo, id: string, enabled = true) {
  // Reach past the repo API: these tests only need the provider row to exist,
  // not a full CustomProvidersRepo.
  const db = (repo as unknown as { db: SqliteDatabase }).db;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO custom_providers (id, name, base_url, api_format, enabled, sort_order, created_at, updated_at)
     VALUES (@id, @id, 'https://example.com/v1', 'chat-completions', @enabled, 0, @now, @now)`
  ).run({ id, enabled: enabled ? 1 : 0, now });
}

test('configuredOnly hides models whose provider was never configured', async (t) => {
  const repo = createRepo(t);

  configureProvider(repo, 'custom:configured');
  repo.upsertModels([
    model('kept', { providerId: 'custom:configured' }),
    // A leftover row from a provider that no longer exists — this is what put
    // unusable models in the picker.
    model('orphan', { providerId: 'gemini' })
  ]);

  assert.deepEqual(repo.list().map((entry) => entry.id).sort(), ['kept', 'orphan']);
  assert.deepEqual(repo.list({ configuredOnly: true }).map((entry) => entry.id), ['kept']);
});

test('configuredOnly hides models from a disabled provider', async (t) => {
  const repo = createRepo(t);

  configureProvider(repo, 'custom:on');
  configureProvider(repo, 'custom:off', false);
  repo.upsertModels([
    model('on-model', { providerId: 'custom:on' }),
    model('off-model', { providerId: 'custom:off' })
  ]);

  assert.deepEqual(repo.list({ configuredOnly: true }).map((entry) => entry.id), ['on-model']);
});

test('deleteOrphanedModels drops removed providers but spares disabled ones', async (t) => {
  const repo = createRepo(t);

  configureProvider(repo, 'custom:on');
  configureProvider(repo, 'custom:off', false);
  repo.upsertModels([
    model('on-model', { providerId: 'custom:on' }),
    model('off-model', { providerId: 'custom:off' }),
    model('orphan', { providerId: 'custom:gone' })
  ]);

  repo.deleteOrphanedModels();

  // A disabled provider's models return when it is re-enabled, with no refetch.
  assert.deepEqual(
    repo.list({ includeArchived: true }).map((entry) => entry.id).sort(),
    ['off-model', 'on-model']
  );
});

test('the same model id on two providers is two rows, not a clobbered one', async (t) => {
  const repo = createRepo(t);

  // Both endpoints expose `shared-model`; neither refresh may steal the row
  // from the other, which the old model_id-only primary key allowed.
  repo.upsertModels([model('shared-model', { providerId: 'custom:first', label: 'First copy' })]);
  repo.upsertModels([model('shared-model', { providerId: 'custom:second', label: 'Second copy' })]);

  const rows = repo.list({ includeArchived: true });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((entry) => entry.providerId).sort(),
    ['custom:first', 'custom:second']
  );

  // Re-refreshing one provider leaves the other's copy intact.
  repo.upsertModels([model('shared-model', { providerId: 'custom:first', label: 'First copy' })]);
  assert.equal(repo.list({ includeArchived: true }).length, 2);
});

test('getById prefers an enabled provider when a model id is served twice', async (t) => {
  const repo = createRepo(t);

  configureProvider(repo, 'custom:on');
  configureProvider(repo, 'custom:off', false);
  repo.upsertModels([
    model('dual-model', { providerId: 'custom:off' }),
    model('dual-model', { providerId: 'custom:on' })
  ]);

  assert.equal(repo.getById('dual-model')?.providerId, 'custom:on');

  // Deterministic even with nothing enabled: lowest provider id wins.
  const bareRepo = createRepo(t);
  bareRepo.upsertModels([
    model('dual-model', { providerId: 'custom:zzz' }),
    model('dual-model', { providerId: 'custom:aaa' })
  ]);
  assert.equal(bareRepo.getById('dual-model')?.providerId, 'custom:aaa');
});

/* ------------------------------------------------------------------ *
 * Providers that configure themselves (the OpenCode integration)
 * ------------------------------------------------------------------ */

test('a self-managed provider reaches the picker without a saved endpoint', async (t) => {
  const repo = createRepo(t, () => ['opencode']);

  repo.upsertModels([model('opencode/mimo', { providerId: 'opencode' })]);

  // It has no `custom_providers` row and never will: OpenCode signs itself in.
  assert.deepEqual(repo.list({ configuredOnly: true }).map((entry) => entry.id), ['opencode/mimo']);

  repo.deleteOrphanedModels();
  assert.deepEqual(repo.list({ configuredOnly: true }).map((entry) => entry.id), ['opencode/mimo']);
});

test('its models go the moment the integration is off', async (t) => {
  let enabled = true;
  const repo = createRepo(t, () => (enabled ? ['opencode'] : []));

  repo.upsertModels([model('opencode/mimo', { providerId: 'opencode' })]);
  assert.equal(repo.list({ configuredOnly: true }).length, 1);

  enabled = false;
  assert.deepEqual(repo.list({ configuredOnly: true }), [], 'hidden as soon as it is switched off');

  repo.deleteOrphanedModels();
  assert.deepEqual(repo.list({ includeArchived: true }), [], 'and swept like any other dead provider');
});

test('a model id served by both an endpoint and an integration resolves to a servable row', async (t) => {
  const repo = createRepo(t, () => ['opencode']);

  configureProvider(repo, 'custom:byurl');
  repo.upsertModels([
    model('shared/model', { providerId: 'custom:byurl', label: 'via base URL' }),
    model('shared/model', { providerId: 'opencode', label: 'via the integration' })
  ]);

  // Both are servable, so the tie breaks on provider id — the point is that
  // the integration ranks with the endpoint rather than below it.
  const resolved = repo.getById('shared/model');
  assert.ok(resolved);
  assert.equal(resolved.providerId, 'custom:byurl');

  configureProvider(repo, 'custom:disabled', false);
  repo.upsertModels([model('agent-only', { providerId: 'opencode' })]);
  assert.equal(repo.getById('agent-only')?.providerId, 'opencode');
});
