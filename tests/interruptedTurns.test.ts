import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { setTimeout as delay } from 'node:timers/promises';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { ChatEngine } from '../src/main/ai/core/ChatEngine.js';
import type { ExecuteTurnRequest, ExecuteTurnResult } from '../src/main/ai/core/ChatSessionRuntime.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import type { ChatMessagePart, ChatStartRequest, StreamEvent } from '../src/shared/contracts.js';
import {
  finalizeInterruptedParts,
  finalizeMessageParts,
} from '../src/shared/messageParts.js';

// ---------------------------------------------------------------------------
// finalizeInterruptedParts
// ---------------------------------------------------------------------------

test('finalizeInterruptedParts closes unfinished tool calls with a synthetic error', () => {
  const parts: ChatMessagePart[] = [
    { id: 't1', type: 'text', text: 'Let me check', state: 'streaming' },
    { id: 'r1', type: 'reasoning', text: 'thinking...', state: 'streaming' },
    {
      id: 'call-1',
      type: 'tool',
      toolCallId: 'call-1',
      requestId: 'req-1',
      toolName: 'bash',
      state: 'input-streaming',
      rawInput: '{"command": "ls"',
    },
    {
      id: 'call-2',
      type: 'tool',
      toolCallId: 'call-2',
      requestId: 'req-1',
      toolName: 'search',
      state: 'output-available',
      output: 'found it',
    },
  ];

  const finalized = finalizeInterruptedParts(parts);

  assert.equal(finalized[0].state, 'done');
  assert.equal((finalized[0] as Extract<ChatMessagePart, { type: 'text' }>).text, 'Let me check');
  assert.equal(finalized[1].state, 'done');

  const interruptedCall = finalized[2] as Extract<ChatMessagePart, { type: 'tool' }>;
  assert.equal(interruptedCall.state, 'output-error');
  assert.match(interruptedCall.errorText ?? '', /interrupted/i);
  assert.equal(interruptedCall.output, undefined);

  // A call that already produced a final outcome is left exactly as it was.
  const completedCall = finalized[3] as Extract<ChatMessagePart, { type: 'tool' }>;
  assert.equal(completedCall.state, 'output-available');
  assert.equal(completedCall.output, 'found it');
});

test('finalizeInterruptedParts leaves already-final parts identical to finalizeMessageParts', () => {
  const parts: ChatMessagePart[] = [
    { id: 't1', type: 'text', text: 'done text', state: 'done' },
    {
      id: 'v1',
      type: 'visual',
      content: '<html></html>',
      state: 'done',
      title: 'chart',
    },
  ];

  assert.deepEqual(finalizeInterruptedParts(parts), finalizeMessageParts(parts));
});

// ---------------------------------------------------------------------------
// getModelHistory: interrupted assistant partials become context-visible
// ---------------------------------------------------------------------------

function createDatabase(): { database: SqliteDatabase; cleanup: () => void } {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-interrupted-turns-'));
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
  return {
    database,
    cleanup: () => {
      raw.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function createTimestamp(index: number) {
  return new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
}

test('getModelHistory includes aborted assistant text but never its dangling tool calls', (t) => {
  const { database, cleanup } = createDatabase();
  t.after(cleanup);

  const conversations = new ConversationsRepo(database);
  const conversation = conversations.create();

  conversations.addMessage({
    conversationId: conversation.id,
    role: 'user',
    content: 'Refactor the parser',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: createTimestamp(0),
  });

  // An aborted turn: delivered text plus a tool call that never finished.
  // response_messages_json holds the raw pair-less call — replaying that raw
  // would hand the provider a tool_use with no result.
  conversations.addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: 'I started by reading the entry point',
    parts: [
      { id: 'text-1', type: 'text', text: 'I started by reading the entry point', state: 'done' },
      {
        id: 'call-1',
        type: 'tool',
        toolCallId: 'call-1',
        requestId: 'req-x',
        toolName: 'read_file',
        state: 'input-available',
        rawInput: '{}',
      },
    ],
    responseMessages: [
      { role: 'assistant' as never, content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'read_file', input: {} }] },
    ],
    status: 'error',
    errorCode: 'aborted',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: createTimestamp(1),
  });

  conversations.addMessage({
    conversationId: conversation.id,
    role: 'user',
    content: 'Continue please',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: createTimestamp(2),
  });

  // An aborted turn that said nothing yet contributes nothing.
  conversations.addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: '',
    parts: [],
    status: 'error',
    errorCode: 'aborted',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: createTimestamp(3),
  });

  // A hard failure is not an interruption — the user should retry it, and
  // feeding a failed answer back as context would just re-teach the error.
  conversations.addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: 'Provider exploded',
    status: 'error',
    errorCode: 'rate_limit',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    createdAt: createTimestamp(4),
  });

  const history = conversations.getModelHistory(conversation.id) as Array<{ role: string; content: unknown }>;

  assert.deepEqual(
    history.map((message) => message.role),
    ['user', 'assistant', 'user'],
  );

  const abortedPartial = history[1];
  assert.equal(abortedPartial.content, 'I started by reading the entry point');

  const serialized = JSON.stringify(history).toLowerCase();
  assert.ok(!serialized.includes('tool-call'));
  assert.ok(!serialized.includes('read_file'));
});

