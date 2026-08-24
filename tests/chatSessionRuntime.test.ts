import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

import { ChatSessionRuntime } from '../src/main/ai/core/ChatSessionRuntime.js';
import { RequestTimeoutError } from '../src/main/ai/core/ErrorNormalizer.js';
import { VISUAL_PROMPT } from '../src/main/ai/core/VISUAL_PROMPT.js';
import { TOOL_USE_SYSTEM_PROMPT } from '../src/main/ai/tools/builtInTools.js';
import type { ProviderAdapter } from '../src/main/ai/core/ProviderAdapter.js';
import type { ToolWorkspace } from '../src/main/ai/tools/toolWorkspace.js';
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

function createHistory(turnCount: number): ModelMessage[] {
  const history: ModelMessage[] = [];
  for (let index = 0; index < turnCount; index += 1) {
    history.push({
      role: 'user',
      content: `User turn ${index}: include bounded context management`,
    });
    history.push({
      role: 'assistant',
      content: `Assistant turn ${index}: acknowledged with concise plan`,
    });
  }
  return history;
}

function createRuntime(options: {
  provider: ProviderAdapter;
  history?: ModelMessage[];
  apiKey?: string | null;
  addMessage?: (input: Record<string, unknown>) => string;
  runtimeHints?: Record<string, unknown>;
  workspace?: ToolWorkspace;
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
    getToolPermissionMode: () => 'ask',
  } as const;

  const modelsRepo = {
    list: () => [],
    getRuntimeHints: () => options.runtimeHints ?? {},
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
    undefined,
    null,
    options.workspace ? () => options.workspace as ToolWorkspace : undefined,
  );

  return { runtime, addMessageCalls };
}

/** A workspace carrying the instructions the main process would have loaded. */
function workspaceWithInstructions(): ToolWorkspace {
  const source = {
    path: '/tmp/atlas/AGENTS.md',
    scope: 'project' as const,
    bytes: 42,
    truncated: false,
  };

  return {
    mode: 'code',
    root: '/tmp/atlas',
    instructions: {
      text: 'Always run pnpm test before claiming a change works.',
      segments: [{ source, text: 'Always run pnpm test before claiming a change works.' }],
      sources: [source],
      nestedPaths: ['packages/ui/AGENTS.md'],
      totalBytes: 42,
      truncated: false,
    },
  };
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
  // No tools, and nothing in "Hello" asks for a picture: there is nothing left
  // for Atlas to say, so no system prompt is sent at all.
  assert.equal(capturedSystem, undefined);
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
  // The visual spec is gated on the turn, not on the tool set.
  assert.equal(capturedSystem?.includes(VISUAL_PROMPT), false);
  assert.ok(capturedTools && typeof capturedTools === 'object');
  assert.equal(capturedToolChoice, undefined);
  assert.deepEqual(addMessageCalls[0]?.responseMessages, [{ role: 'assistant', content: 'Tools enabled answer' }]);
});

