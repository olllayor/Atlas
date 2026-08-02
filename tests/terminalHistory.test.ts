import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { applySchema } from '../src/main/db/schema.js';
import { TerminalHistoryRepo } from '../src/main/db/repositories/terminalHistoryRepo.js';

function makeTempDb() {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-term-db-'));
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
  database.exec("INSERT INTO conversations (id, title, created_at, updated_at) VALUES ('c-1', 'Test Chat', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
  return database;
}

test('TerminalHistoryRepo adds, lists, and deletes command history', () => {
  const db = makeTempDb();
  const repo = new TerminalHistoryRepo(db);

  const entry = repo.add({
    conversationId: 'c-1',
    command: 'npm test',
    exitCode: 0
  });

  assert.ok(entry.id);
  assert.equal(entry.command, 'npm test');
  assert.equal(entry.exitCode, 0);

  const history = repo.listForConversation('c-1');
  assert.equal(history.length, 1);
  assert.equal(history[0].command, 'npm test');

  repo.deleteForConversation('c-1');
  const emptyHistory = repo.listForConversation('c-1');
  assert.equal(emptyHistory.length, 0);
});
