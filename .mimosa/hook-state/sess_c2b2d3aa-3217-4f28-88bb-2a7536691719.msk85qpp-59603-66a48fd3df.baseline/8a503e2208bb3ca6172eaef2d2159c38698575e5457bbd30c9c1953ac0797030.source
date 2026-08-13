import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

import { ContextManager } from '../src/main/ai/core/ContextManager.js';

function createTurn(index: number): ModelMessage[] {
  return [
    {
      role: 'user',
      content: `User turn ${index}: request ${index}?`,
    },
    {
      role: 'assistant',
      content: `Assistant turn ${index}: response ${index}.`,
    },
  ];
}

function createHistory(turnCount: number) {
  const history: ModelMessage[] = [];
  for (let index = 0; index < turnCount; index += 1) {
    history.push(...createTurn(index));
  }
  return history;
}

test('ContextManager keeps recent turns raw and unchanged in standard mode', () => {
  const manager = new ContextManager();
  const history = createHistory(12);
  const expectedRecent = history.slice(4);

  const input = manager.buildModelInput({
    conversationId: 'conversation-a',
    history,
    mode: 'standard',
  });

  assert.deepEqual(input.recentMessages, expectedRecent);
  assert.ok(input.rollingSummary);
  assert.equal(input.toolSummaries.length, 0);
});

test('ContextManager emits structured rolling summary and system addendum for older turns', () => {
  const manager = new ContextManager();
  const history = createHistory(11);
  history[0] = {
    role: 'user',
    content: 'Build only v1 context manager. Do not add pinned facts. Keep it bounded?',
  };
  history[1] = {
    role: 'assistant',
    content: 'Decision: ship deterministic summarization first. Constraint: no DB schema changes.',
  };

  const input = manager.buildModelInput({
    conversationId: 'conversation-b',
    history,
    mode: 'standard',
  });

  assert.ok(input.rollingSummary);
  assert.match(input.rollingSummary!, /Goals:/);
  assert.match(input.rollingSummary!, /Decisions:/);
  assert.match(input.rollingSummary!, /Constraints:/);
  assert.match(input.rollingSummary!, /Open loops:/);
  assert.ok(input.systemContextAddendum);
  assert.match(input.systemContextAddendum!, /Rolling summary \(older turns\):/);
});

test('ContextManager reuses cached older summary when older fingerprint is unchanged', () => {
  const refreshes: string[] = [];
  const manager = new ContextManager({
    onSummaryRefresh: (conversationId) => refreshes.push(conversationId),
  });
  const history = createHistory(12);

  manager.buildModelInput({
    conversationId: 'conversation-cache',
    history,
    mode: 'standard',
  });
  manager.buildModelInput({
    conversationId: 'conversation-cache',
    history,
    mode: 'standard',
  });

  assert.equal(refreshes.length, 1);
});

test('ContextManager refreshes cached summary when older-turn fingerprint changes', () => {
  const refreshes: string[] = [];
  const manager = new ContextManager({
    onSummaryRefresh: (conversationId) => refreshes.push(conversationId),
  });
  const history = createHistory(12);

  manager.buildModelInput({
    conversationId: 'conversation-cache-change',
    history,
    mode: 'standard',
  });

  const mutatedHistory = [...history];
  mutatedHistory[0] = {
    role: 'user',
    content: 'Changed older context content',
  };

  manager.buildModelInput({
    conversationId: 'conversation-cache-change',
    history: mutatedHistory,
    mode: 'standard',
  });

  assert.equal(refreshes.length, 2);
});

test('ContextManager compresses older tool outputs and truncates large payloads', () => {
  const manager = new ContextManager();
  const history = createHistory(11);
  const huge = 'X'.repeat(2_000);
  history[1] = {
    role: 'assistant',
    content: [
      {
        type: 'tool-result',
        toolName: 'search_model_catalog',
        input: { query: 'glm models' },
        output: { models: huge, count: 42 },
      },
    ],
  } as unknown as ModelMessage;

  const input = manager.buildModelInput({
    conversationId: 'conversation-tools',
    history,
    mode: 'standard',
  });

  assert.ok(input.toolSummaries.length > 0);
  assert.equal(input.toolSummaries[0]?.toolName, 'search_model_catalog');
  assert.ok((input.toolSummaries[0]?.keyResult.length ?? 0) <= 260);
  assert.ok(!input.systemContextAddendum?.includes(huge));
});

