import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import { AttachmentStore } from '../src/main/attachments/AttachmentStore.js';
import type { SqliteDatabase } from '../src/main/db/client.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { FileChangesRepo } from '../src/main/db/repositories/fileChangesRepo.js';
import { RuntimeStateRepo } from '../src/main/db/repositories/runtimeStateRepo.js';
import { ToolExecutionsRepo } from '../src/main/db/repositories/toolExecutionsRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import type { ChatMessagePart, ChatToolPart } from '../src/shared/contracts.js';

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

type Harness = {
  db: SqliteDatabase;
  raw: DatabaseSync;
  conversations: ConversationsRepo;
  toolExecutions: ToolExecutionsRepo;
  runtimeState: RuntimeStateRepo;
  fileChanges: FileChangesRepo;
  attachments: AttachmentStore;
  attachmentRoot: string;
};

function makeHarness(t: TestContext, label: string): Harness {
  const tempDir = mkdtempSync(join(tmpdir(), `atlas-${label}-`));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const db = wrap(raw);
  applySchema(db);

  const attachmentRoot = join(tempDir, 'attachments');
  const attachments = new AttachmentStore(attachmentRoot);
  const toolExecutions = new ToolExecutionsRepo(db);
  const runtimeState = new RuntimeStateRepo(db);

  return {
    db,
    raw,
    conversations: new ConversationsRepo(db, attachments, toolExecutions, runtimeState),
    toolExecutions,
    runtimeState,
    fileChanges: new FileChangesRepo(db),
    attachments,
    attachmentRoot,
  };
}

function timestamp(index: number) {
  return new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
}

function count(db: SqliteDatabase, table: string, conversationId: string) {
  return (
    db
      .prepare<{ conversationId: string }, { total: number }>(
        `SELECT COUNT(*) AS total FROM ${table} WHERE conversation_id = @conversationId`
      )
      .get({ conversationId })?.total ?? 0
  );
}

/**
 * A conversation with everything a fork has to reason about: two turns, a tool
 * call whose id appears in three places at once, an approval, an event log, a
 * derived activity row, a real attachment on disk, and a file change on the
 * working tree.
 *
 * Returns the ids the assertions need to follow across the copy.
 */
