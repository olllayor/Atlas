import assert from 'node:assert/strict';
import test from 'node:test';

import { tool } from 'ai';
import type { LanguageModel, ModelMessage } from 'ai';
import { z } from 'zod';

import type { ProviderStreamRequest } from '../src/main/ai/core/ProviderAdapter.js';
import {
  DEFAULT_REPEAT_TOOL_REMINDER_CONFIG,
  canonicalizeArguments,
  createRepeatToolReminderGuard,
  previewArguments,
  validateThresholds,
  wildcardToRegExp
} from '../src/main/ai/guards/repeatToolReminder.js';
import { runProviderStream } from '../src/main/ai/providers/streamCore.js';

/*
 * Behavior suite for the repeat-tool-call guard, ported from DeepSeek Harness's
 * repeat-tool-reminder spec: chain semantics (identical / different-tracked /
 * untracked-transparent / canonicalization), threshold escalation incl. the
 * `thresholds[0]` gentle-text rule, fail-loud config validation — plus
 * end-to-end tests driving the guard through a REAL `streamText` loop against
 * a scripted mock model, which is how dsh tests its own guard.
 */

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('canonicalizeArguments ignores property order, deeply', () => {
  const a = canonicalizeArguments({ a: 1, nested: { x: [1, 2], y: null } });
  const b = canonicalizeArguments({ nested: { y: null, x: [1, 2] }, a: 1 });

  assert.equal(a, b);
  assert.equal(a, '{"a":1,"nested":{"x":[1,2],"y":null}}');
});

test('canonicalizeArguments distinguishes values, not just keys', () => {
  assert.notEqual(canonicalizeArguments({ q: 1 }), canonicalizeArguments({ q: 2 }));
});

test('wildcardToRegExp escapes regex metacharacters (a dot matches only a literal dot)', () => {
  // Would match 'probe' as a regex; must not as a wildcard pattern.
  assert.equal(wildcardToRegExp('pr.be').test('probe'), false);
  assert.equal(wildcardToRegExp('pr.be').test('pr.be'), true);
  assert.equal(wildcardToRegExp('pro*').test('probe'), true);
  assert.equal(wildcardToRegExp('pro*').test('grep'), false);
  assert.equal(wildcardToRegExp('mcp__*__search').test('mcp__docs__search'), true);
});

test('previewArguments caps the quoted text and marks the omission', () => {
  const canonical = JSON.stringify({ body: 'x'.repeat(400) });
  const preview = previewArguments(canonical, 24);

  assert.ok(preview.startsWith(canonical.slice(0, 24)));
  assert.ok(preview.endsWith(`… (+${canonical.length - 24} more chars)`));
  assert.ok(!preview.includes('x'.repeat(400)));

  // Under the cap, the full string is quoted unchanged.
  assert.equal(previewArguments('{"q":1}', 500), '{"q":1}');
});

test('validateThresholds fails loud on misconfiguration', () => {
  assert.throws(() => validateThresholds([]), /must not be empty/);
  assert.throws(() => validateThresholds([1, 3]), /integer >= 2/);
  assert.throws(() => validateThresholds([2.5]), /integer >= 2/);
  assert.throws(() => validateThresholds([3, 3]), /duplicates/);
});

test('validateThresholds normalizes to ascending order', () => {
  assert.deepEqual(validateThresholds([8, 3, 5]), [3, 5, 8]);
});

test('createRepeatToolReminderGuard rejects a non-positive or fractional argumentsPreviewChars', () => {
  assert.throws(() => createRepeatToolReminderGuard({ argumentsPreviewChars: 0 }), /argumentsPreviewChars/);
  assert.throws(() => createRepeatToolReminderGuard({ argumentsPreviewChars: 12.5 }), /argumentsPreviewChars/);
});

test('the default config excludes update_plan, the bookkeeping tool', () => {
  assert.deepEqual(DEFAULT_REPEAT_TOOL_REMINDER_CONFIG.exclude, ['update_plan']);
  assert.deepEqual(DEFAULT_REPEAT_TOOL_REMINDER_CONFIG.thresholds, [3, 5, 8]);
});

// ---------------------------------------------------------------------------
// Guard chain semantics (unit level)
// ---------------------------------------------------------------------------

const observeCalls = (
  guard: ReturnType<typeof createRepeatToolReminderGuard>,
  calls: Array<{ toolName: string; input?: unknown }>
) => calls.map((call) => guard.observe(call));

