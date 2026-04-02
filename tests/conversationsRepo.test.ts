import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import { decodeConversationPageCursor } from '../src/shared/conversationPaging.js';

function createTimestamp(index: number) {
  return new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
}

test('ConversationsRepo returns summary previews, stable pages, and stats', (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-conversations-repo-'));
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
  const conversations = new ConversationsRepo(database);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversation = conversations.create();

  conversations.addMessage({
    conversationId: conversation.id,
    role: 'user',
    content: 'First question',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: createTimestamp(0),
  });
  conversations.addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: 'First answer',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: createTimestamp(1),
  });
  conversations.addMessage({
    conversationId: conversation.id,
    role: 'user',
    content: 'Second question',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: createTimestamp(2),
  });
  conversations.addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: 'Second answer',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: createTimestamp(3),
  });
  conversations.addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: 'Final answer',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: createTimestamp(4),
  });

  const [summary] = conversations.list();
  assert.equal(summary?.lastMessagePreview, 'Final answer');
  assert.equal(summary?.lastUserMessagePreview, 'Second question');
  assert.equal(summary?.lastAssistantMessagePreview, 'Final answer');

  const pageOne = conversations.getPage(conversation.id, { limit: 2 });
  assert.deepEqual(
    pageOne.messages.map((message) => message.content),
    ['Second answer', 'Final answer']
  );
  assert.equal(pageOne.hasOlder, true);
  assert.equal(decodeConversationPageCursor(pageOne.nextCursor ?? '')?.id, pageOne.messages[0]?.id);

  const pageTwo = conversations.getPage(conversation.id, {
    cursor: pageOne.nextCursor,
    limit: 2,
  });
  assert.deepEqual(
    pageTwo.messages.map((message) => message.content),
    ['First answer', 'Second question']
  );
  assert.equal(pageTwo.hasOlder, true);

  const pageThree = conversations.getPage(conversation.id, {
    cursor: pageTwo.nextCursor,
    limit: 2,
  });
  assert.deepEqual(pageThree.messages.map((message) => message.content), ['First question']);
  assert.equal(pageThree.hasOlder, false);
  assert.equal(pageThree.nextCursor, null);

  const stats = conversations.getStats();
  assert.equal(stats.storedConversationCount, 1);
  assert.equal(stats.storedMessageCount, 5);
  assert.ok(stats.databaseSizeBytes > 0);
});