function seedConversation(harness: Harness) {
  const conversation = harness.conversations.create({ workspaceMode: 'code', projectId: null });
  const conversationId = conversation.id;

  const attachmentPart = harness.attachments.persistAttachment(conversationId, {
    type: 'file',
    mediaType: 'text/plain',
    filename: 'notes.txt',
    url: `data:text/plain;base64,${Buffer.from('parent bytes').toString('base64')}`,
  });

  const firstUserMessageId = harness.conversations.addMessage({
    conversationId,
    role: 'user',
    content: 'Look at this file',
    parts: [
      { id: randomUUID(), type: 'text', text: 'Look at this file' },
      attachmentPart,
    ] as ChatMessagePart[],
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: timestamp(0),
  });

  // The tool call id is the tool_executions primary key, the toolCallId inside
  // the assistant message's parts, and the correlation id on the events. If the
  // fork remaps one of those and not the others the transcript comes apart.
  const toolCallId = randomUUID();
  const approvalId = randomUUID();
  const turnId = randomUUID();
  const requestId = randomUUID();

  const assistantMessageId = harness.conversations.addMessage({
    conversationId,
    role: 'assistant',
    content: 'Read it.',
    parts: [
      { id: randomUUID(), type: 'text', text: 'Read it.' },
      {
        id: toolCallId,
        type: 'tool',
        toolCallId,
        requestId,
        toolName: 'read_file',
        state: 'output-available',
        output: 'contents',
        approval: { id: approvalId, approved: true },
      } satisfies ChatToolPart,
    ] as ChatMessagePart[],
    responseMessages: [
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId, toolName: 'read_file', input: { path: 'a.txt' } }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId, toolName: 'read_file', output: { type: 'text', value: 'ok' } }],
      },
    ] as never,
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: timestamp(1),
  });

  harness.runtimeState.createTurn({
    id: turnId,
    conversationId,
    requestId,
    assistantMessageId,
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });

  harness.toolExecutions.save({
    id: toolCallId,
    conversationId,
    messageId: assistantMessageId,
    requestId,
    toolName: 'read_file',
    state: 'completed',
    inputPreview: 'a.txt',
    inputJson: { path: 'a.txt', messageId: assistantMessageId },
    finalOutputPreview: 'contents',
    outputJson: { text: 'contents' },
    requiresApproval: true,
    approvalId,
  });

  harness.runtimeState.recordEvent({
    eventId: randomUUID(),
    conversationId,
    turnId,
    requestId,
    activityType: 'tool.started',
    tone: 'tool',
    toolType: 'file_change',
    messageId: assistantMessageId,
    toolCallId,
    provider: 'openrouter',
    payload: { toolName: 'read_file', toolCallId, relatedMessageId: assistantMessageId },
  });

  harness.runtimeState.recordEvent({
    eventId: randomUUID(),
    conversationId,
    turnId,
    requestId,
    activityType: 'approval.requested',
    tone: 'approval',
    messageId: assistantMessageId,
    toolCallId,
    approvalId,
    provider: 'openrouter',
    payload: { toolName: 'read_file', reason: 'writes a file' },
  });

  harness.runtimeState.recordEvent({
    eventId: randomUUID(),
    conversationId,
    turnId,
    requestId,
    activityType: 'tool.completed',
    tone: 'tool',
    toolType: 'file_change',
    messageId: assistantMessageId,
    toolCallId,
    provider: 'openrouter',
    payload: { toolName: 'read_file', status: 'completed' },
  });

  harness.runtimeState.createCheckpoint({
    conversationId,
    turnId,
    sequence: harness.runtimeState.getLastSequence(conversationId),
    pendingApprovals: [],
  });

  harness.fileChanges.create({
    conversationId,
    filePath: '/repo/a.txt',
    beforeContent: 'before',
    afterContent: 'after',
    diffText: '--- a\n+++ b\n-before\n+after\n',
    toolCallId,
  });

  // A second exchange, entirely after the mid-point cut used below.
  const laterUserMessageId = harness.conversations.addMessage({
    conversationId,
    role: 'user',
    content: 'And now something else',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: timestamp(2),
  });

  const laterTurnId = randomUUID();
  const laterRequestId = randomUUID();
  const laterAssistantMessageId = harness.conversations.addMessage({
    conversationId,
    role: 'assistant',
    content: 'Sure, later reply',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: timestamp(3),
  });

  harness.runtimeState.createTurn({
    id: laterTurnId,
    conversationId,
    requestId: laterRequestId,
    assistantMessageId: laterAssistantMessageId,
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });

  harness.runtimeState.recordEvent({
    eventId: randomUUID(),
    conversationId,
    turnId: laterTurnId,
    requestId: laterRequestId,
    activityType: 'message.completed',
    tone: 'info',
    messageId: laterAssistantMessageId,
    provider: 'openrouter',
    payload: {},
  });

  return {
    conversationId,
    firstUserMessageId,
    assistantMessageId,
    laterUserMessageId,
    laterAssistantMessageId,
    toolCallId,
    approvalId,
    turnId,
    requestId,
    attachmentStorageKey: attachmentPart.storageKey!,
  };
}