test("getModelHistory includes restart-swept 'interrupted' rows the same way", (t) => {
  const { database, cleanup } = createDatabase();
  t.after(cleanup);

  const conversations = new ConversationsRepo(database);
  const conversation = conversations.create();

  conversations.addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: 'Halfway through the migration plan',
    parts: [{ id: 'text-1', type: 'text', text: 'Halfway through the migration plan', state: 'done' }],
    status: 'error',
    errorCode: 'interrupted',
    providerId: 'anthropic',
    modelId: 'claude',
    createdAt: createTimestamp(0),
  });

  const history = conversations.getModelHistory(conversation.id);
  assert.equal(history.length, 1);
  assert.equal(history[0].role, 'assistant');
});

// ---------------------------------------------------------------------------
// ChatEngine follow-up queue
// ---------------------------------------------------------------------------

function createFakeWindow() {
  const events: StreamEvent[] = [];
  let closedHandler: (() => void) | null = null;

  return {
    events,
    window: {
      once(eventName: string, handler: () => void) {
        assert.equal(eventName, 'closed');
        closedHandler = handler;
      },
      removeListener(eventName: string, handler: () => void) {
        assert.equal(eventName, 'closed');
        if (closedHandler === handler) {
          closedHandler = null;
        }
      },
      isDestroyed() {
        return false;
      },
      webContents: {
        isDestroyed() {
          return false;
        },
        send(_channel: string, event: StreamEvent) {
          events.push(event);
        },
      },
    },
  };
}

type EngineHarness = {
  engine: ChatEngine;
  runtimeCalls: ExecuteTurnRequest[];
  releaseFirst: () => void;
};

/**
 * An engine whose first turn blocks inside executeTurn until released, so a
 * second send for the same conversation deterministically lands in the
 * follow-up queue.
 */
async function createQueuedEngineHarness() {
  const addedMessages: Array<Record<string, unknown>> = [];
  const runtimeCalls: ExecuteTurnRequest[] = [];
  let releaseFirst: (() => void) | null = null;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstCall = true;

  const engine = new ChatEngine(
    {
      setDefaults: () => undefined,
      addMessage: (input: Record<string, unknown>) => {
        addedMessages.push(input);
        return `message-${addedMessages.length}`;
      },
      updateMessage: () => undefined,
      getTitleState: () => null,
    } as never,
    {
      getById: () => ({ supportsTools: false }),
    } as never,
    {} as never,
    new Map() as never,
    {
      persistAttachment: () => {
        throw new Error('No attachments in this test.');
      },
    } as never,
    {
      async executeTurn(input: ExecuteTurnRequest): Promise<ExecuteTurnResult> {
        runtimeCalls.push(input);
        if (firstCall) {
          firstCall = false;
          await firstGate;
          return { messageId: 'first-assistant' };
        }
        return { messageId: `followup-${runtimeCalls.length}` };
      },
    },
  );

  return { engine, addedMessages, runtimeCalls, releaseFirst: releaseFirst as unknown as () => void };
}

function createEngineRequest(text: string): ChatStartRequest {
  return {
    conversationId: 'conversation-1',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    messages: [{ role: 'user', content: text }],
    enableTools: false,
    temperature: 0.65,
  };
}

test('a send while the conversation is running becomes a queued follow-up, then starts on its own', async () => {
  const { engine, addedMessages, runtimeCalls, releaseFirst } = await createQueuedEngineHarness();
  const { window } = createFakeWindow();

  const first = await engine.start(window as never, createEngineRequest('First question'));
  assert.equal(first.queued ?? false, false);
  await delay(10);
  assert.equal(runtimeCalls.length, 1);

  const second = await engine.start(window as never, createEngineRequest('Second question'));
  assert.equal(second.queued, true);

  // Only the user row exists for the follow-up. No assistant placeholder yet:
  // an empty streaming bubble for a message that has not started would be a
  // lie about state.
  const followupRows = addedMessages.filter((row) => row.conversationId === 'conversation-1');
  assert.equal(followupRows.length, 3);
  assert.equal(followupRows[2]?.role, 'user');
  assert.equal(runtimeCalls.length, 1);

  releaseFirst();
  await delay(20);

  assert.equal(runtimeCalls.length, 2);
  // The deferred turn's placeholder appears only when the turn actually starts.
  const afterDispatch = addedMessages.filter((row) => row.role === 'assistant');
  assert.equal(afterDispatch.length, 2);
});

test('aborting a queued follow-up cancels it without starting a turn and notifies the renderer', async () => {
  const { engine, runtimeCalls, releaseFirst } = await createQueuedEngineHarness();
  const { window, events } = createFakeWindow();

  const first = await engine.start(window as never, createEngineRequest('First question'));
  await delay(10);

  const second = await engine.start(window as never, createEngineRequest('Second question'));
  assert.equal(second.queued, true);

  await engine.abort(second.requestId);
  await delay(5);

  releaseFirst();
  await delay(20);

  // The cancelled follow-up never becomes a turn...
  assert.equal(runtimeCalls.length, 1);
  assert.notEqual(first.requestId, '');
  // ...but the renderer learns about the cancellation through the same error
  // channel an aborted live stream uses, so its draft cannot hang forever.
  const cancellation = events.find((event) => event.type === 'error' && event.requestId === second.requestId);
  assert.ok(cancellation);
});

test('two follow-ups for one conversation start strictly in submission order', async () => {
  const { engine, runtimeCalls, releaseFirst } = await createQueuedEngineHarness();
  const { window } = createFakeWindow();

  await engine.start(window as never, createEngineRequest('First question'));
  await delay(10);

  const second = await engine.start(window as never, createEngineRequest('Second question'));
  const third = await engine.start(window as never, createEngineRequest('Third question'));
  assert.equal(second.queued, true);
  assert.equal(third.queued, true);

  releaseFirst();
  await delay(30);

  assert.equal(runtimeCalls.length, 3);
});
