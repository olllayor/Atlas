import assert from 'node:assert/strict';
import test from 'node:test';

import { setTimeout as delay } from 'node:timers/promises';

import { ChatEngine } from '../src/main/ai/core/ChatEngine.js';
import { RequestTimeoutError } from '../src/main/ai/core/ErrorNormalizer.js';
import type { ExecuteTurnRequest, ExecuteTurnResult } from '../src/main/ai/core/ChatSessionRuntime.js';
import type { ChatStartRequest, StreamEvent } from '../src/shared/contracts.js';

function createRequest(): ChatStartRequest {
  return {
    conversationId: 'conversation-1',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    messages: [{ role: 'user', content: 'Hello from user' }],
    enableTools: false,
    temperature: 0.65,
  };
}

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

test('ChatEngine start persists the user turn before async runtime execution begins', async () => {
  const addedMessages: Array<Record<string, unknown>> = [];
  const runtimeCalls: ExecuteTurnRequest[] = [];
  let releaseRuntime: (() => void) | null = null;
  const runtimeGate = new Promise<void>((resolve) => {
    releaseRuntime = resolve;
  });

  const engine = new ChatEngine(
    {
      setDefaults: () => undefined,
      addMessage: (input: Record<string, unknown>) => {
        addedMessages.push(input);
        return 'user-message-1';
      },
    } as never,
    {
      getById: () => ({ supportsTools: false }),
    } as never,
    {} as never,
    new Map() as never,
    {
      persistAttachment: () => {
        throw new Error('Attachments should not be persisted in this test.');
      },
    } as never,
    {
      async executeTurn(input: ExecuteTurnRequest): Promise<ExecuteTurnResult> {
        runtimeCalls.push(input);
        await runtimeGate;
        return { messageId: 'assistant-message-1' };
      },
    },
  );

  const { window } = createFakeWindow();
  const response = await engine.start(window as never, createRequest());

  assert.equal(typeof response.requestId, 'string');
  assert.equal(addedMessages.length, 1);
  assert.equal(addedMessages[0]?.role, 'user');
  assert.equal(runtimeCalls.length, 0);

  releaseRuntime?.();
  await delay(0);
});

test('ChatEngine emits buffered chunk events before meta and done on successful completion', async () => {
  const engine = new ChatEngine(
    {
      setDefaults: () => undefined,
      addMessage: () => 'user-message-1',
    } as never,
    {
      getById: () => ({ supportsTools: false }),
    } as never,
    {} as never,
    new Map() as never,
    {
      persistAttachment: () => {
        throw new Error('Attachments should not be persisted in this test.');
      },
    } as never,
    {
      async executeTurn({ requestId, emitEvent }: ExecuteTurnRequest): Promise<ExecuteTurnResult> {
        emitEvent({
          type: 'chunk',
          requestId,
          id: 'assistant-text',
          delta: 'Hello',
        });

        return {
          messageId: 'assistant-message-1',
          inputTokens: 10,
          outputTokens: 5,
          latencyMs: 42,
        };
      },
    },
  );

  const fakeWindow = createFakeWindow();
  await engine.start(fakeWindow.window as never, createRequest());
  await delay(0);

  assert.deepEqual(fakeWindow.events.map((event) => event.type), ['chunk', 'meta', 'done']);
  assert.equal(fakeWindow.events[1]?.type, 'meta');
  if (fakeWindow.events[1]?.type === 'meta') {
    assert.equal(fakeWindow.events[1].inputTokens, 10);
    assert.equal(fakeWindow.events[1].outputTokens, 5);
    assert.equal(fakeWindow.events[1].latencyMs, 42);
  }
  assert.equal(fakeWindow.events[2]?.type, 'done');
});

test('ChatEngine normalizes runtime errors and preserves buffered flush behavior', async () => {
  const engine = new ChatEngine(
    {
      setDefaults: () => undefined,
      addMessage: () => 'user-message-1',
    } as never,
    {
      getById: () => ({ supportsTools: false }),
    } as never,
    {} as never,
    new Map() as never,
    {
      persistAttachment: () => {
        throw new Error('Attachments should not be persisted in this test.');
      },
    } as never,
    {
      async executeTurn({ requestId, emitEvent }: ExecuteTurnRequest): Promise<ExecuteTurnResult> {
        emitEvent({
          type: 'chunk',
          requestId,
          id: 'assistant-text',
          delta: 'Partial',
        });

        throw new RequestTimeoutError();
      },
    },
  );

  const fakeWindow = createFakeWindow();
  await engine.start(fakeWindow.window as never, createRequest());
  await delay(0);

  assert.deepEqual(fakeWindow.events.map((event) => event.type), ['chunk', 'error']);
  assert.equal(fakeWindow.events[1]?.type, 'error');
  if (fakeWindow.events[1]?.type === 'error') {
    assert.equal(fakeWindow.events[1].code, 'timeout');
    assert.equal(fakeWindow.events[1].retryable, true);
  }
});