test('a fork is a copy, not a reference: mutating either side leaves the other alone', (t) => {
  const harness = makeHarness(t, 'fork-independence');
  const seed = seedConversation(harness);

  const fork = harness.conversations.fork({ conversationId: seed.conversationId });

  assert.notEqual(fork.id, seed.conversationId);
  assert.equal(fork.forkOfConversationId, seed.conversationId, 'the fork records where it came from');
  assert.equal(fork.sideOfConversationId, null, 'an ordinary fork is nobody‘s tangent');

  const parentBefore = harness.conversations.get(seed.conversationId);
  const forkBefore = harness.conversations.get(fork.id);
  assert.equal(forkBefore.messages.length, parentBefore.messages.length);
  assert.deepEqual(
    forkBefore.messages.map((message) => message.content),
    parentBefore.messages.map((message) => message.content),
    'the fork opens on the same transcript'
  );

  // Every copied message must be a new row. A shared id would mean the two
  // conversations are one conversation with two names.
  const parentIds = new Set(parentBefore.messages.map((message) => message.id));
  for (const message of forkBefore.messages) {
    assert.ok(!parentIds.has(message.id), `forked message ${message.id} reused a parent id`);
    assert.equal(message.conversationId, fork.id);
  }

  // Writing to the fork.
  harness.conversations.addMessage({
    conversationId: fork.id,
    role: 'user',
    content: 'only in the fork',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: timestamp(10),
  });
  harness.conversations.rename(fork.id, 'Renamed fork');

  // Writing to the parent.
  harness.conversations.addMessage({
    conversationId: seed.conversationId,
    role: 'user',
    content: 'only in the parent',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: timestamp(11),
  });

  const parentAfter = harness.conversations.get(seed.conversationId);
  const forkAfter = harness.conversations.get(fork.id);

  assert.equal(parentAfter.messages.length, parentBefore.messages.length + 1);
  assert.equal(forkAfter.messages.length, forkBefore.messages.length + 1);
  assert.ok(!parentAfter.messages.some((m) => m.content === 'only in the fork'));
  assert.ok(!forkAfter.messages.some((m) => m.content === 'only in the parent'));
  assert.equal(harness.conversations.getSummary(seed.conversationId)?.title, parentBefore.conversation.title);
  assert.equal(harness.conversations.getSummary(fork.id)?.title, 'Renamed fork');

  // And deleting the parent outright must not take the fork with it: the FK is
  // SET NULL, which is the difference between a fork and a side conversation.
  harness.conversations.delete(seed.conversationId);
  const survivor = harness.conversations.getSummary(fork.id);
  assert.ok(survivor, 'the fork survives its parent');
  assert.equal(survivor.forkOfConversationId, null, 'it just stops being able to say where it came from');
  assert.equal(harness.conversations.get(fork.id).messages.length, forkAfter.messages.length);
});

