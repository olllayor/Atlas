import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { SettingsRepo } from '../src/main/db/repositories/settingsRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import { getDefaultKeybindingRules } from '../src/shared/keybindings.js';

function createDatabase() {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-settings-repo-'));
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
    database,
    raw,
    tempDir,
  };
}

test('SettingsRepo stores and normalizes typography preferences', (t) => {
  const { database, raw, tempDir } = createDatabase();
  const settingsRepo = new SettingsRepo(database);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  settingsRepo.setUiFontSize(99);
  settingsRepo.setCodeFontSize(2);
  settingsRepo.setUiFontFamily('OpenAI Sans');
  settingsRepo.setCodeFontFamily('Berkeley Mono');

  assert.equal(settingsRepo.getUiFontSize(), 18);
  assert.equal(settingsRepo.getCodeFontSize(), 11);
  assert.equal(settingsRepo.getUiFontFamily(), 'OpenAI Sans');
  assert.equal(settingsRepo.getCodeFontFamily(), 'Berkeley Mono');
});

test('SettingsRepo stores and restores keybindings', (t) => {
  const { database, raw, tempDir } = createDatabase();
  const settingsRepo = new SettingsRepo(database);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const custom = getDefaultKeybindingRules();
  custom[0] = {
    ...custom[0]!,
    shortcut: {
      ...custom[0]!.shortcut,
      key: 'p',
    },
  };

  settingsRepo.setKeybindings(custom);

  assert.deepEqual(settingsRepo.getKeybindings(), custom);
});

test('SettingsRepo falls back to defaults when stored keybindings are invalid', (t) => {
  const { database, raw, tempDir } = createDatabase();
  const settingsRepo = new SettingsRepo(database);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  raw
    .prepare(
      `
        INSERT INTO app_settings (key, value)
        VALUES ('keybindings', '{not valid json}')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
    )
    .run();

  assert.deepEqual(settingsRepo.getKeybindings(), getDefaultKeybindingRules());
});

test('cold cache: getCloudSandboxWorkerSecret reads through to keychain, then memoizes', async (t) => {
  const { database, raw, tempDir } = createDatabase();

  // Constructor-injected seam so the test doesn't touch the real OS keychain.
  let store: string | null = null;
  let readCount = 0;
  const fakeStore = {
    read: async () => {
      readCount += 1;
      return store;
    },
    write: async (value: string | null) => {
      store = value;
    },
  };

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  store = 'cold-keychain-value';

  const settingsRepo = new SettingsRepo(database, { cloudSandboxSecretStore: fakeStore });
  assert.equal(settingsRepo.hasCloudSandboxWorkerSecret(), false, 'no prime yet');

  assert.equal(await settingsRepo.requireCloudSandboxWorkerSecret(), 'cold-keychain-value');
  assert.equal(readCount, 1, 'first call hits the keychain');
  assert.equal(settingsRepo.hasCloudSandboxWorkerSecret(), true, 'read back-fills cache');

  // Second call is served from the now-warm cache, not a second keychain round-trip.
  assert.equal(await settingsRepo.requireCloudSandboxWorkerSecret(), 'cold-keychain-value');
  assert.equal(readCount, 1, 'second call is served from cache');
});

test('purgeLegacyCloudSandboxWorkerSecret removes the plaintext row and is idempotent', (t) => {
  const { database, raw, tempDir } = createDatabase();
  const settingsRepo = new SettingsRepo(database);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Seed the legacy row exactly the way the pre-keytar version stored it.
  raw
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run({ key: 'chat.cloudSandboxWorkerSecret', value: JSON.stringify('plaintext-bearer-token') });

  settingsRepo.purgeLegacyCloudSandboxWorkerSecret();

  const row = raw
    .prepare(`SELECT value FROM app_settings WHERE key = 'chat.cloudSandboxWorkerSecret'`)
    .get();
  assert.equal(row, undefined, 'legacy plaintext row is gone');

  assert.doesNotThrow(() => settingsRepo.purgeLegacyCloudSandboxWorkerSecret(), 'second call is a no-op');
});
