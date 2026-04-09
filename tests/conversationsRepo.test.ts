import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { AttachmentStore } from '../src/main/attachments/AttachmentStore.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { ToolExecutionsRepo } from '../src/main/db/repositories/toolExecutionsRepo.js';
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

test('ConversationsRepo rebuilds attachment-backed user history from stored files', (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-conversations-attachments-'));
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
  const attachmentStore = new AttachmentStore(join(tempDir, 'attachments'));
  const conversations = new ConversationsRepo(database, attachmentStore);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversation = conversations.create();
  const storedAttachment = attachmentStore.persistAttachment(conversation.id, {
    type: 'file',
    filename: 'note.txt',
    mediaType: 'text/plain',
    sizeBytes: 5,
    url: 'data:text/plain;base64,aGVsbG8=',
  });

  conversations.addMessage({
    conversationId: conversation.id,
    role: 'user',
    content: 'Attachment',
    parts: [storedAttachment],
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: createTimestamp(0),
  });

  const history = conversations.getModelHistory(conversation.id);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.role, 'user');
  assert.ok(Array.isArray(history[0]?.content));

  const [filePart] = history[0]!.content as Array<{
    type: 'file';
    filename?: string;
    mediaType: string;
    data: Uint8Array;
  }>;
  assert.equal(filePart?.type, 'file');
  assert.equal(filePart?.filename, 'note.txt');
  assert.equal(filePart?.mediaType, 'text/plain');
  assert.equal(new TextDecoder().decode(filePart?.data), 'hello');
});

test('ConversationsRepo hydrates assistant tool parts from tool_executions and ignores empty streaming placeholders in preview', (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-conversations-tools-'));
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
  const toolExecutions = new ToolExecutionsRepo(database);
  const conversations = new ConversationsRepo(database, undefined, toolExecutions);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversation = conversations.create();
  conversations.addMessage({
    conversationId: conversation.id,
    role: 'user',
    content: 'Find docs for this API',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: createTimestamp(0),
  });
  const assistantMessageId = conversations.addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: '',
    status: 'streaming',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: createTimestamp(1),
  });

  toolExecutions.save({
    id: 'tool-1',
    conversationId: conversation.id,
    messageId: assistantMessageId,
    requestId: 'request-1',
    toolName: 'web_search',
    state: 'partial',
    inputPreview: '{"query":"api docs"}',
    partialOutputPreview: 'Found 3 matching results…',
  });

  const [summary] = conversations.list();
  assert.equal(summary?.lastMessagePreview, 'Find docs for this API');

  const page = conversations.getPage(conversation.id, { limit: 10 });
  const assistant = page.messages.find((message) => message.id === assistantMessageId);
  const toolPart = assistant?.parts.find((part) => part.type === 'tool');
  assert.equal(toolPart?.type, 'tool');
  if (toolPart?.type === 'tool') {
    assert.equal(toolPart.state, 'output-partial');
    assert.equal(toolPart.requestId, 'request-1');
    assert.equal(toolPart.output, 'Found 3 matching results…');
  }
});