test('id remapping keeps every intra-conversation reference pointing inside the fork', (t) => {
  const harness = makeHarness(t, 'fork-remapping');
  const seed = seedConversation(harness);

  const fork = harness.conversations.fork({ conversationId: seed.conversationId });

  const forkMessages = harness.conversations.get(fork.id).messages;
  const forkAssistant = forkMessages.find((message) => message.role === 'assistant');
  assert.ok(forkAssistant, 'the assistant message was copied');

  // tool_executions.message_id is a real foreign key; it has to land on the
  // fork's own message row.
  const forkToolRows = harness.db
    .prepare<{ conversationId: string }, { id: string; message_id: string; approval_id: string | null }>(
      'SELECT id, message_id, approval_id FROM tool_executions WHERE conversation_id = @conversationId'
    )
    .all({ conversationId: fork.id });

  assert.equal(forkToolRows.length, 1);
  const forkToolRow = forkToolRows[0]!;
  assert.equal(forkToolRow.message_id, forkAssistant.id, 'the tool execution points at the forked message');
  assert.notEqual(forkToolRow.id, seed.toolCallId, 'the tool call id was reminted');
  assert.notEqual(forkToolRow.approval_id, seed.approvalId, 'the approval id was reminted');

  // The same new id must appear in parts_json, or the transcript renders a tool
  // cell that no execution and no activity will ever fill.
  const toolPart = forkAssistant.parts.find(
    (part): part is ChatToolPart => part.type === 'tool'
  );
  assert.ok(toolPart, 'the forked message still has its tool part');
  assert.equal(toolPart.toolCallId, forkToolRow.id, 'parts_json agrees with tool_executions');
  assert.equal(toolPart.approval?.id, forkToolRow.approval_id);

  // ...and in the event log and the derived activity row.
  const forkEvents = harness.db
    .prepare<{ conversationId: string }, { tool_call_id: string | null; message_id: string | null; turn_id: string }>(
      'SELECT tool_call_id, message_id, turn_id FROM conversation_events WHERE conversation_id = @conversationId AND tool_call_id IS NOT NULL'
    )
    .all({ conversationId: fork.id });
  assert.ok(forkEvents.length > 0);
  for (const event of forkEvents) {
    assert.equal(event.tool_call_id, forkToolRow.id);
    assert.equal(event.message_id, forkAssistant.id);
    assert.notEqual(event.turn_id, seed.turnId, 'turn ids are reminted too');
  }

  const forkActivities = harness.runtimeState.listActivitiesByConversation(fork.id);
  assert.ok(forkActivities.length > 0, 'activities were copied');
  for (const activity of forkActivities) {
    assert.equal(activity.messageId, forkAssistant.id);
    if (activity.toolCallId != null) {
      assert.equal(activity.toolCallId, forkToolRow.id);
    }
    if (activity.approvalId != null) {
      assert.equal(activity.approvalId, forkToolRow.approval_id);
    }
  }

  // conversation_activities.id is derived — `tool:<toolCallId>` and
  // `approval:<approvalId>` — so the derived form has to survive the copy, or
  // the invariant getWorkLogEntryId relies on is quietly false in the fork.
  const activityIds = new Set(forkActivities.map((activity) => activity.id));
  assert.ok(activityIds.has(`tool:${forkToolRow.id}`), 'the tool activity kept its derived id');
  assert.ok(activityIds.has(`approval:${forkToolRow.approval_id}`), 'and so did the approval activity');

  // Nothing in the fork may still name a row belonging to the parent.
  const forkRowsAsJson = JSON.stringify([
    harness.conversations.get(fork.id),
    forkActivities,
    forkToolRows,
    harness.conversations.getModelHistory(fork.id),
  ]);
  for (const staleId of [seed.toolCallId, seed.approvalId, seed.turnId, seed.assistantMessageId, seed.firstUserMessageId]) {
    assert.ok(!forkRowsAsJson.includes(staleId), `the fork still mentions the parent's ${staleId}`);
  }

  // The rewritten history must still be internally consistent: the tool-call
  // and the tool-result it pairs with have to carry the same (new) id.
  const history = harness.conversations.getModelHistory(fork.id) as Array<{
    role: string;
    content: unknown;
  }>;
  const ids = new Set<string>();
  for (const entry of history) {
    if (!Array.isArray(entry.content)) {
      continue;
    }
    for (const part of entry.content as Array<Record<string, unknown>>) {
      if (typeof part.toolCallId === 'string') {
        ids.add(part.toolCallId);
      }
    }
  }
  assert.deepEqual([...ids], [forkToolRow.id], 'the replayed history pairs on one id, and it is the fork‘s');
});

