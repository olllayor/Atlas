import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import type { ConversationSummary } from '../src/shared/contracts.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import {
  buildSidebarConversationItems,
  formatElapsedSince
} from '../src/renderer/components/sidebarViewModel.js';

function makeRepo(t: { after: (fn: () => void) => void }) {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-conversation-status-'));
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

  return new ConversationsRepo(database);
}

test('a conversation starts idle and carries its turn status through the list', (t) => {
  const conversations = makeRepo(t);
  const id = conversations.create().id;

  assert.equal(conversations.list().find((row) => row.id === id)?.status, 'idle');

  conversations.updateStatus(id, { status: 'running', startedAt: '2026-08-03T10:00:00.000Z' });
  assert.equal(conversations.list().find((row) => row.id === id)?.status, 'running');

  conversations.updateStatus(id, {
    status: 'failed',
    lastError: 'provider refused the request',
    completedAt: '2026-08-03T10:00:30.000Z'
  });

  const failed = conversations.list().find((row) => row.id === id);
  assert.equal(failed?.status, 'failed');
});

function summary(overrides: Partial<ConversationSummary>): ConversationSummary {
  return {
    id: 'c1',
    title: 'A task',
    createdAt: '2026-08-03T09:00:00.000Z',
    updatedAt: '2026-08-03T09:00:00.000Z',
    lastMessagePreview: null,
    lastUserMessagePreview: null,
    lastAssistantMessagePreview: null,
    lastMessageAt: null,
    defaultProviderId: null,
    defaultModelId: null,
    workspaceMode: 'code',
    projectId: null,
    toolPermissionMode: 'ask',
    status: 'idle',
    ...overrides
  };
}

const NOW = Date.parse('2026-08-03T10:05:00.000Z');

test('a conversation left running in the background still reads as running', () => {
  const [item] = buildSidebarConversationItems({
    conversations: [summary({ status: 'running', startedAt: '2026-08-03T10:00:00.000Z' })],
    draftsByConversation: {},
    now: NOW
  });

  assert.equal(item!.isRunning, true);
  assert.equal(item!.isFailed, false);
  // Elapsed since the turn started, not the age of the conversation row.
  assert.equal(item!.timestampLabel, '5m');
});

test('a failed turn is marked on the row', () => {
  const [item] = buildSidebarConversationItems({
    conversations: [summary({ status: 'failed', lastError: 'boom' })],
    draftsByConversation: {},
    now: NOW
  });

  assert.equal(item!.isFailed, true);
  assert.equal(item!.isRunning, false);
});

test('this window’s own draft outranks the persisted status', () => {
  const [item] = buildSidebarConversationItems({
    conversations: [summary({ status: 'running' })],
    draftsByConversation: {
      c1: { status: 'error', errorMessage: 'stopped', startedAt: '2026-08-03T10:00:00.000Z' } as never
    },
    now: NOW
  });

  assert.equal(item!.isRunning, false);
  assert.equal(item!.isFailed, true);
});

test('elapsed time is reported in the unit that is still changing', () => {
  assert.equal(formatElapsedSince(NOW - 12_000, NOW), '12s');
  assert.equal(formatElapsedSince(NOW - 4 * 60_000, NOW), '4m');
  assert.equal(formatElapsedSince(NOW - 65 * 60_000, NOW), '1h 05m');
});
