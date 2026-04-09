import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { RuntimeStateRepo } from '../src/main/db/repositories/runtimeStateRepo.js';
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

test('RuntimeStateRepo records canonical events, collapses tool activity, and serves replay reads', (t) => {
  const { raw, database, tempDir } = createDatabase('atlas-runtime-state-');
  const conversations = new ConversationsRepo(database);
  const runtimeState = new RuntimeStateRepo(database);

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

  runtimeState.createTurn({
    id: 'turn-1',
    conversationId: conversation.id,
    requestId: 'request-1',
    assistantMessageId: messageId,
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });
  runtimeState.startProviderSession({
    id: 'session-1',
    conversationId: conversation.id,
    turnId: 'turn-1',
    requestId: 'request-1',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });

  const started = runtimeState.recordEvent({
    eventId: 'event-1',
    conversationId: conversation.id,
    turnId: 'turn-1',
    requestId: 'request-1',
    activityType: 'tool.started',
    tone: 'tool',
    toolType: 'web_search',
    toolCallId: 'tool-1',
    messageId,
    provider: 'openrouter',
    providerEventType: 'tool-input-start',
    payload: {
      toolName: 'search',
      title: 'Search',
    },
  });

  const updated = runtimeState.recordEvent({
    eventId: 'event-2',
    conversationId: conversation.id,
    turnId: 'turn-1',
    requestId: 'request-1',
    activityType: 'tool.updated',
    tone: 'tool',
    toolType: 'web_search',
    toolCallId: 'tool-1',
    messageId,
    provider: 'openrouter',
    providerEventType: 'tool-output-available',
    payload: {
      toolName: 'search',
      summary: 'Found 3 results',
      output: 'Found 3 results',
    },
  });

  runtimeState.recordEvent({
    eventId: 'event-3',
    conversationId: conversation.id,
    turnId: 'turn-1',
    requestId: 'request-1',
    activityType: 'approval.requested',
    tone: 'approval',
    toolType: 'web_search',
    toolCallId: 'tool-1',
    approvalId: 'approval-1',
    messageId,
    provider: 'openrouter',
    providerEventType: 'tool-approval-requested',
    payload: {
      toolName: 'search',
      reason: 'Needs network access',
      sessionScopeKey: 'web_search:search',
    },
  });

  runtimeState.recordEvent({
    eventId: 'event-4',
    conversationId: conversation.id,
    turnId: 'turn-1',
    requestId: 'request-1',
    activityType: 'approval.resolved',
    tone: 'approval',
    toolType: 'web_search',
    toolCallId: 'tool-1',
    approvalId: 'approval-1',
    messageId,
    provider: 'openrouter',
    providerEventType: 'tool-approval-responded',
    payload: {
      decision: 'accept_for_session',
      sessionScopeKey: 'web_search:search',
    },
  });

  runtimeState.recordEvent({
    eventId: 'event-5',
    conversationId: conversation.id,
    turnId: 'turn-1',
    requestId: 'request-1',
    activityType: 'tool.completed',
    tone: 'tool',
    toolType: 'web_search',
    toolCallId: 'tool-1',
    messageId,
    provider: 'openrouter',
    providerEventType: 'tool-output-available',
    payload: {
      toolName: 'search',
      status: 'completed',
      summary: 'Found 9 results',
      output: 'Found 9 results',
    },
  });

  assert.equal(started.sequence, 1);
  assert.equal(updated.sequence, 2);
  assert.equal(runtimeState.getLastSequence(conversation.id), 5);

  const byMessage = runtimeState.listActivitiesByMessageIds([messageId]);
  assert.equal(byMessage.length, 2);
  const toolActivity = byMessage.find((activity) => activity.toolCallId === 'tool-1' && activity.activityType.startsWith('tool.'));
  const approvalActivity = byMessage.find((activity) => activity.approvalId === 'approval-1');
  assert.equal(toolActivity?.status, 'completed');
  assert.equal(toolActivity?.summary, 'Found 9 results');
  assert.equal(approvalActivity?.status, 'resolved');

  const pendingApprovals = runtimeState.listPendingApprovals(conversation.id);
  assert.equal(pendingApprovals.length, 0);
  assert.equal(runtimeState.getApprovalById('approval-1')?.decision, 'accept_for_session');

  const replay = runtimeState.listEventsAfter(conversation.id, 2);
  assert.deepEqual(replay.events.map((event) => event.eventId), ['event-3', 'event-4', 'event-5']);
  assert.equal(replay.lastSequence, 5);
});

test('RuntimeStateRepo marks active sessions interrupted and pending approvals stale during recovery', (t) => {
  const { raw, database, tempDir } = createDatabase('atlas-runtime-recovery-');
  const conversations = new ConversationsRepo(database);
  const runtimeState = new RuntimeStateRepo(database);

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

  runtimeState.createTurn({
    id: 'turn-recovery',
    conversationId: conversation.id,
    requestId: 'request-recovery',
    assistantMessageId: messageId,
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });
  runtimeState.startProviderSession({
    id: 'session-recovery',
    conversationId: conversation.id,
    turnId: 'turn-recovery',
    requestId: 'request-recovery',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });
  runtimeState.recordEvent({
    eventId: 'event-recovery',
    conversationId: conversation.id,
    turnId: 'turn-recovery',
    requestId: 'request-recovery',
    activityType: 'approval.requested',
    tone: 'approval',
    toolType: 'command_execution',
    toolCallId: 'tool-recovery',
    approvalId: 'approval-recovery',
    messageId,
    provider: 'openrouter',
    providerEventType: 'tool-approval-requested',
    payload: {
      toolName: 'bash',
      reason: 'Needs shell access',
      sessionScopeKey: 'command_execution:bash',
    },
  });

  const interrupted = runtimeState.reconcileInterruptedSessions();
  assert.deepEqual(interrupted, [{ requestId: 'request-recovery', assistantMessageId: messageId }]);
  assert.equal(runtimeState.getLatestProviderSession(conversation.id)?.status, 'interrupted');
  assert.equal(runtimeState.getApprovalById('approval-recovery')?.status, 'stale');
});