test('ChatSessionRuntime attaches the visual spec only when the turn asks for a visual', async () => {
  let capturedSystem: string | undefined;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      capturedSystem = request.system;
      return {
        content: 'ok',
        responseMessages: [{ role: 'assistant', content: 'ok' }],
        latencyMs: 3,
      };
    },
  };

  const { runtime } = createRuntime({ provider });

  await runtime.executeTurn({
    requestId: 'request-visual-gate',
    request: createRequest({
      messages: [{ role: 'user', content: 'draw me a diagram of the retry loop' }],
    }),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.ok(capturedSystem?.includes(VISUAL_PROMPT));
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
    // The gate is on the user's words: a turn that never asked for a visual
    // does not get one parsed out of its reply.
    request: createRequest({
      enableTools: true,
      messages: [{ role: 'user', content: 'Draw me a diagram of the flow' }],
    }),
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

test('text written after a tool call becomes its own part, in call order', async () => {
  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      // A provider that reuses one text-part id across the steps of a tool
      // loop — several OpenRouter free models do exactly this.
      request.onChunk({ id: 'msg-0', delta: 'Let me search. ' });
      request.onToolInputStart?.({ toolCallId: 'tool-1', toolName: 'search_model_catalog' });
      request.onToolOutputAvailable?.({
        toolCallId: 'tool-1',
        toolName: 'search_model_catalog',
        input: { query: 'glm' },
        output: { models: [] },
      });
      request.onChunk({ id: 'msg-0', delta: 'Nothing found.' });

      return {
        content: 'ignored',
        responseMessages: [{ role: 'assistant', content: 'ignored' }],
        latencyMs: 12,
      };
    },
  };

  const { runtime, addMessageCalls } = createRuntime({ provider });

  await runtime.executeTurn({
    requestId: 'request-step-scope',
    request: createRequest({ enableTools: true }),
    signal: new AbortController().signal,
    emitEvent: () => {},
  });

  const parts = (addMessageCalls[0]?.parts as ChatMessagePart[] | undefined) ?? [];
  assert.deepEqual(
    parts.map((part) => part.type),
    ['text', 'tool', 'text'],
    'the second stretch of prose must not append to the first one'
  );
  assert.equal(parts[0]?.type === 'text' ? parts[0].text : null, 'Let me search. ');
  assert.equal(parts[2]?.type === 'text' ? parts[2].text : null, 'Nothing found.');
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

test('ChatSessionRuntime sends the compaction handoff in history and keeps the system prompt stable', async () => {
  const history = createHistory(12);
  let capturedMessages: ModelMessage[] | null = null;
  let capturedSystem: string | undefined;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      capturedMessages = request.messages;
      capturedSystem = request.system;
      return {
        content: 'Context compiled',
        latencyMs: 7,
      };
    },
  };

  const { runtime } = createRuntime({ provider, history });

  await runtime.executeTurn({
    requestId: 'request-context',
    request: createRequest(),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.ok(capturedMessages);
  // The kept turns plus one leading handoff message summarizing the older ones.
  assert.equal(capturedMessages!.length, 21);
  // The summary rides IN the history, not in the system prompt: a per-turn
  // volatile block at position 0 would re-key the provider's prompt cache on
  // every turn the compaction boundary moves.
  assert.ok(!capturedSystem?.includes('Another language model started to solve this problem'));
  const first = capturedMessages![0];
  assert.equal(first.role, 'user');
  assert.ok(String((first as { content?: unknown }).content).includes('Another language model started to solve this problem'));
});

test('ChatSessionRuntime retries once with aggressive compaction when prompt is too long before streaming', async () => {
  const history = createHistory(12);
  let attempts = 0;
  const messageCounts: number[] = [];

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      attempts += 1;
      messageCounts.push(request.messages.length);

      if (attempts === 1) {
        throw new Error('Maximum context length exceeded for this model');
      }

      return {
        content: 'Recovered with aggressive compaction',
        latencyMs: 11,
      };
    },
  };

  const { runtime } = createRuntime({ provider, history });

  await runtime.executeTurn({
    requestId: 'request-retry-compact',
    request: createRequest(),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.equal(attempts, 2);
  // Both counts include the handoff message; aggressive keeps six turns (12
  // messages) where standard keeps ten (20).
  assert.equal(messageCounts[0], 21);
  assert.equal(messageCounts[1], 13);
});

test('ChatSessionRuntime does not retry prompt-too-long compaction after partial streamed output', async () => {
  const history = createHistory(12);
  let attempts = 0;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      attempts += 1;
      request.onChunk({ id: 'assistant-text', delta: 'partial output' });
      throw new Error('Prompt is too long for this model context window');
    },
  };

  const { runtime } = createRuntime({ provider, history });

  await assert.rejects(
    runtime.executeTurn({
      requestId: 'request-no-retry-after-stream',
      request: createRequest(),
      signal: new AbortController().signal,
      emitEvent: () => undefined,
    }),
    Error,
  );

  assert.equal(attempts, 1);
});

test('ChatSessionRuntime escalates to maximal compaction when aggressive still overflows', async () => {
  const history = createHistory(12);
  let attempts = 0;
  const messageCounts: number[] = [];

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      attempts += 1;
      messageCounts.push(request.messages.length);

      if (attempts <= 2) {
        throw new Error('Maximum context length exceeded for this model');
      }

      return {
        content: 'Recovered with maximal compaction',
        latencyMs: 13,
      };
    },
  };

  const { runtime } = createRuntime({ provider, history });

  await runtime.executeTurn({
    requestId: 'request-retry-maximal',
    request: createRequest(),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.equal(attempts, 3);
  assert.equal(messageCounts[0], 21, 'standard keeps ten turns raw plus the handoff');
  assert.equal(messageCounts[1], 13, 'aggressive keeps six turns raw plus the handoff');
  assert.equal(messageCounts[2], 3, 'maximal keeps only the newest turn raw plus the handoff');
});