test('forking through a message excludes everything after it', (t) => {
  const harness = makeHarness(t, 'fork-midpoint');
  const seed = seedConversation(harness);

  const fork = harness.conversations.fork({
    conversationId: seed.conversationId,
    throughMessageId: seed.assistantMessageId,
  });

  const forkMessages = harness.conversations.get(fork.id).messages;
  assert.deepEqual(
    forkMessages.map((message) => message.content),
    ['Look at this file', 'Read it.'],
    'the cut is inclusive of the chosen message and excludes the later exchange'
  );

  // The event log is cut with it, and the watermark is the newest event the
  // chosen message produced — not the parent's newest.
  const parentLast = harness.runtimeState.getLastSequence(seed.conversationId);
  const forkLast = harness.runtimeState.getLastSequence(fork.id);
  assert.equal(parentLast, 4, 'the parent logged four events across both turns');
  assert.equal(forkLast, 3, 'the fork stops at the third');
  assert.equal(fork.forkPointSequence, 3);

  // Sequences are carried over rather than renumbered, so the fork's next turn
  // continues the history instead of landing in the middle of it.
  const forkSequences = harness.runtimeState
    .listActivitiesByConversation(fork.id)
    .map((activity) => activity.sequence);
  assert.ok(Math.max(...forkSequences) <= forkLast);

  harness.runtimeState.createTurn({
    id: randomUUID(),
    conversationId: fork.id,
    requestId: randomUUID(),
    assistantMessageId: forkMessages.at(-1)!.id,
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });
  const next = harness.runtimeState.recordEvent({
    eventId: randomUUID(),
    conversationId: fork.id,
    turnId: randomUUID(),
    requestId: randomUUID(),
    activityType: 'turn.started',
    tone: 'info',
    provider: 'openrouter',
    payload: {},
  });
  assert.equal(next.sequence, forkLast + 1, 'a new turn continues the numbering');

  // Forking the whole conversation takes the whole log.
  const whole = harness.conversations.fork({ conversationId: seed.conversationId });
  assert.equal(harness.runtimeState.getLastSequence(whole.id), parentLast);
  assert.equal(whole.forkPointSequence, parentLast);
});

test('a fork copies the conversation, never the effects it had on the world', (t) => {
  const harness = makeHarness(t, 'fork-effects');
  const seed = seedConversation(harness);

  // Make the parent carry a pending approval and a live provider session, the
  // two things a fork must never inherit.
  harness.runtimeState.startProviderSession({
    conversationId: seed.conversationId,
    turnId: seed.turnId,
    requestId: seed.requestId,
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });
  assert.equal(harness.runtimeState.listPendingApprovals(seed.conversationId).length, 1);

  const fork = harness.conversations.fork({ conversationId: seed.conversationId });

  assert.equal(count(harness.db, 'file_changes', fork.id), 0, 'a fork does not claim edits it did not make');
  assert.equal(count(harness.db, 'file_changes', seed.conversationId), 1, 'and the parent keeps its own');
  assert.deepEqual(fork.changeStats, { fileCount: 0, linesAdded: 0, linesRemoved: 0 });

  assert.equal(count(harness.db, 'approval_requests', fork.id), 0, 'no inherited approval prompts');
  assert.equal(harness.runtimeState.listPendingApprovals(fork.id).length, 0);
  assert.equal(count(harness.db, 'provider_sessions', fork.id), 0, 'no inherited provider session');
  assert.equal(count(harness.db, 'conversation_checkpoints', fork.id), 0, 'no inherited crash watermark');
  assert.equal(count(harness.db, 'terminal_history', fork.id), 0);

  // The parent's live rows are untouched by the fork.
  assert.equal(harness.runtimeState.listPendingApprovals(seed.conversationId).length, 1);
  assert.ok(harness.runtimeState.getProviderSessionByRequest(seed.requestId));
  assert.equal(harness.runtimeState.getLatestCheckpoint(seed.conversationId)?.conversationId, seed.conversationId);

  // Workspace binding does follow: history full of repo paths in a conversation
  // with no repo is history that means nothing.
  const parentSummary = harness.conversations.getSummary(seed.conversationId)!;
  assert.equal(fork.workspaceMode, parentSummary.workspaceMode);
  assert.equal(fork.projectId, parentSummary.projectId);
  assert.equal(fork.toolPermissionMode, parentSummary.toolPermissionMode);

  // Filing decisions do not.
  harness.conversations.setPinned(seed.conversationId, true);
  harness.conversations.setArchived(seed.conversationId, true);
  const secondFork = harness.conversations.fork({ conversationId: seed.conversationId });
  assert.equal(secondFork.pinnedAt, null);
  assert.equal(secondFork.archivedAt, null);
});

