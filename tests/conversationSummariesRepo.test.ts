import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { ConversationSummariesRepo } from '../src/main/db/repositories/conversationSummariesRepo.js';
import { applySchema } from '../src/main/db/schema.js';

function createDatabase() {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-summaries-repo-'));
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

  return { database, raw, tempDir };
}

function insertConversation(database: SqliteDatabase, id: string) {
  database
    .prepare(
      `INSERT INTO conversations (id, title, created_at, updated_at)
       VALUES (@id, @title, @now, @now)`
    )
    .run({ id, title: 'Test chat', now: new Date().toISOString() });
}

test('ConversationSummariesRepo upserts and reads back a summary row', (t) => {
  const { database, raw, tempDir } = createDatabase();
  const repo = new ConversationSummariesRepo(database);
  insertConversation(database, 'conversation-1');

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  assert.equal(repo.get('conversation-1'), null);

  const written = repo.upsert({
    conversationId: 'conversation-1',
    fingerprint: 'fp-1',
    rollingSummary: 'Goals:\n- ship it',
    source: 'heuristic',
    status: 'ready',
  });

  const read = repo.get('conversation-1');
  assert.ok(read);
  assert.equal(read.conversationId, 'conversation-1');
  assert.equal(read.fingerprint, 'fp-1');
  assert.equal(read.rollingSummary, 'Goals:\n- ship it');
  assert.equal(read.source, 'heuristic');
  assert.equal(read.status, 'ready');
  assert.equal(read.updatedAt, written.updatedAt);
});

test('ConversationSummariesRepo upsert replaces the row in place', (t) => {
  const { database, raw, tempDir } = createDatabase();
  const repo = new ConversationSummariesRepo(database);
  insertConversation(database, 'conversation-2');

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  repo.upsert({
    conversationId: 'conversation-2',
    fingerprint: 'fp-1',
    rollingSummary: 'heuristic draft',
    source: 'heuristic',
    status: 'ready',
  });
  repo.upsert({
    conversationId: 'conversation-2',
    fingerprint: 'fp-2',
    rollingSummary: 'model upgrade',
    source: 'model',
    status: 'building',
  });

  const read = repo.get('conversation-2');
  assert.ok(read);
  assert.equal(read.fingerprint, 'fp-2');
  assert.equal(read.rollingSummary, 'model upgrade');
  assert.equal(read.source, 'model');
  assert.equal(read.status, 'building');
});

test('a summary row is cascade-deleted with its conversation', (t) => {
  const { database, raw, tempDir } = createDatabase();
  const repo = new ConversationSummariesRepo(database);
  insertConversation(database, 'conversation-3');

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  repo.upsert({
    conversationId: 'conversation-3',
    fingerprint: 'fp-1',
    rollingSummary: 'Goals:\n- something',
    source: 'heuristic',
    status: 'ready',
  });
  assert.ok(repo.get('conversation-3'));

  database.prepare('DELETE FROM conversations WHERE id = @id').run({ id: 'conversation-3' });
  assert.equal(repo.get('conversation-3'), null);
});

test('deleteForConversation removes only that conversation row', (t) => {
  const { database, raw, tempDir } = createDatabase();
  const repo = new ConversationSummariesRepo(database);
  insertConversation(database, 'conversation-4');
  insertConversation(database, 'conversation-5');

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  for (const id of ['conversation-4', 'conversation-5']) {
    repo.upsert({
      conversationId: id,
      fingerprint: `fp-${id}`,
      rollingSummary: `summary for ${id}`,
      source: 'heuristic',
      status: 'ready',
    });
  }

  repo.deleteForConversation('conversation-4');
  assert.equal(repo.get('conversation-4'), null);
  assert.ok(repo.get('conversation-5'));
});
