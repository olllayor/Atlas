import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelMessage } from 'ai';
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { ClaudeAgentAdapter } from '../src/main/ai/providers/claude/ClaudeAgentAdapter.js';
import type { OpenCodeSessionStore } from '../src/main/ai/providers/opencode/OpenCodeAgentAdapter.js';

function memoryStore() {
  const store = new Map<string, { sessionId: string; directory: string; transport?: 'sdk' | 'acp' }>();
  return {
    get(conversationId: string) {
      return store.get(conversationId) ?? null;
    },
    set(entry: { conversationId: string; sessionId: string; directory: string; transport?: 'sdk' | 'acp' }) {
      store.set(entry.conversationId, {
        sessionId: entry.sessionId,
        directory: entry.directory,
        transport: entry.transport
      });
    },
    clear(conversationId: string) {
      store.delete(conversationId);
    }
  } as OpenCodeSessionStore;
}

const USER_MESSAGES: ModelMessage[] = [
  { role: 'user', content: 'Write a fizzbuzz program' }
];

test('ClaudeAgentAdapter: listModels returns default models and custom models', async () => {
  const adapter = new ClaudeAgentAdapter({
    readSettings: () => ({
      enabled: true,
      displayName: '',
      color: '',
      binaryPath: '',
      homePath: '',
      acpCommand: '',
      launchArgs: '',
      env: {},
      customModels: ['claude-custom-special']
    }),
    sessions: memoryStore(),
    defaultDirectory: () => '/tmp/workspace'
  });

  const models = await adapter.listModels();
  assert.ok(models.length >= 4);
  assert.ok(models.some((m) => m.id === 'default'));
  assert.ok(models.some((m) => m.id === 'sonnet'));
  assert.ok(models.some((m) => m.id === 'claude-custom-special'));
  assert.ok(models.every((m) => m.providerId === 'claude-code'));
});

test('ClaudeAgentAdapter: streamChat streams text, reasoning and completes with usage', async () => {
  const textChunks: string[] = [];
  const reasoningChunks: string[] = [];

  const fakeQuery = ((_params: unknown): Query => {
    async function* generator(): AsyncGenerator<SDKMessage, void> {
      yield {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'Let me think...' }
        }
      } as unknown as SDKMessage;

      yield {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'Hello, ' }
        }
      } as unknown as SDKMessage;

      yield {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'world!' }
        }
      } as unknown as SDKMessage;

      yield {
        type: 'result',
        subtype: 'success',
        duration_ms: 200,
        duration_api_ms: 150,
        is_error: false,
        num_turns: 1,
        result: 'Hello, world!',
        stop_reason: 'end_turn',
        total_cost_usd: 0.001,
        session_id: 'session-xyz-123',
        usage: {
          input_tokens: 15,
          output_tokens: 10,
          cache_read_input_tokens: 5,
          cache_creation_input_tokens: 0
        }
      } as unknown as SDKMessage;
    }

    const gen = generator();
    (gen as unknown as { close: () => void }).close = () => {};
    return gen as unknown as Query;
  }) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query;

  const sessions = memoryStore();
  const adapter = new ClaudeAgentAdapter({
    readSettings: () => ({
      enabled: true,
      displayName: '',
      color: '',
      binaryPath: '',
      homePath: '',
      acpCommand: '',
      launchArgs: '',
      env: {},
      customModels: []
    }),
    sessions,
    defaultDirectory: () => '/tmp/workspace',
    createQuery: fakeQuery
  });

  const abortController = new AbortController();
  const result = await adapter.streamChat({
    apiKey: '',
    modelId: 'sonnet',
    messages: USER_MESSAGES,
    signal: abortController.signal,
    agentContext: {
      conversationId: 'conv-1',
      workspaceRoot: '/tmp/workspace'
    },
    onChunk: (event) => {
      textChunks.push(event.delta);
    },
    onReasoningChunk: (event) => {
      reasoningChunks.push(event.delta);
    }
  });

  assert.equal(result.content, 'Hello, world!');
  assert.equal(result.reasoning, 'Let me think...');
  assert.equal(result.inputTokens, 15);
  assert.equal(result.outputTokens, 10);
  assert.equal(result.cachedInputTokens, 5);
  assert.deepEqual(textChunks, ['Hello, ', 'world!']);
  assert.deepEqual(reasoningChunks, ['Let me think...']);

  // Check that session was persisted
  const persisted = sessions.get('conv-1');
  assert.equal(persisted?.sessionId, 'session-xyz-123');
  assert.equal(persisted?.directory, '/tmp/workspace');
});

