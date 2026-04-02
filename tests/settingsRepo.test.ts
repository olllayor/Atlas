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
