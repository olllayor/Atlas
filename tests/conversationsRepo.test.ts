import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { AttachmentStore, buildAttachmentUrl } from '../src/main/attachments/AttachmentStore.js';
import { ToolExecutionTracker } from '../src/main/ai/tools/ToolExecutionTracker.js';
import { ToolStateStore } from '../src/main/ai/tools/ToolStateStore.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { ToolExecutionsRepo } from '../src/main/db/repositories/toolExecutionsRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import { decodeConversationPageCursor } from '../src/shared/conversationPaging.js';
import type { ChatToolPart } from '../src/shared/contracts.js';
import { derivePlanView, type PlanToolInput } from '../src/shared/planTool.js';

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

  const pdfAttachment = attachmentStore.persistAttachment(conversation.id, {
    type: 'file',
    filename: 'report.pdf',
    mediaType: 'application/pdf',
    sizeBytes: 5,
    url: 'data:application/pdf;base64,aGVsbG8=',
  });

  conversations.addMessage({
    conversationId: conversation.id,
    role: 'user',
    content: 'Attachment',
    parts: [pdfAttachment],
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: createTimestamp(1),
  });

  const history = conversations.getModelHistory(conversation.id);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.role, 'user');
  assert.ok(Array.isArray(history[0]?.content));

  // A text file is inlined as prompt text: it needs no document capability, and
  // several endpoints reject a `text/*` file part outright.
  const [textPart] = history[0]!.content as Array<{ type: 'text'; text: string }>;
  assert.equal(textPart?.type, 'text');
  assert.match(textPart.text, /note\.txt/);
  assert.match(textPart.text, /hello/);

  // Anything that has to stay binary still travels as a file part.
  const [filePart] = history[1]!.content as Array<{
    type: 'file';
    filename?: string;
    mediaType: string;
    data: Uint8Array;
  }>;
  assert.equal(filePart?.type, 'file');
  assert.equal(filePart?.filename, 'report.pdf');
  assert.equal(filePart?.mediaType, 'application/pdf');
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

test('rename records whether a title was machine-generated', (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-conversations-titles-'));
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

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  applySchema(database);
  const repo = new ConversationsRepo(database, new AttachmentStore(tempDir), new ToolExecutionsRepo(database));

  const conversation = repo.create();
  const initial = repo.getTitleState(conversation.id);
  assert.ok(initial?.title.startsWith('Session · '), 'new conversations start on the placeholder');
  assert.equal(initial?.auto, false);

  repo.rename(conversation.id, 'Auto generated name', { auto: true });
  assert.deepEqual(repo.getTitleState(conversation.id), { title: 'Auto generated name', auto: true });

  // A user rename (no options) makes the title final.
  repo.rename(conversation.id, 'Human chosen name');
  assert.deepEqual(repo.getTitleState(conversation.id), { title: 'Human chosen name', auto: false });

  assert.equal(repo.getTitleState('missing-conversation'), null);
});

