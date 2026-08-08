import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { ToolExecutionsRepo } from '../src/main/db/repositories/toolExecutionsRepo.js';
import { applySchema } from '../src/main/db/schema.js';

function createDatabase(prefix: string) {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
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
  return { raw, database, tempDir };
}

test('ToolExecutionsRepo persists lifecycle state and payload previews', (t) => {
  const { raw, database, tempDir } = createDatabase('atlas-tool-exec-repo-');
  const conversations = new ConversationsRepo(database);
  const toolExecutions = new ToolExecutionsRepo(database);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversation = conversations.create();
  const messageId = conversations.addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: '',
    status: 'streaming',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });

  toolExecutions.save({
    id: 'tool-1',
    conversationId: conversation.id,
    messageId,
    requestId: 'request-1',
    toolName: 'web_search',
    state: 'running',
    inputPreview: '{"query":"atlas"}',
    inputJson: { query: 'atlas' },
    startedAt: '2026-01-01T00:00:00.000Z',
  });

  toolExecutions.save({
    id: 'tool-1',
    conversationId: conversation.id,
    messageId,
    requestId: 'request-1',
    toolName: 'web_search',
    state: 'partial',
    partialOutputPreview: 'Found 3 results',
    outputJson: { partial: true, count: 3 },
  });

  toolExecutions.save({
    id: 'tool-1',
    conversationId: conversation.id,
    messageId,
    requestId: 'request-1',
    toolName: 'web_search',
    state: 'completed',
    finalOutputPreview: 'Found 9 results',
    outputJson: { partial: false, count: 9 },
    finishedAt: '2026-01-01T00:00:01.000Z',
  });

  const record = toolExecutions.getById('tool-1');
  assert.equal(record?.state, 'completed');
  assert.equal(record?.partialOutputPreview, 'Found 3 results');
  assert.equal(record?.finalOutputPreview, 'Found 9 results');
  assert.equal(record?.startedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(record?.finishedAt, '2026-01-01T00:00:01.000Z');

  const payloads = toolExecutions.getJsonPayloadsById('tool-1');
  assert.deepEqual(payloads.input, { query: 'atlas' });
  assert.deepEqual(payloads.output, { partial: false, count: 9 });

  const byMessage = toolExecutions.listByMessageIds([messageId]);
  assert.equal(byMessage.length, 1);
  assert.equal(byMessage[0]?.id, 'tool-1');
});

test('ToolExecutionsRepo marks active runs as errored and reconciles interrupted runs', (t) => {
  const { raw, database, tempDir } = createDatabase('atlas-tool-exec-reconcile-');
  const conversations = new ConversationsRepo(database);
  const toolExecutions = new ToolExecutionsRepo(database);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversation = conversations.create();
  const messageId = conversations.addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: '',
    status: 'streaming',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });

  toolExecutions.save({
    id: 'tool-running',
    conversationId: conversation.id,
    messageId,
    requestId: 'request-active',
    toolName: 'bash',
    state: 'running',
  });
  toolExecutions.save({
    id: 'tool-completed',
    conversationId: conversation.id,
    messageId,
    requestId: 'request-active',
    toolName: 'read_file',
    state: 'completed',
    finishedAt: '2026-01-01T00:00:02.000Z',
  });
  toolExecutions.save({
    id: 'tool-queued',
    conversationId: conversation.id,
    messageId,
    requestId: 'request-queued',
    toolName: 'web_fetch',
    state: 'queued',
  });

  toolExecutions.markRequestExecutionsErrored('request-active', 'timeout', 'Tool timed out');
  assert.equal(toolExecutions.getById('tool-running')?.state, 'error');
  assert.equal(toolExecutions.getById('tool-running')?.errorCode, 'timeout');
  assert.equal(toolExecutions.getById('tool-completed')?.state, 'completed');

  const interruptedMessages = toolExecutions.reconcileActiveExecutions();
  assert.deepEqual(interruptedMessages, [messageId]);
  assert.equal(toolExecutions.getById('tool-queued')?.state, 'error');
  assert.equal(toolExecutions.getById('tool-queued')?.errorCode, 'interrupted');
});