test('ChatSessionRuntime gives up after the maximal compaction step still overflows', async () => {
  const history = createHistory(12);
  let attempts = 0;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat() {
      attempts += 1;
      throw new Error('Maximum context length exceeded for this model');
    },
  };

  const { runtime } = createRuntime({ provider, history });

  await assert.rejects(
    runtime.executeTurn({
      requestId: 'request-ladder-exhausted',
      request: createRequest(),
      signal: new AbortController().signal,
      emitEvent: () => undefined,
    }),
    Error,
  );

  // standard, aggressive, maximal — then the honest error, no unbounded loop.
  assert.equal(attempts, 3);
});

test('ChatSessionRuntime hands the provider the catalog limits for the selected model', async () => {
  let capturedHints: unknown;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      capturedHints = request.modelHints;
      return {
        content: 'ok',
        responseMessages: [{ role: 'assistant', content: 'ok' }],
        latencyMs: 1,
      };
    },
  };

  const { runtime } = createRuntime({
    provider,
    runtimeHints: { maxOutputTokens: 64_000, supportsTemperature: false, contextWindow: 200_000 },
  });

  await runtime.executeTurn({
    requestId: 'request-hints',
    request: createRequest(),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.deepEqual(capturedHints, {
    maxOutputTokens: 64_000,
    supportsTemperature: false,
    contextWindow: 200_000,
  });
});

test('ChatSessionRuntime keeps retrying transient network failures before any output', async () => {
  let attempts = 0;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat() {
      attempts += 1;
      if (attempts < 3) {
        // Previously classified as unknown_error and never retried.
        throw new Error('fetch failed');
      }

      return {
        content: 'recovered',
        responseMessages: [{ role: 'assistant', content: 'recovered' }],
        latencyMs: 1,
      };
    },
  };

  const { runtime } = createRuntime({ provider });

  const result = await runtime.executeTurn({
    requestId: 'request-network-retry',
    request: createRequest(),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.equal(attempts, 3);
  assert.equal(result.status, 'completed');
});

test('ChatSessionRuntime stops retrying once the caller aborts', async () => {
  const controller = new AbortController();
  let attempts = 0;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat() {
      attempts += 1;
      controller.abort();
      throw new Error('fetch failed');
    },
  };

  const { runtime } = createRuntime({ provider });

  await assert.rejects(
    runtime.executeTurn({
      requestId: 'request-abort-during-retry',
      request: createRequest(),
      signal: controller.signal,
      emitEvent: () => undefined,
    }),
    Error,
  );

  assert.equal(attempts, 1);
});

test('ChatSessionRuntime withholds side-effecting tools in read-only mode', async () => {
  let capturedTools: Record<string, unknown> | undefined;
  let capturedSystem: string | undefined;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      capturedTools = request.tools as Record<string, unknown> | undefined;
      capturedSystem = request.system;
      return {
        content: 'ok',
        responseMessages: [{ role: 'assistant', content: 'ok' }],
        latencyMs: 1,
      };
    },
  };

  const { runtime } = createRuntime({ provider });

  await runtime.executeTurn({
    requestId: 'request-read-only',
    request: createRequest({ enableTools: true, toolPermissionMode: 'read-only' }),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.equal('bash' in (capturedTools ?? {}), false);
  assert.equal('web_fetch' in (capturedTools ?? {}), false);
  assert.equal('read_file' in (capturedTools ?? {}), true);
  // The prompt must agree with the tool set, or the model plans around a tool
  // it will never be offered.
  assert.match(capturedSystem ?? '', /unavailable/i);
});

test('ChatSessionRuntime clears approval gating in full-access mode', async () => {
  let capturedTools: Record<string, { needsApproval?: unknown }> | undefined;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      capturedTools = request.tools as Record<string, { needsApproval?: unknown }> | undefined;
      return {
        content: 'ok',
        responseMessages: [{ role: 'assistant', content: 'ok' }],
        latencyMs: 1,
      };
    },
  };

  const { runtime } = createRuntime({ provider });

  await runtime.executeTurn({
    requestId: 'request-full-access',
    request: createRequest({ enableTools: true, toolPermissionMode: 'full-access' }),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.equal(capturedTools?.web_fetch?.needsApproval, false);
  // bash keeps a per-call check so a request to run outside the OS sandbox
  // still pauses; everything else about it runs unattended.
  assert.equal(typeof capturedTools?.bash?.needsApproval, 'function');
});

