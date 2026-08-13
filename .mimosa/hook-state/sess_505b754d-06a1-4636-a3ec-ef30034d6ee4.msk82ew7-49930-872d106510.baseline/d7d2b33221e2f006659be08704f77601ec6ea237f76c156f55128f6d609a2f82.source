import assert from 'node:assert/strict';
import test from 'node:test';

import { setTimeout as delay } from 'node:timers/promises';

import { ChatEngine } from '../src/main/ai/core/ChatEngine.js';
import { RequestTimeoutError } from '../src/main/ai/core/ErrorNormalizer.js';
import type { ExecuteTurnRequest, ExecuteTurnResult } from '../src/main/ai/core/ChatSessionRuntime.js';
import type { ChatStartRequest, StreamEvent } from '../src/shared/contracts.js';

function createRequest(overrides: Partial<ChatStartRequest> = {}): ChatStartRequest {
  return {
    conversationId: 'conversation-1',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    messages: [{ role: 'user', content: 'Hello from user' }],
    enableTools: false,
    temperature: 0.65,
    ...overrides,
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
      updateMessage: () => undefined,
      // No title state means "no such conversation", so these tests opt out
      // of automatic naming entirely.
      getTitleState: () => null,
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
  assert.equal(addedMessages.length, 2);
  assert.equal(addedMessages[0]?.role, 'user');
  assert.equal(addedMessages[1]?.role, 'assistant');
  assert.equal(addedMessages[1]?.status, 'streaming');
  assert.equal(runtimeCalls.length, 0);

  releaseRuntime?.();
  await delay(0);
});

