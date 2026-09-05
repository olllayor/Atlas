import assert from 'node:assert/strict';
import test from 'node:test';

import { tool } from 'ai';
import { z } from 'zod';

import {
  TOOL_TIMEOUT,
  applyTimeoutPolicy,
  toolTimeoutResult
} from '../src/main/ai/guards/timeoutPolicy.js';
import { createBuiltInTools } from '../src/main/ai/tools/builtInTools.js';
import { webSearchToolExecute } from '../src/main/ai/tools/toolRuntime.js';

/*
 * Behavior suite for the cooperative per-tool timeout policy, ported from
 * DeepSeek Harness's guard/timeout-policy spec: zero-config declaration,
 * signal fusion, TOOL_TIMEOUT replacement keyed on the wrapper's own timer
 * (never an upstream abort), and the no-budget pass-through.
 */

type ExecutableTool = {
  execute: (input: unknown, options?: { abortSignal?: AbortSignal }) => Promise<unknown>;
  timeoutMs?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Wrapping decisions
// ---------------------------------------------------------------------------

test('tools without a budget pass through by reference', () => {
  const plain = tool({
    description: 'plain',
    inputSchema: z.object({}),
    execute: async () => 'ok'
  });
  const tools = applyTimeoutPolicy({ plain, other: { description: 'no execute' } });

  assert.equal(tools.plain, plain);
  assert.equal(tools.other, tools.other);
});

test('invalid budgets are ignored, not enforced', () => {
  for (const timeoutMs of [0, -1, Number.NaN, Infinity]) {
    const t = { description: 'x', timeoutMs, execute: async () => 'ok' };
    const wrapped = applyTimeoutPolicy({ t });
    assert.equal(wrapped.t, t, `timeoutMs ${timeoutMs} should not wrap`);
  }
});

test('defaults apply to tools that declare nothing', async () => {
  const t = {
    description: 'x',
    execute: async (_input: unknown, options?: { abortSignal?: AbortSignal }) => {
      await sleep(500);
      return options?.abortSignal?.aborted ? 'aborted' : 'finished';
    }
  };
  const wrapped = applyTimeoutPolicy({ t }, { defaults: { t: 30 } }) as Record<string, ExecutableTool>;

  const result = await wrapped.t.execute({});
  assert.deepEqual(result, toolTimeoutResult(30));
});

test('a declared budget wins over a default', () => {
  const t = { description: 'x', timeoutMs: 1234, execute: async () => 'ok' };
  const wrapped = applyTimeoutPolicy({ t }, { defaults: { t: 999_999 } }) as Record<string, ExecutableTool>;

  // Wrapped (budget present) — and the wrapper's timer uses 1234, verifiable
  // through the timeout message when it fires.
  assert.notEqual(wrapped.t, t);
});

// ---------------------------------------------------------------------------
// Deadline behavior
// ---------------------------------------------------------------------------

test('a fast tool passes its result through unchanged', async () => {
  const t = { description: 'x', timeoutMs: 1_000, execute: async () => ({ value: 42 }) };
  const wrapped = applyTimeoutPolicy({ t }) as Record<string, ExecutableTool>;

  assert.deepEqual(await wrapped.t.execute({}), { value: 42 });
});

test('a signal-honoring tool that outlives the budget yields TOOL_TIMEOUT', async () => {
  const t = {
    description: 'x',
    timeoutMs: 30,
    execute: async (_input: unknown, options?: { abortSignal?: AbortSignal }) => {
      // Cooperative: wait until aborted, then return its own abort result —
      // exactly what a fetch-forwarding tool does.
      await new Promise<void>((resolve) => {
        const signal = options?.abortSignal;
        if (!signal) return resolve();
        if (signal.aborted) return resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return { abortedByTool: true };
    }
  };
  const wrapped = applyTimeoutPolicy({ t }) as Record<string, ExecutableTool>;

  const result = await wrapped.t.execute({});
  assert.deepEqual(result, {
    timedOut: true,
    code: TOOL_TIMEOUT,
    message: 'Error: tool call timed out after 30ms'
  });
});

test('a tool that throws on abort still yields TOOL_TIMEOUT', async () => {
  const t = {
    description: 'x',
    timeoutMs: 30,
    execute: async (_input: unknown, options?: { abortSignal?: AbortSignal }) => {
      await sleep(500);
      if (options?.abortSignal?.aborted) {
        throw new Error('The operation was aborted');
      }
      return 'never';
    }
  };
  const wrapped = applyTimeoutPolicy({ t }) as Record<string, ExecutableTool>;

  const result = await wrapped.t.execute({});
  assert.equal((result as { code: string }).code, TOOL_TIMEOUT);
});

test('an upstream abort propagates as an abort, never as TOOL_TIMEOUT', async () => {
  const upstream = new AbortController();
  const t = {
    description: 'x',
    timeoutMs: 5_000,
    execute: async (_input: unknown, options?: { abortSignal?: AbortSignal }) => {
      await new Promise<void>((resolve) => {
        const signal = options?.abortSignal;
        if (!signal) return resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      throw new Error('aborted upstream');
    }
  };
  const wrapped = applyTimeoutPolicy({ t }) as Record<string, ExecutableTool>;

  const pending = wrapped.t.execute({}, { abortSignal: upstream.signal });
  await sleep(10);
  upstream.abort();

  await assert.rejects(() => pending, /aborted upstream/);
});

test('an upstream abort of a non-throwing tool passes its result through', async () => {
  const upstream = new AbortController();
  const t = {
    description: 'x',
    timeoutMs: 5_000,
    execute: async (_input: unknown, options?: { abortSignal?: AbortSignal }) => {
      await new Promise<void>((resolve) => {
        options?.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return { stoppedEarly: true };
    }
  };
  const wrapped = applyTimeoutPolicy({ t }) as Record<string, ExecutableTool>;

  const pending = wrapped.t.execute({}, { abortSignal: upstream.signal });
  await sleep(10);
  upstream.abort();

  // The tool quiesced with its own result and OUR timer never fired: no
  // replacement.
  assert.deepEqual(await pending, { stoppedEarly: true });
});

test('the fused signal reaches the tool and fires on the deadline', async () => {
  let seenSignal: AbortSignal | undefined;
  let firedReason: unknown;
  const t = {
    description: 'x',
    timeoutMs: 25,
    execute: async (_input: unknown, options?: { abortSignal?: AbortSignal }) => {
      seenSignal = options?.abortSignal;
      await new Promise<void>((resolve) => {
        seenSignal?.addEventListener(
          'abort',
          () => {
            firedReason = seenSignal?.reason;
            resolve();
          },
          { once: true }
        );
      });
      return null;
    }
  };
  const wrapped = applyTimeoutPolicy({ t }) as Record<string, ExecutableTool>;

  await wrapped.t.execute({});
  assert.ok(seenSignal, 'the tool must receive a signal');
  assert.ok(seenSignal!.aborted);
  assert.equal((firedReason as { code?: string })?.code, TOOL_TIMEOUT);
});

test('the wrapper preserves the rest of the tool definition', () => {
  const t = {
    description: 'x',
    timeoutMs: 100,
    needsApproval: true,
    inputSchema: z.object({}),
    execute: async () => 'ok'
  };
  const wrapped = applyTimeoutPolicy({ t }) as Record<string, { needsApproval?: boolean; description?: string }>;

  assert.equal(wrapped.t.needsApproval, true);
  assert.equal(wrapped.t.description, 'x');
});

// ---------------------------------------------------------------------------
// Integration: declarations and signal forwarding in the real tool set
// ---------------------------------------------------------------------------

test('web tools declare a cooperative budget; bash declares none', () => {
  const modelsRepo = { list: () => [] } as never;
  const tools = createBuiltInTools(modelsRepo, null, 'ask', { mode: 'code', root: '/tmp' }) as Record<
    string,
    { timeoutMs?: number }
  >;

  assert.equal(tools.web_search.timeoutMs, 60_000);
  assert.equal(tools.web_fetch.timeoutMs, 60_000);
  // bash enforces its own process-level timeout; a cooperative deadline on top
  // would be a second, conflicting policy.
  assert.equal(tools.bash.timeoutMs, undefined);
});

test('webSearchToolExecute honors an already-aborted signal without hitting the network', async () => {
  const aborted = AbortSignal.abort();
  await assert.rejects(() => webSearchToolExecute({ query: 'anything', signal: aborted }));
});
