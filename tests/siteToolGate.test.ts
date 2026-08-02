import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

import { ChatSessionRuntime, type SiteToolContext } from '../src/main/ai/core/ChatSessionRuntime.js';
import type { ProviderAdapter } from '../src/main/ai/core/ProviderAdapter.js';
import { shouldLoadSiteTools } from '../src/main/ai/tools/siteTools.js';
import type { ChatStartRequest, StreamEvent } from '../src/shared/contracts.js';
import type { MentionId } from '../src/shared/mentions.js';
import { parseMentions } from '../src/shared/mentions.js';

test('shouldLoadSiteTools requires an explicit mention', () => {
  assert.equal(shouldLoadSiteTools({ mentions: [], hasExistingSite: false }), false);
  assert.equal(shouldLoadSiteTools({ mentions: ['sites'], hasExistingSite: false }), true);
});

test('shouldLoadSiteTools keeps tools loaded for a conversation that already owns a site', () => {
  // Otherwise the agent would lose its tools mid-build on the next turn.
  assert.equal(shouldLoadSiteTools({ mentions: [], hasExistingSite: true }), true);
});

/** Minimal runtime harness that captures what the provider was handed. */
function createHarness(siteToolsProvider: (context: SiteToolContext) => Record<string, unknown> | null) {
  const captured: { tools?: unknown; system?: string; context?: SiteToolContext } = {};

  const provider: ProviderAdapter = {
    providerId: 'openrouter',
    async validateCredential() {},
    async listModels() {
      return [];
    },
    async streamChat(request) {
      captured.tools = request.tools;
      captured.system = request.system;
      return {
        content: 'ok',
        responseMessages: [{ role: 'assistant', content: 'ok' } satisfies ModelMessage],
        latencyMs: 1,
      };
    },
  };

  const runtime = new ChatSessionRuntime(
    {
      getModelHistory: () => [],
      addMessage: () => 'assistant-message-1',
      getToolPermissionMode: () => 'ask',
    } as never,
    { list: () => [], getRuntimeHints: () => ({}) } as never,
    { getSecret: async () => 'test-key' } as never,
    new Map([[provider.providerId, provider]]) as never,
    undefined,
    (context) => {
      captured.context = context;
      return siteToolsProvider(context);
    }
  );

  const run = async (mentions: MentionId[]) => {
    const request: ChatStartRequest = {
      conversationId: 'conversation-1',
      providerId: 'openrouter',
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
      enableTools: true,
      mentions,
    };

    const events: StreamEvent[] = [];
    await runtime.executeTurn({
      requestId: 'request-1',
      request,
      signal: new AbortController().signal,
      emitEvent: (event) => events.push(event),
    });
  };

  return { captured, run };
}

const FAKE_SITE_TOOLS = { site_create: { description: 'fake' }, site_build: { description: 'fake' } };

test('site tools are withheld from a turn without the mention', async () => {
  const { captured, run } = createHarness(({ mentions }) =>
    shouldLoadSiteTools({ mentions, hasExistingSite: false }) ? FAKE_SITE_TOOLS : null
  );

  await run([]);

  const toolNames = Object.keys((captured.tools ?? {}) as Record<string, unknown>);
  assert.ok(toolNames.length > 0, 'built-in tools should still be present');
  assert.ok(!toolNames.includes('site_create'), 'site tools must not leak into an un-mentioned turn');
  assert.ok(!toolNames.includes('site_build'));
  assert.ok(
    !(captured.system ?? '').includes('site_* tools'),
    'the Sites instructions must not ship without the Sites tools'
  );
});

test('site tools load for a turn that mentions @Sites', async () => {
  const { captured, run } = createHarness(({ mentions }) =>
    shouldLoadSiteTools({ mentions, hasExistingSite: false }) ? FAKE_SITE_TOOLS : null
  );

  await run(parseMentions('@Sites build me a landing page'));

  const toolNames = Object.keys((captured.tools ?? {}) as Record<string, unknown>);
  assert.ok(toolNames.includes('site_create'));
  assert.ok(toolNames.includes('site_build'));
  assert.ok(toolNames.includes('read_file'), 'built-in tools remain alongside the Sites tools');
  assert.match(captured.system ?? '', /site_\* tools/);
});

test('the gate receives the conversation id so new sites bind to it', async () => {
  const { captured, run } = createHarness(() => FAKE_SITE_TOOLS);

  await run(['sites']);

  assert.equal(captured.context?.conversationId, 'conversation-1');
  assert.deepEqual(captured.context?.mentions, ['sites']);
});