test('reminds gently at the first default threshold (3) and in detail at the second (5)', () => {
  const guard = createRepeatToolReminderGuard();
  const reminders = observeCalls(
    guard,
    Array.from({ length: 5 }, () => ({ toolName: 'probe', input: { q: 'same' } }))
  ).filter(Boolean);

  assert.equal(reminders.length, 2);
  assert.ok(reminders[0]!.text.includes('repeating the exact same tool call'));
  assert.equal(reminders[0]!.summary, 'probe × 3');
  assert.ok(reminders[1]!.text.includes('consecutive_calls: 5'));
  assert.ok(reminders[1]!.text.includes('- tool: probe'));
  assert.ok(reminders[1]!.text.includes('{"q":"same"}'));
  assert.equal(reminders[1]!.summary, 'probe × 5');
});

test('keys the gentle text to thresholds[0], not the literal 3', () => {
  // Unsorted on purpose: normalized ascending, gentle tier becomes 2.
  const guard = createRepeatToolReminderGuard({ thresholds: [4, 2] });
  const reminders = observeCalls(
    guard,
    Array.from({ length: 4 }, () => ({ toolName: 'probe', input: {} }))
  ).filter(Boolean);

  assert.equal(reminders.length, 2);
  assert.ok(reminders[0]!.text.includes('repeating the exact same tool call')); // gentle at 2
  assert.ok(reminders[1]!.text.includes('consecutive_calls: 4')); // detailed at 4
});

test('a different tracked call resets the chain', () => {
  const guard = createRepeatToolReminderGuard();
  const reminders = observeCalls(guard, [
    { toolName: 'probe', input: { q: 1 } },
    { toolName: 'probe', input: { q: 1 } },
    { toolName: 'other', input: {} }, // tracked, different → reset
    { toolName: 'probe', input: { q: 1 } },
    { toolName: 'probe', input: { q: 1 } } // only the 2nd consecutive after the reset
  ]).filter(Boolean);

  assert.equal(reminders.length, 0);
});

test('excluded calls are transparent: they neither count nor reset', () => {
  const guard = createRepeatToolReminderGuard({ exclude: ['other'] });
  const reminders = observeCalls(guard, [
    { toolName: 'probe', input: { q: 1 } },
    { toolName: 'other', input: {} }, // excluded → invisible to the chain
    { toolName: 'probe', input: { q: 1 } },
    { toolName: 'other', input: {} },
    { toolName: 'probe', input: { q: 1 } } // 3rd consecutive probe
  ]).filter(Boolean);

  assert.equal(reminders.length, 1);
  assert.ok(reminders[0]!.text.includes('repeating the exact same tool call'));
});

test('include patterns track only matching tools', () => {
  const guard = createRepeatToolReminderGuard({ include: ['pro*'] });
  const reminders = observeCalls(guard, [
    { toolName: 'other', input: {} },
    { toolName: 'other', input: {} },
    { toolName: 'other', input: {} }, // 3 identical, but untracked
    { toolName: 'probe', input: {} },
    { toolName: 'probe', input: {} },
    { toolName: 'probe', input: {} } // 3 identical, tracked
  ]).filter(Boolean);

  assert.equal(reminders.length, 1);
});

test('canonicalization treats reordered arguments as the same call', () => {
  const guard = createRepeatToolReminderGuard();
  const reminders = observeCalls(guard, [
    { toolName: 'probe', input: { a: 1, nested: { x: [1, 2], y: null } } },
    { toolName: 'probe', input: { nested: { y: null, x: [1, 2] }, a: 1 } },
    { toolName: 'probe', input: { a: 1, nested: { x: [1, 2], y: null } } }
  ]).filter(Boolean);

  assert.equal(reminders.length, 1); // all three canonicalize identically
});

test('a call without a tool name is ignored', () => {
  const guard = createRepeatToolReminderGuard({ thresholds: [2] });
  const reminders = observeCalls(guard, [
    { toolName: '', input: { q: 1 } },
    { toolName: 'probe', input: { q: 1 } },
    { toolName: 'probe', input: { q: 1 } } // count 2, not 3 — the nameless call never counted
  ]).filter(Boolean);

  assert.equal(reminders.length, 1);
});

