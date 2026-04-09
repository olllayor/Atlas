import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

import { ChatSessionRuntime } from '../src/main/ai/core/ChatSessionRuntime.js';
import { RequestTimeoutError } from '../src/main/ai/core/ErrorNormalizer.js';
import { VISUAL_PROMPT } from '../src/main/ai/core/VISUAL_PROMPT.js';
import { TOOL_USE_SYSTEM_PROMPT } from '../src/main/ai/tools/builtInTools.js';
import type { ProviderAdapter } from '../src/main/ai/core/ProviderAdapter.js';
import type { ChatMessagePart, ChatStartRequest, StreamEvent } from '../src/shared/contracts.js';

function createRequest(overrides: Partial<ChatStartRequest> = {}): ChatStartRequest {
  return {
    conversationId: 'conversation-1',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    messages: [{ role: 'user', content: 'Hello' }],
    enableTools: false,
    temperature: 0.65,
    ...overrides,
  };
}

function createRuntime(options: {
  provider: ProviderAdapter;
  history?: ModelMessage[];
  apiKey?: string | null;
  addMessage?: (input: Record<string, unknown>) => string;
}) {
  const history = options.history ?? [];
  const addMessageCalls: Array<Record<string, unknown>> = [];

  const conversationsRepo = {
    getModelHistory: (conversationId: string) => {
      assert.equal(conversationId, 'conversation-1');
      return history;
    },
    addMessage: (input: Record<string, unknown>) => {
      addMessageCalls.push(input);
      return options.addMessage?.(input) ?? 'assistant-message-1';
    },
  } as const;

  const modelsRepo = {
    list: () => [],
  } as const;

  const keychain = {
    getSecret: async () => options.apiKey ?? 'test-key',
  } as const;

  const providers = new Map([[options.provider.providerId, options.provider]]);

  const runtime = new ChatSessionRuntime(
    conversationsRepo as never,
    modelsRepo as never,
    keychain as never,
    providers as never,
  );

  return { runtime, addMessageCalls };
}

test('ChatSessionRuntime preserves current history and omits tools when disabled', async () => {
  const history: ModelMessage[] = [
    { role: 'user', content: 'Earlier user message' },
    { role: 'assistant', content: 'Earlier assistant message' },
  ];
  let capturedMessages: ModelMessage[] | null = null;
  let capturedSystem: string | undefined;
  let capturedTools: unknown;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      capturedMessages = request.messages;
      capturedSystem = request.system;
      capturedTools = request.tools;

      return {
        content: 'Final assistant answer',
        responseMessages: [{ role: 'assistant', content: 'Final assistant answer' }],
        latencyMs: 12,
      };
    },
  };

  const { runtime, addMessageCalls } = createRuntime({ provider, history });
  const events: StreamEvent[] = [];

  const result = await runtime.executeTurn({
    requestId: 'request-1',
    request: createRequest(),
    signal: new AbortController().signal,
    emitEvent: (event) => events.push(event),
  });

  assert.equal(result.messageId, 'assistant-message-1');
  assert.deepEqual(capturedMessages, history);
  assert.equal(capturedSystem, VISUAL_PROMPT);
  assert.equal(capturedTools, undefined);
  assert.equal(events.length, 0);
  assert.equal(addMessageCalls.length, 1);
  assert.equal(addMessageCalls[0]?.content, 'Final assistant answer');
  assert.equal(addMessageCalls[0]?.responseMessages, null);

  const parts = addMessageCalls[0]?.parts as ChatMessagePart[] | undefined;
  assert.equal(parts?.[0]?.type, 'text');
});

