import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

import {
  PRUNE_DEFAULTS,
  PRUNE_MARKER,
  codePointLength,
  pruneModelHistory,
  pruneText,
  resolvePruneConfig
} from '../src/main/ai/compaction/toolResultPruner.js';
import { ContextManager } from '../src/main/ai/core/ContextManager.js';

/*
 * Behavior suite for the tool-result pruner, ported from DeepSeek Harness's
 * compaction-tool-result-pruner spec: config validation (fail loud, emitted
 * budget must fit the threshold), code-point slicing (surrogate safety),
 * idempotence (a second pass emits nothing), and the history rewrite
 * semantics — plus integration through ContextManager.buildModelInput, the
 * seam Atlas sends every request through.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

test('defaults fit the threshold, so pruning is idempotent out of the box', () => {
  const config = resolvePruneConfig();
  assert.equal(config.thresholdChars, PRUNE_DEFAULTS.thresholdChars);
  assert.ok(config.headChars + codePointLength(PRUNE_MARKER) + config.tailChars <= config.thresholdChars);
});

test('resolvePruneConfig fails loud on unknown keys and bad values', () => {
  assert.throws(() => resolvePruneConfig({ bogus: 1 } as never), /unknown key "bogus"/);
  assert.throws(() => resolvePruneConfig({ thresholdChars: 0 }), /positive integer/);
  assert.throws(() => resolvePruneConfig({ thresholdChars: 2.5 }), /positive integer/);
  assert.throws(() => resolvePruneConfig({ headChars: -1 }), /non-negative integer/);
  assert.throws(() => resolvePruneConfig({ tailChars: 1.5 }), /non-negative integer/);
});

test('resolvePruneConfig rejects budgets whose emitted replacement would exceed the threshold', () => {
  // head + marker + tail = 10 + ~40 + 10 > 30
  assert.throws(() => resolvePruneConfig({ thresholdChars: 30, headChars: 10, tailChars: 10 }), /must be at most thresholdChars/);
});

// ---------------------------------------------------------------------------
// Text pruning
// ---------------------------------------------------------------------------

test('pruneText keeps exactly head + marker + tail code points', () => {
  const config = resolvePruneConfig({ thresholdChars: 100, headChars: 5, tailChars: 5 });
  const text = 'abcdefghij' + 'X'.repeat(100) + 'klmnopqrst';
  const pruned = pruneText(text, config);

  assert.ok(pruned.startsWith('abcde'));
  assert.ok(pruned.endsWith('pqrst'));
  assert.ok(pruned.includes(PRUNE_MARKER));
  assert.equal(codePointLength(pruned), 5 + codePointLength(PRUNE_MARKER) + 5);
});

test('pruneText never splits a surrogate pair', () => {
  const config = resolvePruneConfig({ thresholdChars: 100, headChars: 3, tailChars: 3 });
  // Astral characters are two UTF-16 code units each; a code-unit slice at
  // the wrong offset would leave lone surrogates.
  const text = '😀😁😂😃😄😅😆😇😈😉😊😋😌😍😎😏😐😑😒😓';
  const pruned = pruneText(text, config);

  assert.ok(!pruned.includes('\uFFFD'));
  assert.ok(pruned.startsWith('😀😁😂'));
  assert.ok(pruned.endsWith('😒😓'));
  // No lone surrogates anywhere: every high surrogate is followed by a low one.
  for (let index = 0; index < pruned.length; index += 1) {
    const code = pruned.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = pruned.charCodeAt(index + 1);
      assert.ok(next >= 0xdc00 && next <= 0xdfff, 'high surrogate left unpaired');
    }
  }
});

test('a tail shorter than the head budget does not duplicate text', () => {
  const config = resolvePruneConfig({ thresholdChars: 100, headChars: 10, tailChars: 3 });
  const text = 'a'.repeat(12) + 'b'.repeat(30);
  const pruned = pruneText(text, config);

  // The tail window starts at max(len - tailChars, headChars), so the head
  // and tail spans never overlap into duplicated content.
  const withoutMarker = pruned.replace(PRUNE_MARKER, '');
  assert.equal(codePointLength(withoutMarker), 13);
});

// ---------------------------------------------------------------------------
// History rewriting
// ---------------------------------------------------------------------------

const toolResultMessage = (output: unknown): ModelMessage => ({
  role: 'assistant',
  content: [
    { type: 'text', text: 'ran the search' },
    { type: 'tool-call', toolCallId: 'c1', toolName: 'grep_search', input: { pattern: 'x' } },
    // The AI SDK's response messages — what Atlas persists and reloads —
    // wrap tool output in the discriminated union, so that is the shape the
    // pruner must rewrite.
    {
      type: 'tool-result',
      toolCallId: 'c1',
      toolName: 'grep_search',
      input: { pattern: 'x' },
      output: { type: 'json', value: output }
    }
  ] as never
});

test('results under the threshold pass through by reference', () => {
  const message = toolResultMessage({ content: 'small' });
  const result = pruneModelHistory([message], { thresholdChars: 100, headChars: 10, tailChars: 10 });

  assert.equal(result.messages[0], message);
  assert.equal(result.pruned.length, 0);
  assert.equal(result.charsRemoved, 0);
});

test('an oversized structured result is replaced with a bounded string', () => {
  const big = { content: 'line\n'.repeat(20_000) }; // ~100k code points serialized
  const message = toolResultMessage(big);
  const result = pruneModelHistory([message], { thresholdChars: 1_000, headChars: 400, tailChars: 200 });

  assert.equal(result.pruned.length, 1);
  assert.equal(result.pruned[0].toolName, 'grep_search');
  assert.equal(result.pruned[0].toolCallId, 'c1');
  assert.ok(result.pruned[0].charsBefore > 1_000);
  assert.equal(result.pruned[0].charsAfter, 400 + codePointLength(PRUNE_MARKER) + 200);
  assert.equal(result.charsRemoved, result.pruned[0].charsBefore - result.pruned[0].charsAfter);

  const rewritten = result.messages[0] as { content: Array<{ type: string; output?: unknown; text?: string }> };
  assert.notEqual(rewritten, message); // new object, original untouched
  const resultPart = rewritten.content.find((part) => part.type === 'tool-result')!;
  const output = resultPart.output as { type: string; value: unknown };
  // A pruned json output becomes text: the middle is gone from the value.
  assert.equal(output.type, 'text');
  assert.equal(typeof output.value, 'string');
  assert.ok((output.value as string).includes(PRUNE_MARKER));

  // Sibling parts survive unchanged.
  assert.equal(rewritten.content[0].text, 'ran the search');
  assert.equal(rewritten.content[1].type, 'tool-call');

  // The original message object was not mutated.
  const originalPart = (message.content as Array<{ output?: { value?: unknown } }>)[2];
  assert.deepEqual(originalPart.output?.value, big);
});

test('text-wrapped outputs are measured on their value directly', () => {
  const message: ModelMessage = {
    role: 'assistant',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'bash',
        input: { command: 'x' },
        output: { type: 'text', value: 'y'.repeat(5_000) }
      }
    ] as never
  };
  const result = pruneModelHistory([message], { thresholdChars: 1_000, headChars: 100, tailChars: 100 });

  assert.equal(result.pruned.length, 1);
  assert.equal(result.pruned[0].charsBefore, 5_000);
});

test('raw (non-wrapper) outputs are measured but never rewritten', () => {
  // A hand-built history row with a raw object output: the pruner can count
  // it but cannot legally replace it, so it passes through untouched.
  const message: ModelMessage = {
    role: 'assistant',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'grep_search',
        input: {},
        output: { content: 'z'.repeat(50_000) }
      }
    ] as never
  };
  const result = pruneModelHistory([message], { thresholdChars: 1_000, headChars: 100, tailChars: 100 });

  assert.equal(result.messages[0], message);
  assert.equal(result.pruned.length, 0);
});

test('pruning is idempotent: a second pass emits nothing', () => {
  const message = toolResultMessage({ content: 'z'.repeat(50_000) });
  const first = pruneModelHistory([message], { thresholdChars: 1_000, headChars: 400, tailChars: 200 });
  const second = pruneModelHistory(first.messages, { thresholdChars: 1_000, headChars: 400, tailChars: 200 });

  assert.equal(first.pruned.length, 1);
  assert.equal(second.pruned.length, 0);
  assert.equal(second.messages, first.messages); // reference-equal: nothing changed
});

test('user messages and assistant text-only messages are never touched', () => {
  const user: ModelMessage = { role: 'user', content: 'x'.repeat(90_000) };
  const assistantText: ModelMessage = { role: 'assistant', content: 'y'.repeat(90_000) };
  const result = pruneModelHistory([user, assistantText], { thresholdChars: 1_000, headChars: 100, tailChars: 100 });

  assert.equal(result.messages[0], user);
  assert.equal(result.messages[1], assistantText);
  assert.equal(result.pruned.length, 0);
});

test('multiple oversized results across turns are all pruned in one pass', () => {
  const history = [
    { role: 'user', content: 'go' } as ModelMessage,
    toolResultMessage({ content: 'a'.repeat(20_000) }),
    { role: 'user', content: 'more' } as ModelMessage,
    toolResultMessage({ content: 'b'.repeat(30_000) })
  ];
  const result = pruneModelHistory(history, { thresholdChars: 1_000, headChars: 200, tailChars: 100 });

  assert.equal(result.pruned.length, 2);
  assert.ok(result.charsRemoved > 40_000);
});

// ---------------------------------------------------------------------------
// Integration: ContextManager.buildModelInput
// ---------------------------------------------------------------------------

test('buildModelInput prunes oversized tool results before measuring and sending', () => {
  const manager = new ContextManager();
  // Enough turns that the oldest (with the huge result) gets compressed, and
  // a recent turn whose huge result must be pruned in place.
  const history: ModelMessage[] = [];
  for (let index = 0; index < 12; index += 1) {
    history.push({ role: 'user', content: `question ${index}` });
    history.push(
      index % 2 === 0
        ? toolResultMessage({ content: `filler ${index} `.repeat(8_000) })
        : ({ role: 'assistant', content: `answer ${index}` } as ModelMessage)
    );
  }

  const result = manager.buildModelInput({ conversationId: 'c1', history, mode: 'standard' });

  // Every tool result the model sees raw is within the default threshold.
  const measureOutput = (output: unknown): number => {
    const wrapped = output as { type?: unknown; value?: unknown };
    if (wrapped && typeof wrapped === 'object') {
      if (wrapped.type === 'text' && typeof wrapped.value === 'string') {
        return codePointLength(wrapped.value);
      }
      if (wrapped.type === 'json') {
        return codePointLength(JSON.stringify(wrapped.value, null, 2));
      }
    }
    return codePointLength(typeof output === 'string' ? output : JSON.stringify(output, null, 2));
  };

  for (const message of result.recentMessages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const part of message.content as Array<{ type?: string; output?: unknown }>) {
      if (part.type !== 'tool-result' || part.output == null) continue;
      assert.ok(measureOutput(part.output) <= PRUNE_DEFAULTS.thresholdChars, 'tool result exceeds prune threshold');
    }
  }

  // Guard against a vacuous test: the raw history must actually contain
  // oversized tool results for the prune to mean anything.
  const rawHasOversized = history.some(
    (message) =>
      message.role === 'assistant' &&
      Array.isArray(message.content) &&
      (message.content as Array<{ type?: string; output?: unknown }>).some(
        (part) => part.type === 'tool-result' && part.output != null && measureOutput(part.output) > PRUNE_DEFAULTS.thresholdChars
      )
  );
  assert.ok(rawHasOversized, 'test history must contain an oversized tool result');

  // And the measurement reflects the pruned size, not the raw one: the
  // history sent raw is strictly smaller than the unpruned input.
  const rawChars = history.reduce(
    (total, message) => total + codePointLength(JSON.stringify(message.content)),
    0
  );
  const sentChars = result.recentMessages.reduce(
    (total, message) => total + codePointLength(JSON.stringify(message.content)),
    0
  );
  assert.ok(sentChars < rawChars, 'pruned history should be smaller than raw history');
});
