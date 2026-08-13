import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { applySchema } from '../src/main/db/schema.js';
import { FileChangesRepo } from '../src/main/db/repositories/fileChangesRepo.js';
import { FileChangeTracker } from '../src/main/workspace/FileChangeTracker.js';
import type { ToolWorkspace } from '../src/main/ai/tools/toolWorkspace.js';

function makeTempDb() {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-filechange-db-'));
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

function makeTempDir() {
  const root = mkdtempSync(join(tmpdir(), 'atlas-filechange-test-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('FileChangesRepo creates, lists, and updates status', () => {
  const db = makeTempDb();
  const repo = new FileChangesRepo(db);

  const record = repo.create({
    conversationId: 'c-1',
    filePath: 'src/index.ts',
    beforeContent: 'const a = 1;',
    afterContent: 'const a = 2;',
    diffText: '-const a = 1;\n+const a = 2;'
  });

  assert.ok(record.id);
  assert.equal(record.status, 'pending');

  const list = repo.listForConversation('c-1');
  assert.equal(list.length, 1);
  assert.equal(list[0].filePath, 'src/index.ts');

  const updated = repo.updateStatus(record.id, 'accepted');
  assert.equal(updated.status, 'accepted');
});

test('FileChangeTracker reverts file changes', () => {
  const db = makeTempDb();
  const repo = new FileChangesRepo(db);
  const tracker = new FileChangeTracker(repo);
  const { root, cleanup } = makeTempDir();

  try {
    const filePath = join(root, 'test.txt');
    writeFileSync(filePath, 'modified content');

    const record = tracker.recordChange({
      conversationId: 'c-1',
      filePath,
      beforeContent: 'original content',
      afterContent: 'modified content',
      diffText: '-original content\n+modified content'
    });

    const workspace: ToolWorkspace = { mode: 'code', root };
    const reverted = tracker.revertChange(record.id, workspace);

    assert.equal(reverted.status, 'reverted');
    assert.equal(readFileSync(filePath, 'utf8'), 'original content');
  } finally {
    cleanup();
  }
});