test('stored attachments reach the renderer over the attachment scheme, not file://', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-attachment-url-'));

  try {
    const store = new AttachmentStore(join(tempDir, 'attachments'));
    const part = store.persistAttachment('conv-1', {
      type: 'file',
      mediaType: 'image/png',
      filename: 'lunch.png',
      // 1×1 transparent PNG.
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    });

    // A file:// URL is what the renderer's CSP refuses, which is why stored
    // images used to render as a bare filename.
    assert.ok(!part.url.startsWith('file:'));
    assert.equal(part.url, buildAttachmentUrl(part.storageKey!));

    // The handler recovers the storage key from the URL byte-for-byte, so the
    // bytes it serves are the bytes that were written.
    const recovered = decodeURIComponent(new URL(part.url).pathname).replace(/^\/+/, '');
    assert.equal(recovered, part.storageKey);
    assert.ok(store.readAttachmentData(recovered));

    // Keys are encoded per segment, so a traversal attempt cannot survive the
    // round trip as a directory climb.
    const escaped = buildAttachmentUrl('../../etc/passwd');
    const escapedKey = decodeURIComponent(new URL(escaped).pathname).replace(/^\/+/, '');
    assert.equal(store.readAttachmentData(escapedKey), null);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test('per-conversation toolPermissionMode is isolated and persistent', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-tool-perm-test-'));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));
  const database = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction: <TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) => (...args: TArgs) => {
      raw.exec('BEGIN');
      try {
        const res = callback(...args);
        raw.exec('COMMIT');
        return res;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    }
  } as unknown as SqliteDatabase;

  try {
    applySchema(database);
    const conversations = new ConversationsRepo(database);

    const convA = conversations.create({ toolPermissionMode: 'ask' });
    const convB = conversations.create({ toolPermissionMode: 'full-access' });

    assert.equal(conversations.getToolPermissionMode(convA.id), 'ask');
    assert.equal(conversations.getToolPermissionMode(convB.id), 'full-access');

    // Updating convA should NOT affect convB
    conversations.setToolPermissionMode(convA.id, 'read-only');

    assert.equal(conversations.getToolPermissionMode(convA.id), 'read-only');
    assert.equal(conversations.getToolPermissionMode(convB.id), 'full-access');

    const list = conversations.list();
    assert.equal(list.find((c) => c.id === convA.id)?.toolPermissionMode, 'read-only');
    assert.equal(list.find((c) => c.id === convB.id)?.toolPermissionMode, 'full-access');
  } finally {
    raw.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test('a plan survives the reload that downgrades tool inputs to a preview string', (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-conversations-plan-'));
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
  const persistPlan = (planInput: PlanToolInput, toolCallId: string) => {
    const messageId = conversations.addMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: '',
      status: 'complete',
      providerId: 'openrouter',
      modelId: 'openrouter/test-model',
      parts: [
        {
          id: toolCallId,
          type: 'tool',
          toolCallId,
          requestId: 'request-1',
          toolName: 'update_plan',
          state: 'output-available',
          input: planInput,
          output: { message: 'Plan updated.' },
        },
      ],
    });

    const tracker = new ToolExecutionTracker(
      { conversationId: conversation.id, messageId, requestId: 'request-1' },
      new ToolStateStore(toolExecutions),
    );
    tracker.handleEvent({
      type: 'tool-input-available',
      requestId: 'request-1',
      toolCallId,
      toolName: 'update_plan',
      input: planInput,
    });
    tracker.handleEvent({
      type: 'tool-output-available',
      requestId: 'request-1',
      toolCallId,
      toolName: 'update_plan',
      output: { message: 'Plan updated.' },
    });

    return messageId;
  };

  const plan: PlanToolInput = {
    explanation: 'starting the fix',
    plan: [
      { step: 'Read the code', status: 'completed' },
      { step: 'Write the fix', status: 'in_progress' },
      { step: 'Run the tests', status: 'pending' },
    ],
  };
  const messageId = persistPlan(plan, 'plan-call-1');
  const beforeReload = derivePlanView([
    {
      id: 'plan-call-1',
      type: 'tool',
      toolCallId: 'plan-call-1',
      toolName: 'update_plan',
      state: 'output-available',
      input: plan,
    },
  ]);

  const message = conversations.get(conversation.id).messages.find((entry) => entry.id === messageId);
  const hydrated = message?.parts.filter((part): part is ChatToolPart => part.type === 'tool') ?? [];
  assert.equal(typeof hydrated[0]?.input, 'string', 'the merge really does downgrade input to a preview');
  assert.deepEqual(derivePlanView(hydrated), beforeReload);

  // A plan far past the ordinary 900-char preview budget must come back whole,
  // or the checklist would vanish from history.
  const longPlan: PlanToolInput = {
    plan: Array.from({ length: 40 }, (_, index) => ({
      step: `Step ${index}: ${'work '.repeat(12).trim()}`,
      status: 'pending' as const,
    })),
  };
  const longMessageId = persistPlan(longPlan, 'plan-call-2');
  const longMessage = conversations
    .get(conversation.id)
    .messages.find((entry) => entry.id === longMessageId);
  const longHydrated = longMessage?.parts.filter((part): part is ChatToolPart => part.type === 'tool') ?? [];

  assert.ok((longHydrated[0]?.input as string).length > 900, 'the plan preview outgrows the ordinary budget');
  assert.equal(derivePlanView(longHydrated)?.total, 40);
});

test('ConversationsRepo carries execution target and worktree root through the summary projection', (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-conversations-workspace-summary-'));
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

  // The worktree summary fields are what the composer chip hangs off, so both
  // the workspace row and every summary-produced shape must surface them.
  conversations.setWorkspace(conversation.id, {
    executionTarget: 'worktree',
    worktreeRoot: '/tmp/atlas/.atlas-worktrees/conv-1',
  });

  const listed = conversations.list().find((entry) => entry.id === conversation.id);
  assert.equal(listed?.executionTarget, 'worktree');
  assert.equal(listed?.worktreeRoot, '/tmp/atlas/.atlas-worktrees/conv-1');

  const workspace = conversations.getWorkspace(conversation.id);
  assert.equal(workspace.executionTarget, 'worktree');
  assert.equal(workspace.worktreeRoot, '/tmp/atlas/.atlas-worktrees/conv-1');
});

test('Sites opt-in is sticky per conversation and defaults to off', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-site-optin-'));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));
  const database = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction: <TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) => (...args: TArgs) => {
      raw.exec('BEGIN');
      try {
        const res = callback(...args);
        raw.exec('COMMIT');
        return res;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    }
  } as unknown as SqliteDatabase;

  try {
    // applySchema twice: the second run must be a no-op for the migration
    // (PRAGMA-probed ALTER TABLE), proving idempotency.
    applySchema(database);
    applySchema(database);
    const conversations = new ConversationsRepo(database);

    const convA = conversations.create();
    const convB = conversations.create();

    // Migration default: every existing conversation reads back as opted out.
    assert.equal(conversations.getSiteOptIn(convA.id), false);
    assert.equal(conversations.getSiteOptIn(convB.id), false);

    conversations.setSiteOptIn(convA.id, true);
    assert.equal(conversations.getSiteOptIn(convA.id), true);
    assert.equal(conversations.getSiteOptIn(convB.id), false); // isolation

    // Sticky means it can also be cleared explicitly (e.g. a future settings
    // surface); the repo itself does not force permanence.
    conversations.setSiteOptIn(convA.id, false);
    assert.equal(conversations.getSiteOptIn(convA.id), false);

    // Unknown conversation: get is false, set throws.
    assert.equal(conversations.getSiteOptIn('missing'), false);
    assert.throws(() => conversations.setSiteOptIn('missing', true), /not found/);
  } finally {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