test('forked attachments are copies on disk, so deleting the parent cannot break them', (t) => {
  const harness = makeHarness(t, 'fork-attachments');
  const seed = seedConversation(harness);

  const fork = harness.conversations.fork({ conversationId: seed.conversationId });

  const forkFilePart = harness.conversations
    .get(fork.id)
    .messages.flatMap((message) => message.parts)
    .find((part) => part.type === 'file');

  assert.ok(forkFilePart && forkFilePart.type === 'file');
  assert.ok(forkFilePart.storageKey);
  assert.notEqual(forkFilePart.storageKey, seed.attachmentStorageKey, 'the blob was re-keyed under the fork');
  assert.ok(forkFilePart.storageKey.startsWith(`${fork.id}/`), 'and it lives in the fork‘s own directory');
  assert.ok(forkFilePart.url.includes(encodeURIComponent(fork.id)));

  assert.equal(harness.attachments.readAttachmentData(forkFilePart.storageKey)?.toString(), 'parent bytes');

  // `deleteConversationAttachments` removes the parent's whole directory. This
  // is the case that made sharing keys wrong.
  harness.conversations.delete(seed.conversationId);

  assert.ok(!existsSync(join(harness.attachmentRoot, seed.conversationId)));
  assert.equal(
    harness.attachments.readAttachmentData(forkFilePart.storageKey)?.toString(),
    'parent bytes',
    'the fork‘s copy outlives the parent'
  );
  assert.equal(readFileSync(join(harness.attachmentRoot, forkFilePart.storageKey), 'utf8'), 'parent bytes');
});

test('a side conversation is hidden from every listing and dies with its parent', (t) => {
  const harness = makeHarness(t, 'fork-side');
  const seed = seedConversation(harness);

  const side = harness.conversations.fork({ conversationId: seed.conversationId, kind: 'side' });

  assert.equal(side.sideOfConversationId, seed.conversationId);
  assert.equal(side.forkOfConversationId, seed.conversationId, 'a side conversation is still a fork');
  assert.ok(side.title.endsWith('(side)'));

  const listed = harness.conversations.list().map((row) => row.id);
  assert.ok(listed.includes(seed.conversationId));
  assert.ok(!listed.includes(side.id), 'a tangent leaves no trace in the chat list');

  const archivedView = harness.conversations.list({ includeArchived: true }).map((row) => row.id);
  assert.ok(!archivedView.includes(side.id), 'nor in the archived view');

  assert.ok(harness.conversations.list({ includeSide: true }).some((row) => row.id === side.id));
  assert.deepEqual(
    harness.conversations.listSideConversations(seed.conversationId).map((row) => row.id),
    [side.id],
    'the only way to reach it is through the chat it hangs off'
  );

  // It is still a real conversation by id, so the app can open it.
  assert.ok(harness.conversations.getSummary(side.id));
  assert.equal(harness.conversations.get(side.id).messages.length, 4);

  // ...and it is not searchable, which is the other half of "does not pollute
  // the main thread".
  harness.conversations.addMessage({
    conversationId: side.id,
    role: 'user',
    content: 'zzyzxunique tangent text',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: timestamp(20),
  });
  harness.conversations.addMessage({
    conversationId: seed.conversationId,
    role: 'user',
    content: 'zzyzxunique main text',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: timestamp(21),
  });

  const hits = harness.conversations.searchMessages({ query: 'zzyzxunique' });
  assert.deepEqual(
    [...new Set(hits.map((hit) => hit.conversationId))],
    [seed.conversationId],
    'search finds the main thread and not the tangent'
  );

  // Tangents cannot nest.
  assert.throws(() => harness.conversations.fork({ conversationId: side.id, kind: 'side' }));
  // But a tangent that turned out to matter can be forked into a real chat.
  const promoted = harness.conversations.fork({ conversationId: side.id });
  assert.equal(promoted.sideOfConversationId, null);
  assert.ok(harness.conversations.list().some((row) => row.id === promoted.id));

  // Deleting the parent takes the tangent — and leaves the promoted fork.
  harness.conversations.delete(seed.conversationId);
  assert.equal(harness.conversations.getSummary(side.id), null, 'the tangent goes with its parent');
  assert.ok(harness.conversations.getSummary(promoted.id), 'the promoted fork does not');
});

