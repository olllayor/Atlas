import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { applySchema } from '../src/main/db/schema.js';

function setup() {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-conversation-lifecycle-'));
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
  return { tempDir, raw, conversations: new ConversationsRepo(database) };
}

test('new conversations read back as active and never-snoozed', (t) => {
  const { tempDir, raw, conversations } = setup();
  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversation = conversations.create();
  const [summary] = conversations.list();
  assert.equal(summary?.id, conversation.id);
  assert.equal(summary?.settledAt, null);
  assert.equal(summary?.unsettledAt, null);
  assert.equal(summary?.snoozedUntil, null);
  assert.equal(summary?.snoozedAt, null);
});

test('settle parks the chat and re-settling keeps the original timestamp', (t) => {
  const { tempDir, raw, conversations } = setup();
  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversation = conversations.create();
  const settled = conversations.setSettled(conversation.id, true);
  assert.ok(settled.settledAt !== null);
  assert.equal(settled.unsettledAt, null);

  // Settled chats stay in the default listing (settled is not archived).
  assert.ok(conversations.list().some((entry) => entry.id === conversation.id));

  const firstStamp = settled.settledAt;
  const resettled = conversations.setSettled(conversation.id, true);
  assert.equal(resettled.settledAt, firstStamp);
});

test('settling a running chat is rejected', (t) => {
  const { tempDir, raw, conversations } = setup();
  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversation = conversations.create();
  conversations.updateStatus(conversation.id, { status: 'running' });
  assert.throws(() => conversations.setSettled(conversation.id, true), /still running/);
  assert.equal(conversations.getSummary(conversation.id)?.settledAt, null);
});

test('settling an unknown chat throws', (t) => {
  const { tempDir, raw, conversations } = setup();
  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  assert.throws(() => conversations.setSettled('missing', true), /not found/);
});

test('unsettling clears settled and anchors ordering exactly once', (t) => {
  const { tempDir, raw, conversations } = setup();
  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversation = conversations.create();
  conversations.setSettled(conversation.id, true);
  const reopened = conversations.setSettled(conversation.id, false);
  assert.equal(reopened.settledAt, null);
  assert.ok(reopened.unsettledAt !== null);

  const anchor = reopened.unsettledAt;
  const redundant = conversations.setSettled(conversation.id, false);
  assert.equal(redundant.unsettledAt, anchor);
});

test('settling preserves an existing pin', (t) => {
  const { tempDir, raw, conversations } = setup();
  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversation = conversations.create();
  conversations.setPinned(conversation.id, true);
  const settled = conversations.setSettled(conversation.id, true);
  assert.ok(settled.pinnedAt !== null);
  assert.ok(settled.settledAt !== null);
});

test('snooze requires a future wake time and re-snoozing keeps the stamp', (t) => {
  const { tempDir, raw, conversations } = setup();
  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversation = conversations.create();
  assert.throws(() => conversations.setSnoozed(conversation.id, 'not-a-date'), /wake time/);
  assert.throws(
    () => conversations.setSnoozed(conversation.id, new Date(Date.now() - 1000).toISOString()),
    /wake time/
  );

  const wake = new Date(Date.now() + 3600_000).toISOString();
  const snoozed = conversations.setSnoozed(conversation.id, wake);
  assert.equal(snoozed.snoozedUntil, wake);
  assert.ok(snoozed.snoozedAt !== null);

  const stamp = snoozed.snoozedAt;
  assert.equal(conversations.setSnoozed(conversation.id, wake).snoozedAt, stamp);

  const cleared = conversations.setSnoozed(conversation.id, null);
  assert.equal(cleared.snoozedUntil, null);
  assert.equal(cleared.snoozedAt, null);
});

