/**
 * Offline mock harness — zero network, zero keys, zero spend.
 *
 * Exercises the real agent loop (`runProviderStream` + repeat guard + veto +
 * harness profiles) against a scripted mock model, so contributors can watch
 * loop hygiene without BYOK credentials or an opencode server.
 *
 * Usage: pnpm tsx scripts/mock-turn.ts
 */

import { tool } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';

import { resolveHarnessProfile, resolveHarnessPromptHint } from '../src/main/ai/core/harnessProfiles.js';
import {
  canonicalizeArgumentsFuzzy,
  createRepeatToolReminderGuard,
  REPEAT_VETO_AFTER
} from '../src/main/ai/guards/repeatToolReminder.js';
import { runProviderStream } from '../src/main/ai/providers/streamCore.js';
import type { ProviderStreamRequest } from '../src/main/ai/core/ProviderAdapter.js';

type ScriptedResponse =
  | { kind: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { kind: 'text'; text: string };

const zeroUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 }
};

class ScriptedModel {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'mock';
  readonly modelId = 'mock';
  readonly supportedUrls = {};
  readonly prompts: unknown[][] = [];
  executions = 0;

  constructor(private readonly responses: ScriptedResponse[]) {}

  async doGenerate(): Promise<never> {
    throw new Error('mock model only streams');
  }

  async doStream(options: { prompt: unknown[] }) {
    this.prompts.push(options.prompt);
    const response = this.responses.shift();
    if (!response) {
      throw new Error('mock model exhausted its responses');
    }
    const parts =
      response.kind === 'text'
        ? [
            { type: 'stream-start' as const, warnings: [] },
            { type: 'text-start' as const, id: 't1' },
            { type: 'text-delta' as const, id: 't1', delta: response.text },
            { type: 'text-end' as const, id: 't1' },
            { type: 'finish' as const, usage: zeroUsage, finishReason: { unified: 'stop' as const, raw: 'stop' } }
          ]
        : [
            { type: 'stream-start' as const, warnings: [] },
            {
              type: 'tool-call' as const,
              toolCallId: response.toolCallId,
              toolName: response.toolName,
              input: JSON.stringify(response.input)
            },
            { type: 'finish' as const, usage: zeroUsage, finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' } }
          ];
    return {
      stream: new ReadableStream({
        start: (controller) => {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        }
      })
    };
  }
}

function remindersSeen(model: ScriptedModel): string[] {
  return model.prompts.flatMap((prompt) =>
    (prompt as Array<{ role?: unknown; content?: unknown }>)
      .filter((m) => m.role === 'user' && Array.isArray(m.content))
      .flatMap((m) => (m.content as Array<{ type: string; text?: string }>))
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text as string)
      .filter((t) => t.includes('<system-reminder>'))
  );
}

function mockRequest(overrides: Partial<ProviderStreamRequest> = {}): ProviderStreamRequest {
  return {
    apiKey: 'mock-key',
    modelId: 'mock',
    messages: [{ role: 'user', content: 'go' }],
    signal: new AbortController().signal,
    onChunk: () => {},
    ...overrides
  };
}

function countingTools(model: ScriptedModel) {
  return {
    probe: tool({
      description: 'probe',
      inputSchema: z.object({ q: z.string() }),
      execute: async () => {
        model.executions += 1;
        return { ok: true };
      }
    })
  };
}

async function scenarioLoopNudge() {
  const model = new ScriptedModel([
    { kind: 'tool-call', toolCallId: 'c1', toolName: 'probe', input: { q: 'same' } },
    { kind: 'tool-call', toolCallId: 'c2', toolName: 'probe', input: { q: 'same' } },
    { kind: 'tool-call', toolCallId: 'c3', toolName: 'probe', input: { q: 'same' } },
    { kind: 'text', text: 'done' }
  ]);
  const notices: unknown[] = [];
  await runProviderStream({
    model: model as unknown as LanguageModel,
    request: mockRequest({ tools: countingTools(model), onNotice: (e) => notices.push(e) })
  });
  console.log(`1. loop nudge: reminders=${remindersSeen(model).length} notices=${notices.length} executions=${model.executions}`);
}

async function scenarioFuzzy() {
  const model = new ScriptedModel([
    { kind: 'tool-call', toolCallId: 'c1', toolName: 'probe', input: { q: '  src//a/./b/  ' } },
    { kind: 'tool-call', toolCallId: 'c2', toolName: 'probe', input: { q: 'src/a/b' } },
    { kind: 'tool-call', toolCallId: 'c3', toolName: 'probe', input: { q: 'src/a/b/\n' } },
    { kind: 'text', text: 'done' }
  ]);
  await runProviderStream({
    model: model as unknown as LanguageModel,
    request: mockRequest({ tools: countingTools(model) })
  });
  const fuzzyEqual =
    canonicalizeArgumentsFuzzy({ q: '  src//a/./b/  ' }) === canonicalizeArgumentsFuzzy({ q: 'src/a/b' });
  console.log(`2. fuzzy variants: reminders=${remindersSeen(model).length} fuzzyKeyEqual=${fuzzyEqual}`);
}

async function scenarioVeto() {
  const calls = Array.from({ length: 14 }, (_, i) => ({
    kind: 'tool-call' as const,
    toolCallId: `c${i + 1}`,
    toolName: 'probe',
    input: { q: 'same' }
  }));
  const model = new ScriptedModel([...calls, { kind: 'text', text: 'done' }]);
  const notices: Array<{ code: string }> = [];
  const result = await runProviderStream({
    model: model as unknown as LanguageModel,
    request: mockRequest({ tools: countingTools(model), onNotice: (e) => notices.push(e as { code: string }) })
  });
  const vetoes = notices.filter((n) => n.code === 'repeat-veto').length;
  const vetoInTranscript = JSON.stringify(result.responseMessages ?? []).includes('repeat-veto');
  console.log(
    `3. veto: executions=${model.executions} (of 14 calls, rest vetoed) vetoNotices=${vetoes} vetoPayloadPersisted=${vetoInTranscript} vetoAfter=${REPEAT_VETO_AFTER}`
  );
}

async function scenarioDeniedCounts() {
  const guard = createRepeatToolReminderGuard({ thresholds: [2] });
  guard.observe({ toolName: 'probe', input: { q: 'x' } });
  const reminder = guard.observeDenied({ toolName: 'probe', input: { q: 'x' } });
  console.log(`4. denial counting: deniedAttemptNudged=${reminder !== undefined} summary=${reminder?.summary ?? 'none'}`);
}

function scenarioProfiles() {
  const light = resolveHarnessProfile('openai/gpt-4o-mini');
  const heavy = resolveHarnessProfile('anthropic/claude-opus-4-7');
  console.log(
    `5. profiles: lightweight steps=${light.toolStepLimit} hint=${light.promptHint ? 'yes' : 'no'} | heavy steps=${heavy.toolStepLimit ?? 'cap'} hint=${heavy.promptHint ?? 'none'}`
  );
  console.log(`   hint via helper: ${JSON.stringify(resolveHarnessPromptHint('openai/gpt-4o-mini')?.slice(0, 60))}…`);
}

async function main() {
  console.log('mock harness: offline, no keys, no network');
  await scenarioLoopNudge();
  await scenarioFuzzy();
  await scenarioVeto();
  await scenarioDeniedCounts();
  scenarioProfiles();
}

void main();
