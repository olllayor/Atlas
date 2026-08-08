import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { FileChangesRepo, countDiffLines } from '../src/main/db/repositories/fileChangesRepo.js';
import { applySchema } from '../src/main/db/schema.js';

function wrap(raw: DatabaseSync): SqliteDatabase {
  return {
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
}

function makeDatabase(t: TestContext, label: string) {
  const tempDir = mkdtempSync(join(tmpdir(), `atlas-${label}-`));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const database = wrap(raw);
  applySchema(database);

  return database;
}

const DIFF = [
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,4 @@',
  ' unchanged context',
  '-const removed = 1;',
  '+const added = 1;',
  '+const alsoAdded = 2;',
].join('\n');

test('the diff parser counts content lines and ignores the file headers', () => {
  assert.deepEqual(countDiffLines(DIFF), { linesAdded: 2, linesRemoved: 1 });

  // Headers only: a rename or a mode change edits nothing.
  assert.deepEqual(countDiffLines('--- a/x\n+++ b/x\n'), { linesAdded: 0, linesRemoved: 0 });

  assert.deepEqual(countDiffLines(''), { linesAdded: 0, linesRemoved: 0 });
  assert.deepEqual(countDiffLines('@@ -1 +1 @@\n context only\n'), { linesAdded: 0, linesRemoved: 0 });

  // A removed line that itself starts with a dash is content, not a header —
  // only the three-character `---`/`+++` markers are.
  assert.deepEqual(countDiffLines('-- trailing sql comment\n++x\n'), { linesAdded: 1, linesRemoved: 1 });

  // No trailing newline, and the last line still counts.
  assert.deepEqual(countDiffLines('+one'), { linesAdded: 1, linesRemoved: 0 });
});

test('change stats aggregate per conversation and leave reverted changes out', (t) => {
  const database = makeDatabase(t, 'change-stats');
  const conversations = new ConversationsRepo(database);
  const fileChanges = new FileChangesRepo(database);

  const worked = conversations.create();
  const idle = conversations.create();

  fileChanges.create({ conversationId: worked.id, filePath: 'src/app.ts', diffText: DIFF });
  // Same file twice: one changed file, two changes worth of lines.
  fileChanges.create({ conversationId: worked.id, filePath: 'src/app.ts', diffText: '+a\n+b\n-c\n' });
  fileChanges.create({ conversationId: worked.id, filePath: 'src/other.ts', diffText: '+x\n' });

  const undone = fileChanges.create({
    conversationId: worked.id,
    filePath: 'src/reverted.ts',
    diffText: '+900 lines\n'.repeat(5),
  });

  // Another conversation's changes must not leak into the first one's totals.
  fileChanges.create({ conversationId: idle.id, filePath: 'elsewhere.ts', diffText: '+1\n+2\n+3\n' });

  const before = conversations.getSummary(worked.id)!.changeStats;
  assert.deepEqual(before, { fileCount: 3, linesAdded: 10, linesRemoved: 2 });

  fileChanges.updateStatus(undone.id, 'reverted');

  const after = conversations.getSummary(worked.id)!.changeStats;
  assert.deepEqual(after, { fileCount: 2, linesAdded: 5, linesRemoved: 2 });

  // Accepted still counts — it is only reverted that left nothing behind.
  fileChanges.updateStatus(undone.id, 'accepted');
  assert.deepEqual(conversations.getSummary(worked.id)!.changeStats, before);
  fileChanges.updateStatus(undone.id, 'reverted');

  const listed = conversations.list();
  assert.deepEqual(listed.find((row) => row.id === worked.id)?.changeStats, after);
  assert.deepEqual(listed.find((row) => row.id === idle.id)?.changeStats, {
    fileCount: 1,
    linesAdded: 3,
    linesRemoved: 0,
  });
});

test('a conversation with no file changes reports zeros, never null', (t) => {
  const conversations = new ConversationsRepo(makeDatabase(t, 'change-stats-empty'));
  const conversation = conversations.create();

  // `create` goes through the same projection as the listing, so a null here
  // would reach the renderer on the very first row it draws.
  assert.deepEqual(conversation.changeStats, { fileCount: 0, linesAdded: 0, linesRemoved: 0 });
  assert.deepEqual(conversations.list()[0]?.changeStats, { fileCount: 0, linesAdded: 0, linesRemoved: 0 });
  assert.deepEqual(conversations.getSummary(conversation.id)?.changeStats, {
    fileCount: 0,
    linesAdded: 0,
    linesRemoved: 0,
  });
});

test('the line-count backfill upgrades pre-migration rows and is safe to repeat', (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-line-count-backfill-'));
  const path = join(tempDir, 'atlas.db');
  const raw = new DatabaseSync(path);

  t.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // file_changes as an older build left it: no line counts at all.
  raw.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      default_provider_id TEXT,
      default_model_id TEXT
    );

    CREATE TABLE file_changes (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      before_content TEXT,
      after_content TEXT,
      diff_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      tool_call_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  raw.exec(
    `INSERT INTO conversations (id, title, created_at, updated_at)
     VALUES ('legacy', 'Older chat', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
  );
  raw
    .prepare(
      `INSERT INTO file_changes (id, conversation_id, file_path, diff_text, status, created_at, updated_at)
       VALUES ('fc1', 'legacy', 'src/app.ts', ?, 'pending', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    )
    .run(DIFF);

  const database = wrap(raw);
  applySchema(database);

  const conversations = new ConversationsRepo(database);
  const expected = { fileCount: 1, linesAdded: 2, linesRemoved: 1 };
  assert.deepEqual(conversations.getSummary('legacy')?.changeStats, expected);

  // Re-running in the same session and again after a reopen must not change the
  // numbers or throw — this runs on every launch.
  applySchema(database);
  assert.deepEqual(conversations.getSummary('legacy')?.changeStats, expected);
  raw.close();

  const reopened = new DatabaseSync(path);
  t.after(() => reopened.close());
  applySchema(wrap(reopened));
  applySchema(wrap(reopened));

  assert.deepEqual(new ConversationsRepo(wrap(reopened)).getSummary('legacy')?.changeStats, expected);
});