test('caps the detailed reminder arguments while detection still keys on the full string', () => {
  const bigPayload = 'x'.repeat(400);
  const guard = createRepeatToolReminderGuard({ thresholds: [2, 3], argumentsPreviewChars: 24 });
  const reminders = observeCalls(guard, [
    { toolName: 'probe', input: { body: bigPayload } },
    { toolName: 'probe', input: { body: bigPayload } },
    { toolName: 'probe', input: { body: bigPayload } }
  ]).filter(Boolean);

  // Gentle at 2, detailed at 3 — full-key matching survived the cap.
  assert.equal(reminders.length, 2);
  assert.ok(reminders[1]!.text.includes('- arguments: {"body":"xxxxxxxxxxxxxx')); // 24-char head
  assert.ok(reminders[1]!.text.includes('… (+387 more chars)'));
  assert.ok(!reminders[1]!.text.includes(bigPayload));
});

test('past the highest threshold the chain goes silent', () => {
  const guard = createRepeatToolReminderGuard();
  const reminders = observeCalls(
    guard,
    Array.from({ length: 11 }, () => ({ toolName: 'probe', input: {} }))
  ).filter(Boolean);

  // Reminders fire only at the exact configured counts: 3, 5, 8 — never beyond.
  assert.equal(reminders.length, 3);
});

test('injectIntoStepMessages appends queued reminders once and drains them', () => {
  const guard = createRepeatToolReminderGuard({ thresholds: [2] });
  guard.observe({ toolName: 'probe', input: {} });
  guard.observe({ toolName: 'probe', input: {} });

  const base: ModelMessage[] = [{ role: 'user', content: 'go' }];
  const injected = guard.injectIntoStepMessages(base);

  assert.notEqual(injected, base);
  assert.equal(injected.length, 2);
  const reminder = injected[1] as { role: string; content: Array<{ type: string; text: string }> };
  assert.equal(reminder.role, 'user');
  assert.ok(reminder.content[0].text.includes('<system-reminder>'));
  assert.ok(reminder.content[0].text.includes('repeating the exact same tool call'));

  // Drained: the next step gets the same reference back, unchanged.
  assert.equal(guard.injectIntoStepMessages(base), base);
});

test('reset clears both the chain and any queued reminders', () => {
  const guard = createRepeatToolReminderGuard({ thresholds: [2] });
  guard.observe({ toolName: 'probe', input: {} });
  guard.observe({ toolName: 'probe', input: {} });
  guard.reset();

  const base: ModelMessage[] = [{ role: 'user', content: 'go' }];
  assert.equal(guard.injectIntoStepMessages(base), base);

  // The chain restarted: one more identical call is count 1, not 3.
  assert.equal(guard.observe({ toolName: 'probe', input: {} }), undefined);
});

// ---------------------------------------------------------------------------
// End-to-end through a real streamText loop with a scripted model
// ---------------------------------------------------------------------------

type ScriptedResponse =
  | { kind: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { kind: 'text'; text: string };

const zeroUsage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 }
};

/**
 * A LanguageModelV3 that replays a fixed script, one response per step, and
 * records the message list it was prompted with on every step — the v3
 * equivalent of dsh's MockAdapter, which lets the tests assert what the model
 * actually saw.
 */
class ScriptedModel {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'scripted';
  readonly modelId = 'scripted';
  readonly supportedUrls = {};
  readonly prompts: unknown[][] = [];

  constructor(private readonly responses: ScriptedResponse[]) {}

  async doGenerate(): Promise<never> {
    throw new Error('scripted model only streams');
  }

  async doStream(options: { prompt: unknown[] }) {
    this.prompts.push(options.prompt);
    const response = this.responses.shift();
    if (!response) {
      throw new Error('scripted model exhausted its responses');
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
            {
              type: 'finish' as const,
              usage: zeroUsage,
              finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' }
            }
          ];

    return { stream: new ReadableStream({ start: (controller) => {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    } }) };
  }
}

/** Every `<system-reminder>` text the scripted model was prompted with, across all steps. */
function reminderTextsSeen(model: ScriptedModel): string[] {
  return model.prompts.flatMap((prompt) =>
    prompt
      .filter((message): message is { role: string; content: Array<{ type: string; text?: string }> } => {
        const m = message as { role?: unknown };
        return m.role === 'user' && Array.isArray((message as { content?: unknown }).content);
      })
      .flatMap((message) => message.content)
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .filter((text) => text.includes('<system-reminder>'))
  );
}