test('ChatSessionRuntime includes tool prompt and persists provider response messages when tools are enabled', async () => {
  let capturedSystem: string | undefined;
  let capturedTools: unknown;
  let capturedToolChoice: unknown;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      capturedSystem = request.system;
      capturedTools = request.tools;
      capturedToolChoice = request.toolChoice;

      return {
        content: 'Tools enabled answer',
        responseMessages: [{ role: 'assistant', content: 'Tools enabled answer' }],
        latencyMs: 9,
      };
    },
  };

  const { runtime, addMessageCalls } = createRuntime({ provider });

  await runtime.executeTurn({
    requestId: 'request-2',
    request: createRequest({ enableTools: true }),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.ok(capturedSystem?.includes(TOOL_USE_SYSTEM_PROMPT));
  assert.ok(capturedSystem?.includes(VISUAL_PROMPT));
  assert.ok(capturedTools && typeof capturedTools === 'object');
  assert.equal(capturedToolChoice, undefined);
  assert.deepEqual(addMessageCalls[0]?.responseMessages, [{ role: 'assistant', content: 'Tools enabled answer' }]);
});

test('ChatSessionRuntime forces bash tool choice for explicit shell execution requests', async () => {
  let capturedToolChoice: unknown;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      capturedToolChoice = request.toolChoice;
      return {
        content: '',
        responseMessages: [],
        latencyMs: 5,
      };
    },
  };

  const { runtime } = createRuntime({ provider });
  await runtime.executeTurn({
    requestId: 'request-shell-choice',
    request: createRequest({
      enableTools: true,
      messages: [{ role: 'user', content: 'Use a shell command to show the git status for this repo.' }],
    }),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.deepEqual(capturedToolChoice, { type: 'tool', toolName: 'bash' });
});

test('ChatSessionRuntime normalizes streamed text, reasoning, tool, and visual events into final assistant parts', async () => {
  const emitted: StreamEvent[] = [];

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      request.onChunk({
        id: 'assistant-text',
        delta: 'Lead text <visual title="Flow"><svg xmlns="http://www.w3.org/2000/svg"><text>node</text></svg>',
      });
      request.onReasoningChunk?.({
        id: 'reason-1',
        delta: 'thinking',
      });
      request.onToolInputStart?.({
        toolCallId: 'tool-1',
        toolName: 'search_model_catalog',
      });
      request.onToolInputDelta?.({
        toolCallId: 'tool-1',
        delta: '{"query":"glm"}',
      });
      request.onToolInputAvailable?.({
        toolCallId: 'tool-1',
        toolName: 'search_model_catalog',
        input: { query: 'glm' },
      });
      request.onToolOutputAvailable?.({
        toolCallId: 'tool-1',
        toolName: 'search_model_catalog',
        input: { query: 'glm' },
        output: { models: [] },
      });

      return {
        content: 'ignored',
        reasoning: 'ignored',
        responseMessages: [{ role: 'assistant', content: 'ignored' }],
        latencyMs: 20,
      };
    },
  };

  const { runtime, addMessageCalls } = createRuntime({ provider });

  await runtime.executeTurn({
    requestId: 'request-3',
    request: createRequest({ enableTools: true }),
    signal: new AbortController().signal,
    emitEvent: (event) => emitted.push(event),
  });

  assert.deepEqual(
    emitted.map((event) => event.type),
    ['chunk', 'visual-start', 'reasoning', 'tool-input-start', 'tool-input-delta', 'tool-input-available', 'tool-output-available', 'visual-complete'],
  );

  const parts = addMessageCalls[0]?.parts as ChatMessagePart[] | undefined;
  assert.ok(parts);
  assert.equal(parts?.find((part) => part.type === 'text')?.type, 'text');
  assert.equal(parts?.find((part) => part.type === 'reasoning')?.type, 'reasoning');
  assert.equal(parts?.find((part) => part.type === 'visual')?.state, 'done');

  const toolPart = parts?.find((part) => part.type === 'tool');
  assert.equal(toolPart?.type, 'tool');
  if (toolPart?.type === 'tool') {
    assert.equal(toolPart.state, 'output-available');
    assert.deepEqual(toolPart.input, { query: 'glm' });
    assert.deepEqual(toolPart.output, { models: [] });
  }
});