test('ContextManager aggressive mode tightens recent raw window and tool summary budget', () => {
  const manager = new ContextManager();
  const history: ModelMessage[] = [];
  for (let index = 0; index < 18; index += 1) {
    history.push({
      role: 'user',
      content: `Request ${index}`,
    });
    history.push({
      role: 'assistant',
      content: [
        {
          type: 'tool-result',
          toolName: `tool_${index}`,
          input: { query: `query ${index}` },
          output: { result: `Result payload ${'Z'.repeat(250)}` },
        },
      ],
    } as unknown as ModelMessage);
  }

  const standard = manager.buildModelInput({
    conversationId: 'conversation-mode',
    history,
    mode: 'standard',
  });
  const aggressive = manager.buildModelInput({
    conversationId: 'conversation-mode',
    history,
    mode: 'aggressive',
  });

  assert.equal(standard.recentMessages.length, 20);
  assert.equal(aggressive.recentMessages.length, 12);
  assert.ok((standard.toolSummaries.length ?? 0) >= (aggressive.toolSummaries.length ?? 0));
  assert.ok(aggressive.toolSummaries.every((summary) => summary.purpose.length <= 96));
  assert.ok(aggressive.toolSummaries.every((summary) => summary.keyResult.length <= 140));
});

test('a token budget compresses more than the turn-count ceiling alone would', () => {
  const manager = new ContextManager();
  // Well under the 10-turn ceiling, so turn counting alone compresses nothing —
  // but each turn is enormous, which is exactly the case turn counting misses.
  const history: ModelMessage[] = [];
  for (let index = 0; index < 5; index += 1) {
    history.push(
      { role: 'user', content: `Question ${index}? ${'context '.repeat(400)}` },
      { role: 'assistant', content: `Answer ${index}. ${'detail '.repeat(400)}` }
    );
  }

  const unbounded = manager.buildModelInput({
    conversationId: 'conversation-budget',
    history,
    mode: 'standard',
  });
  assert.equal(unbounded.usage.droppedTurnCount, 0, 'turn counting alone keeps all five turns');

  const bounded = manager.buildModelInput({
    conversationId: 'conversation-budget',
    history,
    mode: 'standard',
    budget: { totalTokens: 4_000, reservedTokens: 500 },
  });

  assert.ok(bounded.usage.droppedTurnCount > 0, 'the budget must compress oversized turns');
  assert.ok(bounded.usage.historyTokens < unbounded.usage.historyTokens);
  assert.ok(bounded.recentMessages.length < history.length);
});

test('a generous budget leaves the turn-count behaviour untouched', () => {
  const manager = new ContextManager();
  const history = createHistory(12);

  const bounded = manager.buildModelInput({
    conversationId: 'conversation-roomy',
    history,
    mode: 'standard',
    budget: { totalTokens: 200_000, reservedTokens: 2_000 },
  });

  // Still exactly the turn-count split: the budget only ever tightens.
  assert.deepEqual(bounded.recentMessages, history.slice(4));
  assert.equal(bounded.usage.droppedTurnCount, 2);
  assert.equal(bounded.usage.keptTurnCount, 10);
  assert.equal(bounded.usage.fitsBudget, true);
});

test('the newest turn is never dropped, and an oversized one reports the overflow', () => {
  const manager = new ContextManager();
  const history: ModelMessage[] = [
    { role: 'user', content: 'small opener?' },
    { role: 'assistant', content: 'small answer.' },
    // A single pasted log that cannot fit any budget.
    { role: 'user', content: `Explain this: ${'x '.repeat(20_000)}` },
  ];

  const result = manager.buildModelInput({
    conversationId: 'conversation-overflow',
    history,
    mode: 'standard',
    budget: { totalTokens: 1_000, reservedTokens: 100 },
  });

  // Sending a request without the question it answers is useless, so the turn
  // goes out and the caller is told it does not fit.
  assert.equal(result.usage.fitsBudget, false);
  assert.ok(result.recentMessages.length >= 1);
  const last = result.recentMessages.at(-1);
  assert.equal(last?.role, 'user');
});

test('usage accounting is reported for the uncompressed path too', () => {
  const manager = new ContextManager();
  const result = manager.buildModelInput({
    conversationId: 'conversation-short',
    history: createHistory(2),
    mode: 'standard',
  });

  assert.equal(result.usage.droppedTurnCount, 0);
  assert.equal(result.usage.keptTurnCount, 2);
  assert.equal(result.usage.addendumTokens, 0);
  assert.ok(result.usage.historyTokens > 0, 'a real conversation never costs zero tokens');
});