function probeTools(overrides: Record<string, unknown> = {}) {
  return {
    probe: tool({
      description: 'probe',
      inputSchema: z.object({ q: z.string() }),
      execute: async () => ({ ok: true }),
      ...overrides
    }),
    other: tool({
      description: 'other',
      inputSchema: z.object({ q: z.string() }),
      execute: async () => ({ ok: true })
    })
  };
}

function streamRequest(overrides: Partial<ProviderStreamRequest> = {}): ProviderStreamRequest {
  return {
    apiKey: 'test-key',
    modelId: 'scripted',
    messages: [{ role: 'user', content: 'go' }],
    signal: new AbortController().signal,
    onChunk: () => {},
    ...overrides
  };
}

const toolCall = (id: string, toolName: string, input: unknown): ScriptedResponse => ({
  kind: 'tool-call',
  toolCallId: id,
  toolName,
  input
});

test('e2e: a 3-call loop is nudged gently on the step after the threshold', async () => {
  const model = new ScriptedModel([
    toolCall('c1', 'probe', { q: 'same' }),
    toolCall('c2', 'probe', { q: 'same' }),
    toolCall('c3', 'probe', { q: 'same' }),
    { kind: 'text', text: 'done' }
  ]);
  const notices: Array<{ code: string; message: string }> = [];

  await runProviderStream({
    model: model as unknown as LanguageModel,
    request: streamRequest({
      tools: probeTools(),
      onNotice: (event) => notices.push(event)
    })
  });

  const seen = reminderTextsSeen(model);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes('repeating the exact same tool call'));

  // Delivered exactly once, on the step right after the 3rd identical call —
  // steps 0-2 saw nothing.
  assert.equal(reminderTextsSeen({ prompts: model.prompts.slice(0, 3) } as ScriptedModel).length, 0);

  // The user was told, transiently.
  assert.equal(notices.length, 1);
  assert.equal(notices[0].code, 'repeat-tool-reminder');
  assert.ok(notices[0].message.includes('probe × 3'));
});

test('e2e: the reminder is not persisted into the response messages', async () => {
  const model = new ScriptedModel([
    toolCall('c1', 'probe', { q: 'same' }),
    toolCall('c2', 'probe', { q: 'same' }),
    toolCall('c3', 'probe', { q: 'same' }),
    { kind: 'text', text: 'done' }
  ]);

  const result = await runProviderStream({
    model: model as unknown as LanguageModel,
    request: streamRequest({ tools: probeTools() })
  });

  // responseMessages is what Atlas persists as the turn's model output; the
  // synthetic nudge must never ride into the transcript.
  const serialized = JSON.stringify(result.responseMessages ?? []);
  assert.ok(!serialized.includes('system-reminder'));
  assert.ok(!serialized.includes('repeating the exact same tool call'));
});

test('e2e: escalation reaches the detailed form at the second threshold', async () => {
  const model = new ScriptedModel([
    ...Array.from({ length: 5 }, (_, i) => toolCall(`c${i + 1}`, 'probe', { q: 'same' })),
    { kind: 'text', text: 'done' }
  ]);

  await runProviderStream({
    model: model as unknown as LanguageModel,
    request: streamRequest({ tools: probeTools() })
  });

  const seen = reminderTextsSeen(model);
  assert.equal(seen.length, 2);
  assert.ok(seen[0].includes('repeating the exact same tool call'));
  assert.ok(seen[1].includes('consecutive_calls: 5'));
  assert.ok(seen[1].includes('{"q":"same"}'));
});

test('e2e: a different tracked call resets the chain mid-loop', async () => {
  const model = new ScriptedModel([
    toolCall('c1', 'probe', { q: '1' }),
    toolCall('c2', 'probe', { q: '1' }),
    toolCall('c3', 'other', { q: 'x' }), // tracked, different → reset
    toolCall('c4', 'probe', { q: '1' }),
    toolCall('c5', 'probe', { q: '1' }), // only the 2nd consecutive after reset
    { kind: 'text', text: 'done' }
  ]);

  await runProviderStream({
    model: model as unknown as LanguageModel,
    request: streamRequest({ tools: probeTools() })
  });

  assert.equal(reminderTextsSeen(model).length, 0);
});

