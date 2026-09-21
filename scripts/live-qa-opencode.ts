/**
 * Live QA probe: opencode tool loop with auto-approve (full-access).
 *
 * The stock e2e script runs in ask mode with no approval handler, so any
 * prompt needing tools stalls forever. This passes full-access so reads run
 * unattended, and logs the full tool lifecycle.
 *
 * Usage: pnpm tsx scripts/live-qa-opencode.ts [model] [prompt]
 */
import { OpenCodeAgentAdapter } from '../src/main/ai/providers/opencode/OpenCodeAgentAdapter.js';
import { createOpenCodeAgentClient } from '../src/main/ai/providers/opencode/OpenCodeAgentClient.js';
import { OpenCodeRuntime } from '../src/main/ai/providers/opencode/OpenCodeRuntime.js';
import { defaultOpenCodeSettings } from '../src/shared/opencodeSettingsSchema.js';

async function main() {
  const modelId = process.argv[2] ?? 'opencode/big-pickle';
  const prompt = process.argv[3] ?? 'Read package.json in the project root and reply with only the value of the version field, nothing else.';
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

  const tools: string[] = [];
  const chunks: string[] = [];
  const timer = setTimeout(() => {
    console.log('TIMEOUT: turn did not settle in 90s');
    process.exit(2);
  }, 90_000);
  try {
    const started = Date.now();
    const result = await adapter.streamChat({
      apiKey: '',
      modelId,
      messages: [{ role: 'user', content: prompt }],
      signal: new AbortController().signal,
      toolPermissionMode: 'full-access',
      agentContext: { conversationId: 'live-qa', workspaceRoot: process.cwd(), toolPermissionMode: 'full-access' },
      onChunk: (e) => chunks.push(e.delta),
      onToolInputStart: (e) => tools.push(`start:${e.toolName}`),
      onToolOutputAvailable: (e) => tools.push(`output:${e.toolName}`),
      onToolOutputError: (e) => tools.push(`error:${e.toolName}`),
      onToolApprovalRequested: () => tools.push('approval:asked'),
      onNotice: (e) => console.log('notice:', e.code, '-', e.message)
    });
    console.log('content :', JSON.stringify(result.content.slice(0, 300)));
    console.log('tools   :', tools);
    console.log('tokens  :', { input: result.inputTokens, output: result.outputTokens, cached: result.cachedInputTokens });
    console.log('latency :', Date.now() - started, 'ms');
  } finally {
    clearTimeout(timer);
    await runtime.shutdown().catch(() => undefined);
  }
}

void main();