test('a streaming message is not forked, because nothing in the fork can finish it', (t) => {
  const harness = makeHarness(t, 'fork-streaming');
  const conversation = harness.conversations.create();

  harness.conversations.addMessage({
    conversationId: conversation.id,
    role: 'user',
    content: 'question',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: timestamp(0),
  });
  harness.conversations.addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: 'half an ans',
    status: 'streaming',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: timestamp(1),
  });

  const fork = harness.conversations.fork({ conversationId: conversation.id });
  assert.deepEqual(
    harness.conversations.get(fork.id).messages.map((message) => message.status),
    ['complete']
  );
  assert.equal(fork.status, 'idle', 'and the fork is not born mid-run');

  // Forking an empty conversation is legal and yields an empty one.
  const empty = harness.conversations.create();
  const emptyFork = harness.conversations.fork({ conversationId: empty.id });
  assert.equal(harness.conversations.get(emptyFork.id).messages.length, 0);
  assert.equal(emptyFork.forkPointSequence, null);

  assert.throws(() => harness.conversations.fork({ conversationId: 'no-such-conversation' }));
  assert.throws(() =>
    harness.conversations.fork({ conversationId: conversation.id, throughMessageId: 'not-in-this-chat' })
  );
});

test('the fork columns migrate onto a database that already has conversations in it', (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-fork-migration-'));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const db = wrap(raw);

  // Stand up the shape a shipped build left behind: the conversations table
  // without any of the three new columns, holding real rows.
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      default_provider_id TEXT,
      default_model_id TEXT,
      title_auto INTEGER NOT NULL DEFAULT 0,
      pinned_at TEXT,
      archived_at TEXT
    );
    -- The messages table as an older build left it: without the four columns
    -- the existing migration block adds, so this exercises the new migration
    -- running alongside them rather than on a table already brought up to date.
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_id TEXT,
      model_id TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      latency_ms INTEGER,
      error_code TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO conversations (id, title, created_at, updated_at)
    VALUES ('legacy-1', 'Existing chat', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO messages (id, conversation_id, role, content, status, created_at)
    VALUES ('legacy-message-1', 'legacy-1', 'user', 'existing words', 'complete', '2026-01-01T00:00:00.000Z');
  `);

  applySchema(db);

  const columns = db
    .prepare<[], { name: string }>('PRAGMA table_info(conversations)')
    .all()
    .map((column) => column.name);

  for (const added of ['fork_of_conversation_id', 'fork_point_sequence', 'side_of_conversation_id']) {
    assert.ok(columns.includes(added), `${added} was added`);
  }

  const conversations = new ConversationsRepo(db);

  // The pre-existing row survives, reads back as an ordinary chat, and is still
  // listed and searchable.
  const legacy = conversations.getSummary('legacy-1');
  assert.ok(legacy);
  assert.equal(legacy.title, 'Existing chat');
  assert.equal(legacy.forkOfConversationId, null);
  assert.equal(legacy.forkPointSequence, null);
  assert.equal(legacy.sideOfConversationId, null);
  assert.deepEqual(conversations.list().map((row) => row.id), ['legacy-1']);
  assert.equal(conversations.searchMessages({ query: 'existing' }).length, 1);

  // And it can be forked, which is the point of the migration.
  const fork = conversations.fork({ conversationId: 'legacy-1' });
  assert.equal(fork.forkOfConversationId, 'legacy-1');
  assert.deepEqual(
    conversations.get(fork.id).messages.map((message) => message.content),
    ['existing words']
  );

  // Re-running it is a no-op, the way every other migration in this file is.
  applySchema(db);
  assert.equal(conversations.getSummary('legacy-1')?.title, 'Existing chat');
  assert.equal(conversations.list().length, 2);
});