test('ChatSessionRuntime defaults to asking for approval when no mode is sent', async () => {
  let capturedTools: Record<string, { needsApproval?: unknown }> | undefined;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      capturedTools = request.tools as Record<string, { needsApproval?: unknown }> | undefined;
      return {
        content: 'ok',
        responseMessages: [{ role: 'assistant', content: 'ok' }],
        latencyMs: 1,
      };
    },
  };

  const { runtime } = createRuntime({ provider });

  await runtime.executeTurn({
    requestId: 'request-default-mode',
    request: createRequest({ enableTools: true }),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.equal(capturedTools?.bash?.needsApproval, true);
});

test('ChatSessionRuntime ships AGENTS.md instructions in a bracketed, advisory block', async () => {
  let capturedSystem: string | undefined;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      capturedSystem = request.system;
      return {
        content: 'ok',
        responseMessages: [{ role: 'assistant', content: 'ok' }],
        latencyMs: 1,
      };
    },
  };

  const { runtime } = createRuntime({ provider, workspace: workspaceWithInstructions() });

  await runtime.executeTurn({
    requestId: 'request-agent-instructions',
    request: createRequest({ enableTools: true }),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.ok(capturedSystem?.includes('=== PROJECT INSTRUCTIONS'));
  assert.ok(capturedSystem?.includes('=== END PROJECT INSTRUCTIONS ==='));
  assert.ok(capturedSystem?.includes('Always run pnpm test before claiming a change works.'));
  // Nested files are named, never inlined, so the model knows to read them.
  assert.ok(capturedSystem?.includes('packages/ui/AGENTS.md'));
  // The enforcement statements come first; the project's own text comes last.
  assert.ok(
    (capturedSystem?.indexOf('Code mode is active') ?? -1) <
      (capturedSystem?.indexOf('=== PROJECT INSTRUCTIONS') ?? -1),
  );
});

test('ChatSessionRuntime omits AGENTS.md instructions on a turn without tools', async () => {
  let capturedSystem: string | undefined;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      capturedSystem = request.system;
      return {
        content: 'ok',
        responseMessages: [{ role: 'assistant', content: 'ok' }],
        latencyMs: 1,
      };
    },
  };

  const { runtime } = createRuntime({ provider, workspace: workspaceWithInstructions() });

  await runtime.executeTurn({
    requestId: 'request-agent-instructions-no-tools',
    request: createRequest({ enableTools: false }),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.equal((capturedSystem ?? '').includes('=== PROJECT INSTRUCTIONS'), false);
});

test('the context meter counts the AGENTS.md instructions the turn will send', async () => {
  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat() {
      return { content: 'ok', responseMessages: [], latencyMs: 1 };
    },
  };

  const withoutInstructions = createRuntime({ provider }).runtime.measureContextUsage({
    conversationId: 'conversation-1',
    modelId: 'openrouter/test-model',
    enableTools: true,
  });
  const withInstructions = createRuntime({
    provider,
    workspace: workspaceWithInstructions(),
  }).runtime.measureContextUsage({
    conversationId: 'conversation-1',
    modelId: 'openrouter/test-model',
    enableTools: true,
  });

  assert.ok(withInstructions.systemTokens > withoutInstructions.systemTokens);
});

test('ChatSessionRuntime forwards the requested reasoning effort to the provider', async () => {
  let capturedEffort: unknown;

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      capturedEffort = request.reasoningEffort;
      return {
        content: 'ok',
        responseMessages: [{ role: 'assistant', content: 'ok' }],
        latencyMs: 1,
      };
    },
  };

  const { runtime } = createRuntime({ provider });

  await runtime.executeTurn({
    requestId: 'request-effort',
    request: createRequest({ reasoningEffort: 'max' }),
    signal: new AbortController().signal,
    emitEvent: () => undefined,
  });

  assert.equal(capturedEffort, 'max');
});
