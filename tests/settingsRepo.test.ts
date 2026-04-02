import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { SettingsRepo } from '../src/main/db/repositories/settingsRepo.js';
import { applySchema } from '../src/main/db/schema.js';

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
    tempDir,
    raw,
    settingsRepo: new SettingsRepo(database),
  };
}

test('SettingsRepo stores and normalizes typography preferences', (t) => {
  const { tempDir, raw, settingsRepo } = createDatabase();

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  settingsRepo.setUiFontSize(99);
  settingsRepo.setCodeFontSize(2);
  settingsRepo.setUiFontFamily('geist');
  settingsRepo.setCodeFontFamily('geist-mono');

  assert.equal(settingsRepo.getUiFontSize(), 18);
  assert.equal(settingsRepo.getCodeFontSize(), 11);
  assert.equal(settingsRepo.getUiFontFamily(), 'geist');
  assert.equal(settingsRepo.getCodeFontFamily(), 'geist-mono');
});