test('user activity clears parked state, and only parked state', (t) => {
  const { tempDir, raw, conversations } = setup();
  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const parked = conversations.create();
  conversations.setSettled(parked.id, true);
  conversations.setSnoozed(parked.id, new Date(Date.now() + 3600_000).toISOString());

  conversations.clearLifecycleOnUserActivity(parked.id);
  const summary = conversations.getSummary(parked.id);
  assert.equal(summary?.settledAt, null);
  assert.ok(summary?.unsettledAt !== null);
  assert.equal(summary?.snoozedUntil, null);
  assert.equal(summary?.snoozedAt, null);

  // An active chat is untouched: no anchor stamped, no row churn.
  const active = conversations.create();
  conversations.clearLifecycleOnUserActivity(active.id);
  assert.equal(conversations.getSummary(active.id)?.unsettledAt, null);
});

test('lifecycle state survives app restart and legacy chats behave as active', (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-lifecycle-restart-'));
  const dbPath = join(tempDir, 'atlas.db');

  function openRepo(rawDb: DatabaseSync): ConversationsRepo {
    const database = {
      exec: (sql: string) => rawDb.exec(sql),
      prepare: (sql: string) => rawDb.prepare(sql),
      transaction:
        <TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) =>
        (...args: TArgs) => {
          rawDb.exec('BEGIN');
          try {
            const result = callback(...args);
            rawDb.exec('COMMIT');
            return result;
          } catch (error) {
            rawDb.exec('ROLLBACK');
            throw error;
          }
        },
    } as unknown as SqliteDatabase;
    applySchema(database);
    return new ConversationsRepo(database);
  }

  t.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // 1. First app run: create chats in various lifecycle states
  let raw = new DatabaseSync(dbPath);
  let repo = openRepo(raw);

  const activeChat = repo.create({ title: 'Active Chat' });
  const settledChat = repo.create({ title: 'Settled Chat' });
  const snoozedChat = repo.create({ title: 'Snoozed Chat' });

  const settledRes = repo.setSettled(settledChat.id, true);
  const wakeTime = new Date(Date.now() + 7200_000).toISOString();
  const snoozedRes = repo.setSnoozed(snoozedChat.id, wakeTime);

  // Directly insert a legacy row to simulate a conversation created before lifecycle schema migration
  const legacyId = 'legacy-pre-migration-chat';
  const nowIso = new Date().toISOString();
  raw.prepare(`
    INSERT INTO conversations (id, title, status, created_at, updated_at)
    VALUES (?, 'Old Legacy Chat', 'idle', ?, ?)
  `).run(legacyId, nowIso, nowIso);

  // Close database (simulate app quit / restart)
  raw.close();

  // 2. Second app run: re-open from same file on disk
  raw = new DatabaseSync(dbPath);
  repo = openRepo(raw);

  // Verify active chat
  const activeSummary = repo.getSummary(activeChat.id);
  assert.ok(activeSummary);
  assert.equal(activeSummary.settledAt, null);
  assert.equal(activeSummary.snoozedUntil, null);

  // Verify settled chat preserved exactly
  const settledSummary = repo.getSummary(settledChat.id);
  assert.ok(settledSummary);
  assert.equal(settledSummary.settledAt, settledRes.settledAt);
  assert.equal(settledSummary.unsettledAt, null);

  // Verify snoozed chat preserved exactly
  const snoozedSummary = repo.getSummary(snoozedChat.id);
  assert.ok(snoozedSummary);
  assert.equal(snoozedSummary.snoozedUntil, wakeTime);
  assert.equal(snoozedSummary.snoozedAt, snoozedRes.snoozedAt);

  // Verify legacy chat reads back as active with NULL lifecycle fields
  const legacySummary = repo.getSummary(legacyId);
  assert.ok(legacySummary);
  assert.equal(legacySummary.title, 'Old Legacy Chat');
  assert.equal(legacySummary.settledAt, null);
  assert.equal(legacySummary.unsettledAt, null);
  assert.equal(legacySummary.snoozedUntil, null);
  assert.equal(legacySummary.snoozedAt, null);

  raw.close();
});
