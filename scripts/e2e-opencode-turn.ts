/**
 * Live end-to-end check of the OpenCode streaming adapter.
 *
 * Spawns a real `opencode serve` and runs short turns two ways:
 *
 *   1. through `ChatSessionRuntime`, which is what production uses (and which
 *      an adapter-only check missed: the runtime used to demand a stored API
 *      key that OpenCode never has);
 *   2. through `OpenCodeAgentAdapter` directly, printing what the SPI saw.
 *
 * Usage: pnpm tsx scripts/e2e-opencode-turn.ts [model-slug] [prompt]
 * Defaults to a free model so the check costs nothing.
 */

import { ChatSessionRuntime } from '../src/main/ai/core/ChatSessionRuntime.js';
import { OpenCodeAgentAdapter } from '../src/main/ai/providers/opencode/OpenCodeAgentAdapter.js';
import { createOpenCodeAgentClient } from '../src/main/ai/providers/opencode/OpenCodeAgentClient.js';
import { OpenCodeRuntime } from '../src/main/ai/providers/opencode/OpenCodeRuntime.js';
import { defaultOpenCodeSettings } from '../src/shared/opencodeSettings.js';

async function main() {
  const modelId = process.argv[2] ?? 'opencode/big-pickle';
  const prompt = process.argv[3] ?? 'Reply with exactly: pong';
  const runtime = new OpenCodeRuntime();
  const sessions = new Map<string, { sessionId: string; directory: string }>();

  const adapter = new OpenCodeAgentAdapter({
    readSettings: () => ({ ...defaultOpenCodeSettings(), enabled: true }),
    readServerPassword: async () => null,
    connect: (settings) => runtime.connect({ settings }),
    createClient: createOpenCodeAgentClient,
    sessions: {
      get: (conversationId) => sessions.get(conversationId) ?? null,
      set: ({ conversationId, sessionId, directory }) => {
        sessions.set(conversationId, { sessionId, directory });
      },
      clear: (conversationId) => {
        sessions.delete(conversationId);
      }
    },
    defaultDirectory: () => process.cwd()
  });

  const chunks: string[] = [];
  const reasoning: string[] = [];
  const tools: string[] = [];

  try {
    const first = await adapter.streamChat({
      apiKey: '',
      modelId,
      messages: [{ role: 'user', content: prompt }],
      signal: new AbortController().signal,
      agentContext: { conversationId: 'e2e', workspaceRoot: process.cwd() },
      onChunk: (event) => chunks.push(event.delta),
      onReasoningChunk: (event) => reasoning.push(event.delta),
      onToolInputStart: (event) => tools.push(`start:${event.toolName}`),
      onToolOutputAvailable: (event) => tools.push(`output:${event.toolName}`),
      onNotice: (event) => console.log('notice:', event.code)
    });

    console.log('--- turn 1 ---');
    console.log('chunks       :', chunks.length, JSON.stringify(chunks.slice(0, 6)));
    console.log('content      :', JSON.stringify(first.content.slice(0, 200)));
    console.log('reasoning    :', reasoning.length);
    console.log('tools        :', tools);
    console.log('tokens       :', {
      input: first.inputTokens,
      output: first.outputTokens,
      reasoning: first.reasoningTokens,
      cached: first.cachedInputTokens
    });
    console.log('latencyMs    :', first.latencyMs);
    console.log('session      :', sessions.get('e2e'));

    // Second turn on the same conversation must resume, not recreate.
    const firstSession = sessions.get('e2e')?.sessionId;
    const second = await adapter.streamChat({
      apiKey: '',
      modelId,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: first.content },
        { role: 'user', content: 'Reply with exactly: pong again' }
      ],
      signal: new AbortController().signal,
      agentContext: { conversationId: 'e2e', workspaceRoot: process.cwd() },
      onChunk: () => undefined
    });

    console.log('--- turn 2 ---');
    console.log('resumed      :', sessions.get('e2e')?.sessionId === firstSession);
    console.log('content      :', JSON.stringify(second.content.slice(0, 200)));
    console.log('tokens       :', {
      input: second.inputTokens,
      output: second.outputTokens,
      cached: second.cachedInputTokens
    });
    // The production path: same adapter, reached the way a real turn reaches
    // it. A keyless provider must not be rejected before it is ever called.
    const conversationId = 'e2e-runtime';
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'Reply with exactly: pong' }
    ];
    const sessionRuntime = new ChatSessionRuntime(
      {
        getModelHistory: () => history,
        addMessage: () => 'assistant-e2e',
        updateMessage: () => undefined,
        getToolPermissionMode: () => 'ask'
      } as never,
      { list: () => [], getRuntimeHints: () => ({}) } as never,
      { getSecret: async () => null } as never,
      new Map([['opencode', adapter]]) as never
    );

    const turn = await sessionRuntime.executeTurn({
      requestId: 'e2e-runtime-1',
      request: {
        conversationId,
        providerId: 'opencode',
        modelId,
        messages: history as never,
        enableTools: false
      } as never,
      signal: new AbortController().signal,
      emitEvent: () => undefined,
      persistMessage: false
    });

    console.log('--- through ChatSessionRuntime ---');
    const partKinds = turn.parts.map((part) => part.type);
    const answer = turn.parts.find((part) => part.type === 'text') as { text?: string } | undefined;
    const thought = turn.parts.find((part) => part.type === 'reasoning') as { text?: string } | undefined;

    console.log('status       :', turn.status);
    console.log('parts        :', partKinds);
    console.log('answer       :', JSON.stringify(answer?.text?.slice(0, 120) ?? ''));
    console.log('reasoning    :', JSON.stringify(thought?.text?.slice(0, 80) ?? ''));
    console.log('tokens       :', { input: turn.inputTokens, output: turn.outputTokens, cached: turn.cachedInputTokens });
  } finally {
    await runtime.shutdown().catch(() => undefined);
  }
}

void main();