test('e2e: update_plan interleaved into a loop does not launder it (default exclude)', async () => {
  const tools = {
    ...probeTools(),
    update_plan: tool({
      description: 'plan',
      inputSchema: z.object({ plan: z.array(z.object({ step: z.string(), status: z.string() })) }),
      execute: async () => ({ ok: true })
    })
  };
  const model = new ScriptedModel([
    toolCall('c1', 'probe', { q: '1' }),
    toolCall('c2', 'update_plan', { plan: [{ step: 'a', status: 'in_progress' }] }), // excluded → transparent
    toolCall('c3', 'probe', { q: '1' }),
    toolCall('c4', 'update_plan', { plan: [{ step: 'a', status: 'completed' }] }),
    toolCall('c5', 'probe', { q: '1' }), // 3rd consecutive probe
    { kind: 'text', text: 'done' }
  ]);

  await runProviderStream({
    model: model as unknown as LanguageModel,
    request: streamRequest({ tools })
  });

  const seen = reminderTextsSeen(model);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes('repeating the exact same tool call'));
});

test('e2e: reordered argument keys still count as identical calls', async () => {
  const tools = {
    probe: tool({
      description: 'probe',
      inputSchema: z.object({ a: z.string(), b: z.string() }),
      execute: async () => ({ ok: true })
    })
  };
  const model = new ScriptedModel([
    toolCall('c1', 'probe', { a: '1', b: '2' }),
    toolCall('c2', 'probe', { b: '2', a: '1' }),
    toolCall('c3', 'probe', { a: '1', b: '2' }),
    { kind: 'text', text: 'done' }
  ]);

  await runProviderStream({
    model: model as unknown as LanguageModel,
    request: streamRequest({ tools })
  });

  assert.equal(reminderTextsSeen(model).length, 1);
});

test('e2e: denied-shaped results still count (hammering a refused call draws the nudge)', async () => {
  const tools = {
    probe: tool({
      description: 'probe',
      inputSchema: z.object({ q: z.string() }),
      // Mirrors what the approval ladder produces for a rejected call: the
      // guard must count these exactly like executed ones.
      execute: async () => ({ type: 'execution-denied', reason: 'sealed' })
    })
  };
  const model = new ScriptedModel([
    toolCall('c1', 'probe', { q: '1' }),
    toolCall('c2', 'probe', { q: '1' }),
    { kind: 'text', text: 'done' }
  ]);

  await runProviderStream({
    model: model as unknown as LanguageModel,
    request: streamRequest({ tools }),
    repeatToolReminder: { thresholds: [2] }
  });

  const seen = reminderTextsSeen(model);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes('repeating the exact same tool call'));
});

test('e2e: calls whose execute throws still count', async () => {
  const tools = {
    probe: tool({
      description: 'probe',
      inputSchema: z.object({ q: z.string() }),
      execute: async () => {
        throw new Error('boom');
      }
    })
  };
  const model = new ScriptedModel([
    toolCall('c1', 'probe', { q: '1' }),
    toolCall('c2', 'probe', { q: '1' }),
    { kind: 'text', text: 'done' }
  ]);

  await runProviderStream({
    model: model as unknown as LanguageModel,
    request: streamRequest({ tools }),
    repeatToolReminder: { thresholds: [2] }
  });

  assert.equal(reminderTextsSeen(model).length, 1);
});

test('e2e: repeatToolReminder: false disables the guard entirely', async () => {
  const model = new ScriptedModel([
    toolCall('c1', 'probe', { q: 'same' }),
    toolCall('c2', 'probe', { q: 'same' }),
    toolCall('c3', 'probe', { q: 'same' }),
    { kind: 'text', text: 'done' }
  ]);
  const notices: unknown[] = [];

  await runProviderStream({
    model: model as unknown as LanguageModel,
    request: streamRequest({
      tools: probeTools(),
      onNotice: (event) => notices.push(event)
    }),
    repeatToolReminder: false
  });

  assert.equal(reminderTextsSeen(model).length, 0);
  assert.equal(notices.length, 0);
});

test('e2e: a tool-free stream never builds a guard', async () => {
  const model = new ScriptedModel([{ kind: 'text', text: 'just an answer' }]);

  const result = await runProviderStream({
    model: model as unknown as LanguageModel,
    request: streamRequest()
  });

  assert.equal(result.content, 'just an answer');
  assert.equal(reminderTextsSeen(model).length, 0);
});