test('ChatSessionRuntime falls back to message parts when provider returns content without stream events', async () => {
  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat() {
      return {
        content: 'Fallback assistant text',
        reasoning: 'Fallback reasoning',
        latencyMs: 6,
      };
    },
  };

  const { runtime, addMessageCalls } = createRuntime({ provider });

  await runtime.executeTurn({
    requestId: 'request-4',
    request: createRequest(),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  const parts = addMessageCalls[0]?.parts as ChatMessagePart[] | undefined;
  assert.ok(parts?.some((part) => part.type === 'text'));
  assert.ok(parts?.some((part) => part.type === 'reasoning'));
});

test('ChatSessionRuntime falls back to responseMessages to recover missing approval-request stream chunks', async () => {
  const emitted: StreamEvent[] = [];

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat() {
      return {
        content: '',
        responseMessages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 'tool-1',
                toolName: 'web_fetch',
                input: { url: 'https://example.com', prompt: 'summarize' },
              },
              {
                type: 'tool-approval-request',
                approvalId: 'approval-1',
                toolCallId: 'tool-1',
              },
            ],
          } as ModelMessage,
        ],
        latencyMs: 10,
      };
    },
  };

  const { runtime, addMessageCalls } = createRuntime({ provider });

  const result = await runtime.executeTurn({
    requestId: 'request-approval-fallback',
    request: createRequest({ enableTools: true }),
    signal: new AbortController().signal,
    emitEvent: (event) => emitted.push(event),
  });

  assert.equal(result.status, 'awaiting_approval');
  assert.equal(result.pendingApprovals.length, 1);
  assert.equal(result.pendingApprovals[0]?.approvalId, 'approval-1');
  assert.equal(result.pendingApprovals[0]?.toolCallId, 'tool-1');
  assert.equal(result.pendingApprovals[0]?.toolName, 'web_fetch');

  const approvalEvents = emitted.filter((event) => event.type === 'tool-approval-requested');
  assert.equal(approvalEvents.length, 1);
  if (approvalEvents[0]?.type === 'tool-approval-requested') {
    assert.equal(approvalEvents[0].approvalId, 'approval-1');
    assert.equal(approvalEvents[0].toolCallId, 'tool-1');
    assert.equal(approvalEvents[0].toolName, 'web_fetch');
  }

  assert.equal(addMessageCalls.length, 1);
  assert.equal(addMessageCalls[0]?.status, 'streaming');
  const parts = addMessageCalls[0]?.parts as ChatMessagePart[] | undefined;
  const toolPart = parts?.find((part) => part.type === 'tool');
  assert.equal(toolPart?.type, 'tool');
  if (toolPart?.type === 'tool') {
    assert.equal(toolPart.state, 'approval-requested');
    assert.equal(toolPart.approval?.id, 'approval-1');
  }
});

test('ChatSessionRuntime retries once for retryable pre-stream failures', async () => {
  let attempts = 0;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat() {
      attempts += 1;
      if (attempts === 1) {
        throw new RequestTimeoutError();
      }

      return {
        content: 'Recovered after retry',
        latencyMs: 10,
      };
    },
  };

  const { runtime } = createRuntime({ provider });

  await runtime.executeTurn({
    requestId: 'request-5',
    request: createRequest(),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.equal(attempts, 2);
});

test('ChatSessionRuntime does not retry after partial streamed output', async () => {
  let attempts = 0;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      attempts += 1;
      request.onChunk({ id: 'assistant-text', delta: 'Partial answer' });
      throw new RequestTimeoutError();
    },
  };

  const { runtime } = createRuntime({ provider });

  await assert.rejects(
    runtime.executeTurn({
      requestId: 'request-6',
      request: createRequest(),
      signal: new AbortController().signal,
      emitEvent: () => undefined,
    }),
    RequestTimeoutError,
  );

  assert.equal(attempts, 1);
});

test('ChatSessionRuntime does not retry when the request signal is already aborted', async () => {
  let attempts = 0;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat() {
      attempts += 1;
      throw new RequestTimeoutError();
    },
  };

  const { runtime } = createRuntime({ provider });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    runtime.executeTurn({
      requestId: 'request-7',
      request: createRequest(),
      signal: controller.signal,
      emitEvent: () => undefined,
    }),
    RequestTimeoutError,
  );

  assert.equal(attempts, 1);
});
