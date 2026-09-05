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

test('RuntimeStateRepo upserts task.* events onto one row and stamps agentKind once at record time', (t) => {
  const { raw, database, tempDir } = createDatabase('atlas-runtime-tasks-');
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
    id: 'turn-task',
    conversationId: conversation.id,
    requestId: 'request-task',
    assistantMessageId: messageId,
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });
  runtimeState.startProviderSession({
    id: 'session-task',
    conversationId: conversation.id,
    turnId: 'turn-task',
    requestId: 'request-task',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });

  // Not in the denylist, so the boundary classifies it as a real agent, not
  // internal background plumbing.
  runtimeState.recordEvent({
    eventId: 'task-event-1',
    conversationId: conversation.id,
    turnId: 'turn-task',
    requestId: 'request-task',
    activityType: 'task.started',
    tone: 'info',
    provider: 'system',
    payload: { taskId: 'task-abc', taskType: 'subagent', title: 'Investigate flaky test' },
  });

  runtimeState.recordEvent({
    eventId: 'task-event-2',
    conversationId: conversation.id,
    turnId: 'turn-task',
    requestId: 'request-task',
    activityType: 'task.progress',
    tone: 'info',
    provider: 'system',
    payload: { taskId: 'task-abc', summary: 'Reproducing', usage: { totalTokens: 500, inputTokens: 300 } },
  });

  runtimeState.recordEvent({
    eventId: 'task-event-3',
    conversationId: conversation.id,
    turnId: 'turn-task',
    requestId: 'request-task',
    activityType: 'task.completed',
    tone: 'info',
    provider: 'system',
    payload: { taskId: 'task-abc', status: 'completed', usage: { totalTokens: 900 } },
  });

  const activities = runtimeState.listActivitiesByConversation(conversation.id);
  assert.equal(activities.length, 1);

  const taskRow = activities[0];
  assert.equal(taskRow.id, 'task:task-abc');
  assert.equal(taskRow.status, 'completed');
  assert.equal(taskRow.isFinal, true);
  assert.equal(taskRow.title, 'Investigate flaky test');
  assert.equal(taskRow.payload?.agentKind, 'agent');

  // Usage merges across ticks and survives the round-trip through
  // `payload_json` — `inputTokens` from tick 2 is still there even though
  // the terminal tick only reported `totalTokens`.
  const usage = taskRow.payload?.usage as { totalTokens: number; inputTokens?: number } | undefined;
  assert.equal(usage?.totalTokens, 900);
  assert.equal(usage?.inputTokens, 300);
});

// ---------------------------------------------------------------------------
// Sequence watermark tracking
//
// `recordEvent` derives each event's sequence from an in-memory per-conversation
// watermark instead of a `MAX(sequence)` query per event. These tests pin the
// three ways that could silently corrupt the log: sequences drifting from the
// table, a restart colliding with existing rows, and a delete leaving a stale
// watermark behind.
// ---------------------------------------------------------------------------

const MINIMAL_EVENT = {
  turnId: 'turn-seq',
  requestId: 'request-seq',
  activityType: 'message.delta' as const,
  tone: 'info' as const,
  provider: 'system' as const,
  payload: {},
};

test('recorded sequences are consecutive per conversation and unique across conversations', (t) => {
  const { raw, database, tempDir } = createDatabase('atlas-runtime-seq-');
  const conversations = new ConversationsRepo(database);
  const runtimeState = new RuntimeStateRepo(database);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversationA = conversations.create();
  const conversationB = conversations.create();

  for (let index = 1; index <= 5; index += 1) {
    const envelope = runtimeState.recordEvent({
      ...MINIMAL_EVENT,
      eventId: `a-${index}`,
      conversationId: conversationA.id,
    });
    assert.equal(envelope.sequence, index);
  }

  // A second conversation starts at its own watermark, not the other's.
  const envelopeB = runtimeState.recordEvent({
    ...MINIMAL_EVENT,
    eventId: 'b-1',
    conversationId: conversationB.id,
  });
  assert.equal(envelopeB.sequence, 1);

  // And the table agrees with the tracker.
  assert.equal(runtimeState.getLastSequence(conversationA.id), 5);
  assert.equal(runtimeState.getLastSequence(conversationB.id), 1);
});

test('a fresh repo instance recovers the watermark from SQLite (restart safety)', (t) => {
  const { raw, database, tempDir } = createDatabase('atlas-runtime-restart-');
  const conversations = new ConversationsRepo(database);
  const runtimeState = new RuntimeStateRepo(database);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversation = conversations.create();
  for (let index = 1; index <= 4; index += 1) {
    runtimeState.recordEvent({
      ...MINIMAL_EVENT,
      eventId: `pre-${index}`,
      conversationId: conversation.id,
    });
  }

  // Simulate a restart: same database, brand-new repo (empty tracker).
  const restarted = new RuntimeStateRepo(database);
  assert.equal(restarted.getLastSequence(conversation.id), 4);

  const envelope = restarted.recordEvent({
    ...MINIMAL_EVENT,
    eventId: 'post-restart',
    conversationId: conversation.id,
  });
  assert.equal(envelope.sequence, 5);
});

test('rows inserted out-of-band (a fork copy) are picked up by the watermark', (t) => {
  const { raw, database, tempDir } = createDatabase('atlas-runtime-fork-');
  const conversations = new ConversationsRepo(database);
  const runtimeState = new RuntimeStateRepo(database);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // A fork copies event rows with their sequences preserved, directly through
  // the database, before the forked conversation ever records a new event.
  const forked = conversations.create();
  const insertRaw = raw.prepare(
    `INSERT INTO conversation_events (
       event_id, conversation_id, turn_id, request_id, sequence, occurred_at,
       activity_type, tone, tool_type, message_id, tool_call_id, approval_id,
       provider_id, provider_event_type, payload_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const sequence of [1, 2, 3]) {
    insertRaw.run(
      `fork-${sequence}`,
      forked.id,
      'turn-fork',
      'request-fork',
      sequence,
      new Date().toISOString(),
      'message.delta',
      'info',
      null,
      null,
      null,
      null,
      'system',
      'chunk',
      '{}',
    );
  }

  // The first new event on the fork must continue AFTER the copied rows, not
  // collide with them (the unique index on (conversation_id, sequence) would
  // reject a collision and abort the turn).
  const envelope = runtimeState.recordEvent({
    ...MINIMAL_EVENT,
    eventId: 'fork-new',
    conversationId: forked.id,
  });
  assert.equal(envelope.sequence, 4);
});

test('forgetting a conversation re-derives its watermark from the table', (t) => {
  const { raw, database, tempDir } = createDatabase('atlas-runtime-forget-');
  const conversations = new ConversationsRepo(database);
  const runtimeState = new RuntimeStateRepo(database);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const conversation = conversations.create();
  for (let index = 1; index <= 3; index += 1) {
    runtimeState.recordEvent({
      ...MINIMAL_EVENT,
      eventId: `f-${index}`,
      conversationId: conversation.id,
    });
  }
  assert.equal(runtimeState.getLastSequence(conversation.id), 3);

  // Rows gone (conversation deletion cascades here). A stale watermark would
  // make the next event for this id resume at 4 instead of restarting.
  raw.exec(`DELETE FROM conversation_events WHERE conversation_id = '${conversation.id}'`);
  runtimeState.forgetConversationEvents(conversation.id);
  assert.equal(runtimeState.getLastSequence(conversation.id), 0);
});

