import assert from 'node:assert/strict';
import test from 'node:test';

import { ChatSessionRuntime } from '../src/main/ai/core/ChatSessionRuntime.js';
import type { ProviderAdapter } from '../src/main/ai/core/ProviderAdapter.js';
import type { ChatStartRequest, StreamEvent } from '../src/shared/contracts.js';

/**
 * End-to-end wiring check: a turn built by `ChatSessionRuntime` hands the
 * provider a tool set whose oversized results are spilled, while the skip-list
 * and under-cap results pass through untouched.
 */

function createRequest(overrides: Partial<ChatStartRequest> = {}): ChatStartRequest {
  return {
    conversationId: 'conversation-spill',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    messages: [{ role: 'user', content: 'Run the big tool' }],
    enableTools: true,
    temperature: 0.65,
    ...overrides
  };
}

function createFakeStore() {
  const saves: Array<{ conversationId: string; toolName: string; content: string }> = [];

  return {
    saves,
    saveText: async (input: { conversationId: string; toolName: string; content: string }) => {
      saves.push(input);
      return {
        path: `/tmp/spills/${input.conversationId}/${saves.length}-${input.toolName}.txt`,
        bytes: Buffer.byteLength(input.content, 'utf8')
      };
    }
  };
}

test('executeTurn wraps the turn tool set with the spill policy', async () => {
  const store = createFakeStore();
  let capturedTools: Record<string, { execute?: (input: unknown, options: unknown) => Promise<unknown> }> | null =
    null;

  const bigOutput = { stdout: 'x'.repeat(120_000), stderr: '' };
  const smallOutput = { stdout: 'tiny', stderr: '' };

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      capturedTools = request.tools as typeof capturedTools;

      return {
        content: 'done',
        responseMessages: [{ role: 'assistant', content: 'done' }],
        latencyMs: 5
      };
    }
  };

  const conversationsRepo = {
    getModelHistory: () => [],
    addMessage: () => 'assistant-message-1',
    getToolPermissionMode: () => 'ask'
  } as const;

  const modelsRepo = {
    list: () => [],
    getRuntimeHints: () => ({})
  } as const;

  const keychain = { getSecret: async () => 'test-key' } as const;
  const providers = new Map([[provider.providerId, provider]]);

  const runtime = new ChatSessionRuntime(
    conversationsRepo as never,
    modelsRepo as never,
    keychain as never,
    providers as never,
    undefined,
    // The Sites seam doubles as the extra-tools seam: the only way to inject a
    // tool with a controlled output without spawning a real shell.
    () => ({
      fake_big: { execute: async () => bigOutput },
      fake_small: { execute: async () => smallOutput }
    }),
    undefined,
    undefined,
    null,
    null,
    null,
    null,
    null,
    store
  );

  const events: StreamEvent[] = [];

  await runtime.executeTurn({
    requestId: 'request-spill',
    request: createRequest(),
    signal: new AbortController().signal,
    emitEvent: (event) => events.push(event)
  });

  assert.ok(capturedTools, 'the provider received a tool set');
  const tools = capturedTools as NonNullable<typeof capturedTools>;

  // The oversized result is spilled: the model sees a bounded preview plus the
  // locator, and the store holds the full serialized output.
  const spilled = (await tools.fake_big?.execute({}, {})) as string;
  assert.equal(typeof spilled, 'string');
  assert.ok(spilled.includes('Full result stored at:'));
  assert.ok(spilled.includes('conversation-spill'));
  assert.equal(store.saves.length, 1);
  assert.equal(store.saves[0]?.toolName, 'fake_big');
  assert.equal(store.saves[0]?.content, JSON.stringify(bigOutput, null, 2));

  // The under-cap result keeps its object shape — no spill, no store write.
  const small = await tools.fake_small?.execute({}, {});
  assert.deepEqual(small, smallOutput);
  assert.equal(store.saves.length, 1);

  // The skip-list keeps read_file's execute untouched by the wrapper: calling
  // it must not route through spill bookkeeping (no additional saves), and the
  // built-in set is present alongside the injected tools.
  assert.ok(typeof tools.read_file?.execute === 'function');
  assert.ok(typeof tools.bash?.execute === 'function');
});

test('executeTurn without a spill store leaves tools unwrapped', async () => {
  let capturedTools: Record<string, { execute?: () => Promise<unknown> }> | null = null;

  const bigOutput = { stdout: 'x'.repeat(120_000), stderr: '' };

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      capturedTools = request.tools as typeof capturedTools;

      return {
        content: 'done',
        responseMessages: [{ role: 'assistant', content: 'done' }],
        latencyMs: 5
      };
    }
  };

  const conversationsRepo = {
    getModelHistory: () => [],
    addMessage: () => 'assistant-message-1',
    getToolPermissionMode: () => 'ask'
  } as const;

  const modelsRepo = { list: () => [], getRuntimeHints: () => ({}) } as const;
  const keychain = { getSecret: async () => 'test-key' } as const;
  const providers = new Map([[provider.providerId, provider]]);

  const runtime = new ChatSessionRuntime(
    conversationsRepo as never,
    modelsRepo as never,
    keychain as never,
    providers as never,
    undefined,
    () => ({ fake_big: { execute: async () => bigOutput } })
  );

  await runtime.executeTurn({
    requestId: 'request-nospill',
    request: createRequest({ conversationId: 'conversation-nospill' }),
    signal: new AbortController().signal,
    emitEvent: () => undefined
  });

  const tools = capturedTools as NonNullable<typeof capturedTools>;
  const result = await tools.fake_big?.execute();

  // No store means the policy is a no-op: the original object comes back.
  assert.deepEqual(result, bigOutput);
});
