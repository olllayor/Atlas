import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { ProjectsRepo } from '../src/main/db/repositories/projectsRepo.js';
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

test('pinning a conversation records when, and unpinning clears it', (t) => {
  const conversations = new ConversationsRepo(makeDatabase(t, 'pin-conversation'));
  const conversation = conversations.create();

  assert.equal(conversation.pinnedAt, null, 'a new chat starts unpinned');

  const pinned = conversations.setPinned(conversation.id, true);
  assert.ok(pinned.pinnedAt, 'pinning stamps a timestamp');
  assert.ok(!Number.isNaN(Date.parse(pinned.pinnedAt!)), 'the stamp is an ISO instant');
  assert.equal(conversations.list().find((row) => row.id === conversation.id)?.pinnedAt, pinned.pinnedAt);

  // Pinning twice must not reshuffle the pinned section under the user.
  assert.equal(conversations.setPinned(conversation.id, true).pinnedAt, pinned.pinnedAt);

  assert.equal(conversations.setPinned(conversation.id, false).pinnedAt, null);
  assert.equal(conversations.list().find((row) => row.id === conversation.id)?.pinnedAt, null);

  assert.throws(() => conversations.setPinned('missing-conversation', true), /not found/);
});

test('archiving hides a chat from the default listing without destroying it', (t) => {
  const conversations = new ConversationsRepo(makeDatabase(t, 'archive-conversation'));
  const kept = conversations.create();
  const archived = conversations.create();

  conversations.addMessage({
    conversationId: archived.id,
    role: 'user',
    content: 'Still here after archiving',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });

  const stamped = conversations.setArchived(archived.id, true);
  assert.ok(stamped.archivedAt, 'archiving stamps a timestamp');

  const visible = conversations.list();
  assert.deepEqual(visible.map((row) => row.id), [kept.id]);

  const all = conversations.list({ includeArchived: true }).map((row) => row.id).sort();
  assert.deepEqual(all, [kept.id, archived.id].sort());

  // The row itself is untouched — archive is reversible, delete is not.
  assert.equal(conversations.getPage(archived.id).messages.length, 1);
  assert.equal(conversations.getStats().storedConversationCount, 2);

  // Fetching by id still works while archived, so an open chat that gets
  // archived does not blow up mid-session.
  assert.equal(conversations.getSummary(archived.id)?.archivedAt, stamped.archivedAt);
  assert.equal(conversations.get(archived.id).conversation.archivedAt, stamped.archivedAt);

  assert.equal(conversations.setArchived(archived.id, false).archivedAt, null);
  assert.equal(conversations.list().length, 2);

  assert.throws(() => conversations.setArchived('missing-conversation', true), /not found/);
});

test('pinning and archiving are not activity: updated_at never moves', (t) => {
  const conversations = new ConversationsRepo(makeDatabase(t, 'pin-updated-at'));
  const conversation = conversations.create();
  const { updatedAt } = conversation;

  // `updated_at` drives the sidebar's relative time and its ordering, so a pin
  // that bumped it would claim the conversation had just been worked on.
  assert.equal(conversations.setPinned(conversation.id, true).updatedAt, updatedAt);
  assert.equal(conversations.setPinned(conversation.id, false).updatedAt, updatedAt);
  assert.equal(conversations.setArchived(conversation.id, true).updatedAt, updatedAt);
  assert.equal(conversations.setArchived(conversation.id, false).updatedAt, updatedAt);
  assert.equal(conversations.getSummary(conversation.id)?.updatedAt, updatedAt);
});

test('pinning a project round-trips and leaves its recency alone', (t) => {
  const database = makeDatabase(t, 'pin-project');
  const projects = new ProjectsRepo(database);

  const project = projects.create({ root: tmpdir(), title: 'Atlas' });
  assert.equal(project.pinnedAt, null);

  projects.touch(project.id);
  const before = projects.get(project.id)!;

  const pinned = projects.setPinned(project.id, true);
  assert.ok(pinned.pinnedAt);
  assert.equal(pinned.updatedAt, before.updatedAt, 'a pin is not an edit');
  assert.equal(pinned.lastUsedAt, before.lastUsedAt, 'a pin is not use');
  assert.equal(projects.list().find((row) => row.id === project.id)?.pinnedAt, pinned.pinnedAt);

  assert.equal(projects.setPinned(project.id, true).pinnedAt, pinned.pinnedAt);
  assert.equal(projects.setPinned(project.id, false).pinnedAt, null);

  assert.throws(() => projects.setPinned('missing-project', true), /not found/);
});

test('the pin and archive migration is idempotent and upgrades a pre-migration database', (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-pin-migration-'));
  const path = join(tempDir, 'atlas.db');
  const raw = new DatabaseSync(path);

  t.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Stand up the tables as an older build left them: no pinned_at anywhere, no
  // archived_at. `CREATE TABLE IF NOT EXISTS` then leaves them alone and the
  // ALTER path is what has to fill the gap.
  raw.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      default_provider_id TEXT,
      default_model_id TEXT
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      root TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT
    );
  `);
  raw.exec(
    `INSERT INTO conversations (id, title, created_at, updated_at)
     VALUES ('legacy', 'Older chat', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
  );

  const database = wrap(raw);
  applySchema(database);

  const columnsOf = (table: string) =>
    (raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);

  assert.ok(columnsOf('conversations').includes('pinned_at'));
  assert.ok(columnsOf('conversations').includes('archived_at'));
  assert.ok(columnsOf('projects').includes('pinned_at'));

  // Re-running against an already-migrated database must be a no-op, both in
  // the same session and after a reopen — this runs on every launch.
  applySchema(database);
  raw.close();

  const reopened = new DatabaseSync(path);
  t.after(() => reopened.close());
  applySchema(wrap(reopened));

  const conversations = new ConversationsRepo(wrap(reopened));
  const legacy = conversations.list().find((row) => row.id === 'legacy');
  assert.ok(legacy, 'an upgraded chat is still in the sidebar');
  assert.equal(legacy?.pinnedAt, null);
  assert.equal(legacy?.archivedAt, null);
});
