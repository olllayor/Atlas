import assert from 'node:assert/strict';
import test from 'node:test';

import { tool } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';

import type { ProviderStreamRequest } from '../src/main/ai/core/ProviderAdapter.js';
import {
  DEFAULT_STREAM_CORE_CONFIG,
  createWatchdog,
  resolveMaxOutputTokens,
  resolveTemperature,
  runProviderStream
} from '../src/main/ai/providers/streamCore.js';

const config = DEFAULT_STREAM_CORE_CONFIG;

test('resolveMaxOutputTokens uses the model ceiling instead of one provider constant', () => {
  const budget = resolveMaxOutputTokens(undefined, { maxOutputTokens: 128_000, contextWindow: 1_000_000 }, config);

  // Well above the old hardcoded 8192, but still under the absolute guard.
  assert.equal(budget, 32_768);
});

test('resolveMaxOutputTokens falls back to the provider default for an unknown model', () => {
  assert.equal(resolveMaxOutputTokens(undefined, undefined, config), config.defaultMaxOutputTokens);
  assert.equal(resolveMaxOutputTokens(undefined, {}, config), config.defaultMaxOutputTokens);
});

test('resolveMaxOutputTokens leaves prompt room inside a small context window', () => {
  const budget = resolveMaxOutputTokens(undefined, { maxOutputTokens: 8_192, contextWindow: 8_192 }, config);

  assert.equal(budget, 4_096);
});

test('resolveMaxOutputTokens honours an explicit request but never exceeds the model', () => {
  assert.equal(resolveMaxOutputTokens(1_000, { maxOutputTokens: 16_000 }, config), 1_000);
  assert.equal(resolveMaxOutputTokens(999_999, { maxOutputTokens: 16_000 }, config), 16_000);
  assert.equal(resolveMaxOutputTokens(1, { maxOutputTokens: 16_000 }, config), 256);
});

test('resolveTemperature is omitted for models that reject it', () => {
  assert.equal(resolveTemperature(undefined, { supportsTemperature: false }, config), undefined);
  assert.equal(resolveTemperature(0.9, { supportsTemperature: false }, config), undefined);
});

test('resolveTemperature defaults when the model accepts it', () => {
  assert.equal(resolveTemperature(undefined, { supportsTemperature: true }, config), config.defaultTemperature);
  assert.equal(resolveTemperature(undefined, undefined, config), config.defaultTemperature);
  assert.equal(resolveTemperature(0.2, { supportsTemperature: true }, config), 0.2);
  assert.equal(resolveTemperature(9, { supportsTemperature: true }, config), 2);
});

test('watchdog aborts a stream that never produces a first byte', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const watchdog = createWatchdog({ firstResponseTimeoutMs: 1_000, idleTimeoutMs: 5_000 });

  t.mock.timers.tick(999);
  assert.equal(watchdog.signal.aborted, false);

  t.mock.timers.tick(2);
  assert.equal(watchdog.signal.aborted, true);
  assert.equal(watchdog.hasReceivedResponse(), false);

  watchdog.dispose();
});

test('watchdog re-arms on every chunk and only fires once the stream goes silent', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const watchdog = createWatchdog({ firstResponseTimeoutMs: 1_000, idleTimeoutMs: 5_000 });

  // Streaming starts, then keeps flowing well past the first-byte deadline.
  watchdog.touch();
  for (let i = 0; i < 5; i += 1) {
    t.mock.timers.tick(4_000);
    watchdog.touch();
  }

  assert.equal(watchdog.signal.aborted, false);
  assert.equal(watchdog.hasReceivedResponse(), true);

  // Now it stalls mid-answer — previously this hung until the user gave up.
  t.mock.timers.tick(5_001);
  assert.equal(watchdog.signal.aborted, true);

  watchdog.dispose();
});

test('watchdog stops firing once disposed', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const watchdog = createWatchdog({ firstResponseTimeoutMs: 1_000, idleTimeoutMs: 5_000 });
  watchdog.dispose();

  t.mock.timers.tick(60_000);
  assert.equal(watchdog.signal.aborted, false);
});

// ---------------------------------------------------------------------------
// Step-limit exhaustion notice: stepCountIs() stops silently, so the stream
// core must say so explicitly or the turn reads as the model giving up.
// ---------------------------------------------------------------------------

const zeroUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 }
};

class LoopingModel {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'looping';
  readonly modelId = 'looping';
  readonly supportedUrls = {};

  constructor(private readonly toolCalls: number) {}

  async doGenerate(): Promise<never> {
    throw new Error('looping model only streams');
  }

  async doStream() {
    if (this.toolCalls <= 0) {
      return {
        stream: new ReadableStream({
          start: (controller) => {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({ type: 'text-start', id: 't1' });
            controller.enqueue({ type: 'text-delta', id: 't1', delta: 'done' });
            controller.enqueue({ type: 'text-end', id: 't1' });
            controller.enqueue({
              type: 'finish',
              usage: zeroUsage,
              finishReason: { unified: 'stop', raw: 'stop' }
            });
            controller.close();
          }
        })
      };
    }
    this.toolCalls -= 1;
    const id = `c${this.toolCalls}`;
    return {
      stream: new ReadableStream({
        start: (controller) => {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({
            type: 'tool-call',
            toolCallId: id,
            toolName: 'probe',
            input: JSON.stringify({ q: 'same' })
          });
          controller.enqueue({
            type: 'finish',
            usage: zeroUsage,
            finishReason: { unified: 'tool-calls', raw: 'tool-calls' }
          });
          controller.close();
        }
      })
    };
  }
}

function streamRequest(overrides: Partial<ProviderStreamRequest> = {}): ProviderStreamRequest {
  return {
    apiKey: 'test-key',
    modelId: 'test-standard-model',
    messages: [{ role: 'user', content: 'go' }],
    tools: {
      probe: tool({
        description: 'probe',
        inputSchema: z.object({ q: z.string() }),
        execute: async () => ({ ok: true })
      })
    },
    signal: new AbortController().signal,
    onChunk: () => {},
    ...overrides
  };
}

test('step-limit exhaustion emits a visible notice', async () => {
  const notices: Array<{ code: string; level: string }> = [];
  await runProviderStream({
    model: new LoopingModel(10) as unknown as LanguageModel,
    request: streamRequest({
      onNotice: (event) => notices.push({ code: event.code, level: event.level })
    }),
    config: { toolStepLimit: 3 }
  });

  assert.ok(
    notices.some((notice) => notice.code === 'step-limit-exhausted'),
    `expected a step-limit-exhausted notice, got ${JSON.stringify(notices)}`
  );
});

test('a turn that finishes before the cap stays silent', async () => {
  const notices: string[] = [];
  await runProviderStream({
    model: new LoopingModel(1) as unknown as LanguageModel,
    request: streamRequest({
      onNotice: (event) => notices.push(event.code)
    }),
    config: { toolStepLimit: 5 }
  });

  assert.ok(!notices.includes('step-limit-exhausted'));
});