test('ChatEngine emits sequenced runtime sync events before meta and done on successful completion', async () => {
  const engine = new ChatEngine(
    {
      setDefaults: () => undefined,
      addMessage: () => 'user-message-1',
      updateMessage: () => undefined,
      // No title state means "no such conversation", so these tests opt out
      // of automatic naming entirely.
      getTitleState: () => null,
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

  const eventTypes = fakeWindow.events.map((event) => event.type);
  assert.ok(eventTypes.includes('runtime-sync'));
  assert.equal(eventTypes.at(-2), 'meta');
  assert.equal(eventTypes.at(-1), 'done');
  const metaEvent = fakeWindow.events.find((event) => event.type === 'meta');
  if (metaEvent?.type === 'meta') {
    assert.equal(metaEvent.inputTokens, 10);
    assert.equal(metaEvent.outputTokens, 5);
    assert.equal(metaEvent.latencyMs, 42);
  }
});

test('ChatEngine normalizes runtime errors and preserves runtime sync behavior', async () => {
  const engine = new ChatEngine(
    {
      setDefaults: () => undefined,
      addMessage: () => 'user-message-1',
      updateMessage: () => undefined,
      // No title state means "no such conversation", so these tests opt out
      // of automatic naming entirely.
      getTitleState: () => null,
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

  const eventTypes = fakeWindow.events.map((event) => event.type);
  assert.ok(eventTypes.includes('runtime-sync'));
  const errorEvent = fakeWindow.events.find((event) => event.type === 'error');
  assert.equal(errorEvent?.type, 'error');
  if (errorEvent?.type === 'error') {
    assert.equal(errorEvent.code, 'timeout');
    assert.equal(errorEvent.retryable, true);
  }
});

test('ChatEngine handles inline approval denial in the same assistant turn', async () => {
  const runtimeCalls: ExecuteTurnRequest[] = [];
  const updateMessageCalls: Array<Record<string, unknown>> = [];
  const engine = new ChatEngine(
    {
      setDefaults: () => undefined,
      addMessage: () => 'user-message-1',
      updateMessage: (input: Record<string, unknown>) => {
        updateMessageCalls.push(input);
      },
      getModelHistory: () => [],
    } as never,
    {
      getById: () => ({ supportsTools: true }),
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
        runtimeCalls.push({ requestId, emitEvent } as ExecuteTurnRequest);
        emitEvent({
          type: 'tool-approval-requested',
          requestId,
          approvalId: 'approval-1',
          toolCallId: 'tool-1',
          toolName: 'search',
          reason: 'Needs permission to search the web',
        });
        return {
          messageId: 'assistant-message-1',
          status: 'awaiting_approval',
          parts: [],
          responseMessages: [],
          pendingApprovals: [
            {
              approvalId: 'approval-1',
              toolCallId: 'tool-1',
              toolName: 'search',
              reason: 'Needs permission to search the web',
            },
          ],
        };
      },
    }
  );

  const fakeWindow = createFakeWindow();
  const { requestId } = await engine.start(fakeWindow.window as never, createRequest({ enableTools: true }));
  await delay(0);

  await engine.respondToolApproval({
    requestId,
    approvalId: 'approval-1',
    decision: 'decline',
  });
  await delay(0);

  assert.equal(runtimeCalls.length, 1);
  const eventTypes = fakeWindow.events.map((event) => event.type);
  assert.ok(eventTypes.includes('runtime-sync'));
  assert.equal(eventTypes.at(-2), 'meta');
  assert.equal(eventTypes.at(-1), 'done');
  assert.ok(updateMessageCalls.length >= 1);
  assert.ok(updateMessageCalls.some((call) => call.status === 'complete'));
});

test('ChatEngine childExecutor returns awaiting_approval and fails child task when tool is unapproved', async () => {
  let executeTurnCalls = 0;
  const engine = new ChatEngine(
    {
      setDefaults: () => undefined,
      addMessage: () => 'user-message-1',
      updateMessage: () => undefined,
      getSummary: () => ({ defaultProviderId: 'openrouter', defaultModelId: 'test-model' }),
      getTitleState: () => null,
    } as never,
    {
      getById: () => ({ supportsTools: true }),
    } as never,
    {} as never,
    new Map([['openrouter', {}]]) as never,
    {
      persistAttachment: () => {
        throw new Error('Attachments should not be persisted in this test.');
      },
    } as never,
    {
      async executeTurn(): Promise<ExecuteTurnResult> {
        executeTurnCalls += 1;
        return {
          messageId: 'child-msg-1',
          status: 'awaiting_approval',
          parts: [],
          responseMessages: [],
          pendingApprovals: [
            {
              approvalId: 'app-child-1',
              toolCallId: 'tool-child-1',
              toolName: 'bash',
              reason: 'Run bash in child',
            },
          ],
        };
      },
    }
  );

  const subagentRuntime = (engine as any).subagentRuntime;
  const taskState = await subagentRuntime.spawn({
    conversationId: 'conversation-1',
    parentTurnId: 'turn-1',
    parentToolCallId: 'spawn-tool-1',
    title: 'Unapproved child bash',
    prompt: 'Do bash',
  });

  assert.equal(executeTurnCalls, 1);
  assert.equal(taskState.status, 'failed');
  assert.equal(taskState.error, 'Child task requested unapproved tool execution');
});

test('ChatEngine childExecutor inherits session scope grant from approvalController and auto-approves child tool', async () => {
  let executeTurnCalls = 0;
  const engine = new ChatEngine(
    {
      setDefaults: () => undefined,
      addMessage: () => 'user-message-1',
      updateMessage: () => undefined,
      getSummary: () => ({ defaultProviderId: 'openrouter', defaultModelId: 'test-model' }),
      getTitleState: () => null,
    } as never,
    {
      getById: () => ({ supportsTools: true }),
    } as never,
    {} as never,
    new Map([['openrouter', {}]]) as never,
    {
      persistAttachment: () => {
        throw new Error('Attachments should not be persisted in this test.');
      },
    } as never,
    {
      async executeTurn(input: ExecuteTurnRequest): Promise<ExecuteTurnResult> {
        executeTurnCalls += 1;
        if (executeTurnCalls === 1) {
          return {
            messageId: 'child-msg-1',
            status: 'awaiting_approval',
            parts: [],
            responseMessages: [],
            pendingApprovals: [
              {
                approvalId: 'app-child-1',
                toolCallId: 'tool-child-1',
                toolName: 'bash',
                reason: 'Run bash in child',
              },
            ],
          };
        }
        assert.ok(input.messagesOverride && input.messagesOverride.length > 1);
        return {
          messageId: 'child-msg-1',
          status: 'completed',
          parts: [{ type: 'text', text: 'Bash command completed successfully' }],
          responseMessages: [],
          pendingApprovals: [],
        };
      },
    }
  );

  const approvalController = (engine as any).approvalController;
  approvalController.setPendingApprovals('parent-req-1', [
    {
      approvalId: 'parent-app-1',
      toolCallId: 'parent-call-1',
      conversationId: 'conversation-1',
      toolName: 'bash',
      sessionScopeKey: 'command_execution:bash',
    },
  ]);
  approvalController.respond('parent-req-1', {
    approvalId: 'parent-app-1',
    decision: 'accept_for_session',
  });

  const subagentRuntime = (engine as any).subagentRuntime;
  const taskState = await subagentRuntime.spawn({
    conversationId: 'conversation-1',
    parentTurnId: 'turn-1',
    parentToolCallId: 'spawn-tool-1',
    title: 'Pre-approved child bash',
    prompt: 'Do bash',
  });

  assert.equal(executeTurnCalls, 2);
  assert.equal(taskState.status, 'completed');
  assert.equal(taskState.result, 'Bash command completed successfully');
});