test('ClaudeAgentAdapter: multi-turn passes stored sessionId as resume', async () => {
  let passedResumeOption: string | undefined;

  const fakeQuery = ((params: { options: { resume?: string } }): Query => {
    passedResumeOption = params.options.resume;

    async function* generator(): AsyncGenerator<SDKMessage, void> {
      yield {
        type: 'result',
        subtype: 'success',
        duration_ms: 100,
        duration_api_ms: 80,
        is_error: false,
        num_turns: 1,
        result: 'Done',
        stop_reason: 'end_turn',
        total_cost_usd: 0,
        session_id: 'session-xyz-123',
        usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      } as unknown as SDKMessage;
    }

    const gen = generator();
    (gen as unknown as { close: () => void }).close = () => {};
    return gen as unknown as Query;
  }) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query;

  const sessions = memoryStore();
  sessions.set({
    conversationId: 'conv-resume-test',
    sessionId: 'session-prev-999',
    directory: '/tmp/workspace'
  });

  const adapter = new ClaudeAgentAdapter({
    readSettings: () => ({
      enabled: true,
      displayName: '',
      color: '',
      binaryPath: '',
      homePath: '',
      acpCommand: '',
      launchArgs: '',
      env: {},
      customModels: []
    }),
    sessions,
    defaultDirectory: () => '/tmp/workspace',
    createQuery: fakeQuery
  });

  const abortController = new AbortController();
  await adapter.streamChat({
    apiKey: '',
    modelId: 'sonnet',
    messages: USER_MESSAGES,
    signal: abortController.signal,
    agentContext: {
      conversationId: 'conv-resume-test',
      workspaceRoot: '/tmp/workspace'
    },
    onChunk: () => {}
  });

  assert.equal(passedResumeOption, 'session-prev-999');
});

test('ClaudeAgentAdapter: tool approval intercept and resolution', async () => {
  let canUseToolCb: any;

  const fakeQuery = ((params: { options: { canUseTool: any } }): Query => {
    canUseToolCb = params.options.canUseTool;

    async function* generator(): AsyncGenerator<SDKMessage, void> {
      // Simulate tool call execution that invokes canUseTool
      const permResult = await canUseToolCb('Bash', { command: 'ls' }, {
        signal: new AbortController().signal,
        toolUseID: 'call-bash-1',
        title: 'Run ls command'
      });

      yield {
        type: 'result',
        subtype: 'success',
        duration_ms: 100,
        duration_api_ms: 80,
        is_error: false,
        num_turns: 1,
        result: `Ran with: ${permResult.behavior}`,
        stop_reason: 'end_turn',
        total_cost_usd: 0,
        session_id: 'session-123',
        usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      } as unknown as SDKMessage;
    }

    const gen = generator();
    (gen as unknown as { close: () => void }).close = () => {};
    return gen as unknown as Query;
  }) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query;

  const adapter = new ClaudeAgentAdapter({
    readSettings: () => ({
      enabled: true,
      displayName: '',
      color: '',
      binaryPath: '',
      homePath: '',
      acpCommand: '',
      launchArgs: '',
      env: {},
      customModels: []
    }),
    sessions: memoryStore(),
    defaultDirectory: () => '/tmp/workspace',
    createQuery: fakeQuery
  });

  let requestedApprovalId = '';
  let resolvedApprovalId = '';

  const abortController = new AbortController();
  const chatPromise = adapter.streamChat({
    apiKey: '',
    modelId: 'sonnet',
    messages: USER_MESSAGES,
    signal: abortController.signal,
    agentContext: {
      conversationId: 'conv-tool-test',
      workspaceRoot: '/tmp/workspace'
    },
    onChunk: () => {},
    onToolApprovalRequested: (event) => {
      requestedApprovalId = event.approvalId;
      assert.equal(event.toolName, 'Bash');
      assert.equal(event.toolCallId, 'call-bash-1');
      // Resolve asynchronously
      queueMicrotask(() => {
        void adapter.resolveApproval(event.approvalId, 'approve');
      });
    },
    onToolApprovalResolved: (event) => {
      resolvedApprovalId = event.approvalId;
    }
  });

  const result = await chatPromise;
  assert.equal(result.content, '');
  assert.ok(requestedApprovalId);
  assert.equal(resolvedApprovalId, requestedApprovalId);
});

test('ClaudeAgentAdapter: tool approval deny returns decline message', async () => {
  let canUseToolCb: any;

  const fakeQuery = ((params: { options: { canUseTool: any } }): Query => {
    canUseToolCb = params.options.canUseTool;

    async function* generator(): AsyncGenerator<SDKMessage, void> {
      const permResult = await canUseToolCb('Bash', { command: 'rm -rf /' }, {
        signal: new AbortController().signal,
        toolUseID: 'call-bash-2',
        title: 'Run destructive command'
      });

      yield {
        type: 'result',
        subtype: 'success',
        duration_ms: 100,
        duration_api_ms: 80,
        is_error: false,
        num_turns: 1,
        result: `Decision was: ${permResult.behavior}`,
        stop_reason: 'end_turn',
        total_cost_usd: 0,
        session_id: 'session-123',
        usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      } as unknown as SDKMessage;
    }

    const gen = generator();
    (gen as unknown as { close: () => void }).close = () => {};
    return gen as unknown as Query;
  }) as unknown as typeof import('@anthropic-ai/claude-agent-sdk').query;

  const adapter = new ClaudeAgentAdapter({
    readSettings: () => ({
      enabled: true,
      displayName: '',
      color: '',
      binaryPath: '',
      homePath: '',
      acpCommand: '',
      launchArgs: '',
      env: {},
      customModels: []
    }),
    sessions: memoryStore(),
    defaultDirectory: () => '/tmp/workspace',
    createQuery: fakeQuery
  });

  const abortController = new AbortController();
  await adapter.streamChat({
    apiKey: '',
    modelId: 'sonnet',
    messages: USER_MESSAGES,
    signal: abortController.signal,
    agentContext: {
      conversationId: 'conv-tool-deny',
      workspaceRoot: '/tmp/workspace'
    },
    onChunk: () => {},
    onToolApprovalRequested: (event) => {
      queueMicrotask(() => {
        void adapter.resolveApproval(event.approvalId, 'deny');
      });
    }
  });
});
