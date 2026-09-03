import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { ChatEngine, STREAM_PERSIST_INTERVAL_MS } from '../src/main/ai/core/ChatEngine.js';
import type { ExecuteTurnRequest, ExecuteTurnResult } from '../src/main/ai/core/ChatSessionRuntime.js';
import type { ChatStartRequest, StreamEvent } from '../src/shared/contracts.js';

function createFakeWindow() {
  const events: StreamEvent[] = [];
  return {
    events,
    window: {
      once() {},
      removeListener() {},
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

function createRequest(overrides: Partial<ChatStartRequest> = {}): ChatStartRequest {
  return {
    conversationId: 'conv-persistence',
    messages: [{ role: 'user', content: 'Hello streaming persistence' }],
    providerId: 'anthropic',
    modelId: 'claude-3-5-sonnet',
    enableTools: false,
    ...overrides,
  };
}

test('the streaming persistence throttle stays at 1 second', () => {
  // ARCHITECTURE INVARIANT: throttling synchronous SQLite writes during
  // continuous streaming cut DB write overhead by ~96.6% while settle paths
  // force-persist. better-sqlite3 blocks the main thread, so lowering this
  // reintroduces jank and raising it widens the crash-loss window. Retune only
  // with fresh `bench:typing` + `bench:eventloop` data.
  assert.equal(STREAM_PERSIST_INTERVAL_MS, 1000);
});

test('ChatEngine throttles updateMessage during rapid streaming and always persists on settle', async () => {
  const updateMessageCalls: Array<Record<string, unknown>> = [];
  let assistantMessageId = '';

  const engine = new ChatEngine(
    {
      setDefaults: () => undefined,
      clearLifecycleOnUserActivity: () => undefined,
      addMessage: (input: Record<string, unknown>) => {
        if (input.role === 'assistant') {
          assistantMessageId = input.id as string;
        }
        return (input.id as string) ?? 'msg-id';
      },
      updateMessage: (input: Record<string, unknown>) => {
        updateMessageCalls.push(structuredClone(input));
      },
      getModelHistory: () => [],
      getTitleState: () => ({ title: 'Chat', auto: false }),
    } as never,
    {
      getById: () => ({ supportsTools: true }),
    } as never,
    {} as never,
    new Map() as never,
    {
      persistAttachment: () => {
        throw new Error('Attachments not expected');
      },
    } as never,
    {
      async executeTurn({ requestId, emitEvent }: ExecuteTurnRequest): Promise<ExecuteTurnResult> {
        // Emit 15 rapid chunks simulating a fast stream (< 1000ms)
        for (let i = 1; i <= 15; i++) {
          emitEvent({
            type: 'chunk',
            requestId,
            id: 'chunk-1',
            delta: `part ${i} `,
          });
          await delay(20);
        }

        return {
          messageId: assistantMessageId,
          status: 'completed',
          parts: [
            {
              id: 'text-1',
              type: 'text',
              text: 'part 1 part 2 part 3 part 4 part 5 part 6 part 7 part 8 part 9 part 10 part 11 part 12 part 13 part 14 part 15 ',
              state: 'done',
            },
          ],
          responseMessages: [],
        };
      },
    }
  );

  const fakeWindow = createFakeWindow();
  await engine.start(fakeWindow.window as never, createRequest());

  // Wait for turn to execute and settle
  await delay(600);

  // During 15 rapid chunks over 300ms, unthrottled would have called updateMessage 15+ times.
  // With 1s throttling, streaming writes are throttled, and settle immediately persists.
  assert.ok(
    updateMessageCalls.length < 10,
    `Expected fewer than 10 updateMessage calls during rapid burst, got ${updateMessageCalls.length}`,
  );

  // The final call must contain the completed parts
  const lastCall = updateMessageCalls[updateMessageCalls.length - 1];
  assert.ok(lastCall, 'Expected at least one updateMessage call');
  assert.equal(lastCall.messageId, assistantMessageId);
  const finalContent = lastCall.content as string;
  assert.ok(finalContent.includes('part 15'), `Expected final content to include 'part 15', got: ${finalContent}`);
});

test('ChatEngine flushes interrupted parts immediately when turn errors', async () => {
  const updateMessageCalls: Array<Record<string, unknown>> = [];
  let assistantMessageId = '';

  const engine = new ChatEngine(
    {
      setDefaults: () => undefined,
      clearLifecycleOnUserActivity: () => undefined,
      addMessage: (input: Record<string, unknown>) => {
        if (input.role === 'assistant') {
          assistantMessageId = input.id as string;
        }
        return (input.id as string) ?? 'msg-id';
      },
      updateMessage: (input: Record<string, unknown>) => {
        updateMessageCalls.push(structuredClone(input));
      },
      getModelHistory: () => [],
      getTitleState: () => ({ title: 'Chat', auto: false }),
    } as never,
    {
      getById: () => ({ supportsTools: true }),
    } as never,
    {} as never,
    new Map() as never,
    {
      persistAttachment: () => {
        throw new Error('Attachments not expected');
      },
    } as never,
    {
      async executeTurn({ requestId, emitEvent }: ExecuteTurnRequest): Promise<ExecuteTurnResult> {
        emitEvent({
          type: 'chunk',
          requestId,
          id: 'chunk-err',
          delta: 'Midway before provider failure',
        });
        await delay(50);
        throw new Error('Simulated provider network drop');
      },
    }
  );

  const fakeWindow = createFakeWindow();
  await engine.start(fakeWindow.window as never, createRequest());

  await delay(200);

  // Error must have persisted with status error and finalized parts
  const errorCall = updateMessageCalls.find((call) => call.status === 'error');
  assert.ok(errorCall, 'Expected an updateMessage call with status: "error"');
  assert.equal(errorCall.messageId, assistantMessageId);
  assert.ok(Array.isArray(errorCall.parts));
});
