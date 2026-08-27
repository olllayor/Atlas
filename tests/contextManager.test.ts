import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

import { ContextManager } from '../src/main/ai/core/ContextManager.js';
import type { ConversationSummaryRecord } from '../src/main/db/repositories/conversationSummariesRepo.js';

function createTurn(index: number): ModelMessage[] {
  return [
    {
      role: 'user',
      content: `User turn ${index}: request ${index}? ${`Detail ${index}. `.repeat(48)}`,
    },
    {
      role: 'assistant',
      content: `Assistant turn ${index}: response ${index}. ${`Finding ${index}. `.repeat(48)}`,
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

  // The handoff leads the kept turns; everything after it is raw history.
  assert.equal(input.recentMessages.length, expectedRecent.length + 1);
  assert.match(String(input.recentMessages[0].content), /Another language model started/);
  assert.deepEqual(input.recentMessages.slice(1), expectedRecent);
  assert.ok(input.rollingSummary);
  assert.equal(input.toolSummaries.length, 0);
});

test('ContextManager emits structured rolling summary and system addendum for older turns', () => {
  const manager = new ContextManager();
  const history = createHistory(11);
  // Long turns: the shrink guard reverts compression when the summary would
  // cost as much as the turns it replaces, so the span must be worth summing.
  history[0] = {
    role: 'user',
    content: `Build only v1 context manager. Do not add pinned facts. Keep it bounded? ${'Scope note. '.repeat(48)}`,
  };
  history[1] = {
    role: 'assistant',
    content: `Decision: ship deterministic summarization first. Constraint: no DB schema changes. ${'Design note. '.repeat(48)}`,
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
  assert.match(input.systemContextAddendum!, /Another language model started to solve this problem/);
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

  // Kept turns plus the handoff message that leads them.
  assert.equal(standard.recentMessages.length, 21);
  assert.equal(aggressive.recentMessages.length, 13);
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

  // Still exactly the turn-count split: the budget only ever tightens. The
  // handoff message leads the kept slice.
  assert.equal(bounded.recentMessages.length, history.slice(4).length + 1);
  assert.match(String(bounded.recentMessages[0].content), /Another language model started/);
  assert.deepEqual(bounded.recentMessages.slice(1), history.slice(4));
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

function createFakeSummaryStore() {
  const rows = new Map<string, ConversationSummaryRecord>();
  const upserts: Array<{ conversationId: string; source: string; status: string }> = [];

  return {
    rows,
    upserts,
    get: (conversationId: string) => rows.get(conversationId) ?? null,
    upsert: (input: {
      conversationId: string;
      fingerprint: string;
      rollingSummary: string;
      source: 'heuristic' | 'model';
      status: 'ready' | 'building';
    }) => {
      upserts.push({ conversationId: input.conversationId, source: input.source, status: input.status });
      const record: ConversationSummaryRecord = {
        conversationId: input.conversationId,
        fingerprint: input.fingerprint,
        rollingSummary: input.rollingSummary,
        source: input.source,
        status: input.status,
        updatedAt: new Date().toISOString(),
      };
      rows.set(input.conversationId, record);
      return record;
    },
  };
}

test('a fresh heuristic summary is written through to the durable store', () => {
  const store = createFakeSummaryStore();
  const manager = new ContextManager({}, store);

  manager.buildModelInput({
    conversationId: 'conversation-persist',
    history: createHistory(12),
    mode: 'standard',
  });

  assert.equal(store.upserts.length, 1);
  assert.deepEqual(store.upserts[0], {
    conversationId: 'conversation-persist',
    source: 'heuristic',
    status: 'ready',
  });
  const row = store.get('conversation-persist');
  assert.ok(row);
  assert.match(row.rollingSummary, /Goals:/);
});

test('a matching ready store row serves the summary without recomputing', () => {
  const store = createFakeSummaryStore();
  const seeder = new ContextManager({}, store);
  const history = createHistory(12);

  seeder.buildModelInput({ conversationId: 'conversation-store-hit', history, mode: 'standard' });
  const seeded = store.get('conversation-store-hit');
  assert.ok(seeded);
  // Simulate a model upgrade landing in the store after the heuristic write.
  store.upsert({
    conversationId: 'conversation-store-hit',
    fingerprint: seeded.fingerprint,
    rollingSummary: 'Goals:\n- model-written summary marker',
    source: 'model',
    status: 'ready',
  });

  // A fresh manager has an empty memory cache, so this build must hit the store.
  const refreshes: string[] = [];
  const manager = new ContextManager({ onSummaryRefresh: (id) => refreshes.push(id) }, store);
  const upsertsBeforeHit = store.upserts.length;
  const input = manager.buildModelInput({
    conversationId: 'conversation-store-hit',
    history,
    mode: 'standard',
  });

  assert.match(input.rollingSummary ?? '', /model-written summary marker/);
  assert.equal(refreshes.length, 0, 'a store hit must not trigger a refresh');
  assert.equal(store.upserts.length, upsertsBeforeHit, 'a store hit must not be rewritten');
});

test('a store row with a stale fingerprint is ignored and recomputed', () => {
  const store = createFakeSummaryStore();
  store.rows.set('conversation-stale', {
    conversationId: 'conversation-stale',
    fingerprint: 'fingerprint-from-another-lifetime',
    rollingSummary: 'Goals:\n- stale content',
    source: 'model',
    status: 'ready',
    updatedAt: new Date().toISOString(),
  });

  const manager = new ContextManager({}, store);
  const input = manager.buildModelInput({
    conversationId: 'conversation-stale',
    history: createHistory(12),
    mode: 'standard',
  });

  assert.ok(input.rollingSummary);
  assert.ok(!input.rollingSummary!.includes('stale content'));
  // The recomputed heuristic replaced the stale row.
  const row = store.get('conversation-stale');
  assert.ok(row);
  assert.equal(row.source, 'heuristic');
  assert.notEqual(row.fingerprint, 'fingerprint-from-another-lifetime');
});

test('a store row stuck in building is treated as absent', () => {
  const store = createFakeSummaryStore();
  store.rows.set('conversation-building', {
    conversationId: 'conversation-building',
    fingerprint: 'does-not-matter',
    rollingSummary: 'Goals:\n- half-written',
    source: 'model',
    status: 'building',
    updatedAt: new Date().toISOString(),
  });

  const manager = new ContextManager({}, store);
  const input = manager.buildModelInput({
    conversationId: 'conversation-building',
    history: createHistory(12),
    mode: 'standard',
  });

  assert.ok(input.rollingSummary);
  assert.ok(!input.rollingSummary!.includes('half-written'));
  const row = store.get('conversation-building');
  assert.ok(row);
  assert.equal(row.status, 'ready', 'the crash lock is replaced by a fresh ready row');
});

test('the memory cache evicts least-recently-built conversations beyond the cap', () => {
  const refreshes: string[] = [];
  const manager = new ContextManager({ onSummaryRefresh: (id) => refreshes.push(id) });
  const history = createHistory(12);

  // Fill past the 50-conversation cap, then touch the first conversation again.
  for (let index = 0; index < 51; index += 1) {
    manager.buildModelInput({ conversationId: `conversation-${index}`, history, mode: 'standard' });
  }
  assert.equal(refreshes.length, 51);

  // conversation-0 was evicted, so its summary is recomputed (a refresh fires).
  manager.buildModelInput({ conversationId: 'conversation-0', history, mode: 'standard' });
  assert.equal(refreshes.length, 52);

  // conversation-50 is still cached, so no refresh fires.
  manager.buildModelInput({ conversationId: 'conversation-50', history, mode: 'standard' });
  assert.equal(refreshes.length, 52);
});

test('maximal mode keeps only the newest turn raw', () => {
  const manager = new ContextManager();
  const history = createHistory(12);

  const input = manager.buildModelInput({
    conversationId: 'conversation-maximal',
    history,
    mode: 'maximal',
  });

  assert.equal(input.recentMessages.length, 3, 'one handoff message plus the newest turn (user + follow-up)');
  assert.equal(input.usage.keptTurnCount, 1);
  assert.equal(input.usage.droppedTurnCount, 11);
  assert.ok(input.systemContextAddendum);
  assert.ok(input.systemContextAddendum!.length <= 1_600);
});

test('compaction never splits a tool call from its result', () => {
  const manager = new ContextManager();
  const history: ModelMessage[] = [];
  for (let index = 0; index < 12; index += 1) {
    history.push({ role: 'user', content: `Request ${index}?` });
    history.push({
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: `call-${index}`, toolName: 'bash', input: { command: `cmd ${index}` } },
      ],
    } as unknown as ModelMessage);
    history.push({
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: `call-${index}`, toolName: 'bash', output: { result: `output ${index}` } },
      ],
    } as unknown as ModelMessage);
  }

  for (const mode of ['standard', 'aggressive', 'maximal'] as const) {
    const input = manager.buildModelInput({
      conversationId: `conversation-pairing-${mode}`,
      history,
      mode,
    });

    const callIds = new Set<string>();
    const resultIds = new Set<string>();
    for (const message of input.recentMessages) {
      const content = (message as { content?: unknown }).content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const part of content) {
        const record = part as { type?: string; toolCallId?: string };
        if (record.type === 'tool-call' && record.toolCallId) {
          callIds.add(record.toolCallId);
        }
        if (record.type === 'tool-result' && record.toolCallId) {
          resultIds.add(record.toolCallId);
        }
      }
    }

    // Every retained call has its result and vice versa — turns move whole.
    assert.deepEqual([...callIds].sort(), [...resultIds].sort(), `pairing broken in ${mode}`);
  }
});

test('the handoff message is byte-stable across consecutive builds with unchanged older turns', () => {
  // This is the prefix-cache guarantee: while the compaction boundary and the
  // mode hold, the handoff must serialize identically so the provider caches
  // everything above it instead of re-reading the whole conversation.
  const manager = new ContextManager();
  const history = createHistory(12);

  const first = manager.buildModelInput({ conversationId: 'conversation-stable', history, mode: 'standard' });
  const second = manager.buildModelInput({ conversationId: 'conversation-stable', history, mode: 'standard' });

  assert.equal(first.recentMessages[0].role, 'user');
  assert.equal(
    JSON.stringify(first.recentMessages[0]),
    JSON.stringify(second.recentMessages[0])
  );
});

test('appending turns does not move a sticky compaction boundary', () => {
  const manager = new ContextManager();
  const history = createHistory(12);
  const first = manager.buildModelInput({ conversationId: 'conversation-sticky', history, mode: 'standard' });
  assert.equal(first.usage.keptTurnCount, 10);

  // Two more turns arrive. The sliding-ceiling behaviour would compress one
  // more turn and rewrite the handoff every time; the sticky boundary keeps
  // the split frozen so the request prefix stays cacheable.
  const second = manager.buildModelInput({
    conversationId: 'conversation-sticky',
    history: [...history, ...createTurn(12), ...createTurn(13)],
    mode: 'standard',
  });

  assert.equal(
    JSON.stringify(second.recentMessages[0]),
    JSON.stringify(first.recentMessages[0]),
    'handoff bytes must be identical across turns',
  );
  assert.equal(second.usage.keptTurnCount, 12);
});

test('the sticky boundary survives a mode detour and resumes unchanged', () => {
  const manager = new ContextManager();
  const history = createHistory(12);
  const conversationId = 'conversation-detour';

  manager.buildModelInput({ conversationId, history, mode: 'standard' });

  // A retry ladder escalation switches mode and recomputes from scratch…
  const aggressive = manager.buildModelInput({ conversationId, history, mode: 'aggressive' });
  assert.equal(aggressive.usage.keptTurnCount, 6);

  // …but going back to standard picks up the ORIGINAL sticky boundary, not a
  // fresh cost computation — the bytes the provider cached are still valid.
  const back = manager.buildModelInput({
    conversationId,
    history: [...history, ...createTurn(12)],
    mode: 'standard',
  });
  assert.equal(back.usage.keptTurnCount, 11);
});

test('the boundary moves at the pressure line, before the window actually overflows', () => {
  const manager = new ContextManager();
  const history: ModelMessage[] = [];
  for (let index = 0; index < 6; index += 1) {
    history.push(
      { role: 'user', content: `Question ${index}? ${'context '.repeat(400)}` },
      { role: 'assistant', content: `Answer ${index}. ${'detail '.repeat(400)}` }
    );
  }

  // Room for everything with 20% to spare: the pressure line (85%) is not
  // crossed, so the turn-count ceiling alone decides — nothing is dropped.
  const roomy = manager.buildModelInput({
    conversationId: 'conversation-pressure-roomy',
    history,
    mode: 'standard',
    budget: { totalTokens: 15_000, reservedTokens: 500 },
  });
  assert.equal(roomy.usage.droppedTurnCount, 0);
  assert.equal(roomy.usage.fitsBudget, true);

  // Same shape, but the kept slice lands between the pressure line and the
  // wall: compaction fires even though the request still fits.
  const tight = manager.buildModelInput({
    conversationId: 'conversation-pressure-tight',
    history,
    mode: 'standard',
    budget: { totalTokens: 8_000, reservedTokens: 500 },
  });
  assert.ok(tight.usage.droppedTurnCount > 0, 'pressure alone must move the boundary');
  assert.equal(tight.usage.fitsBudget, true, 'and the compressed request still fits');
});

test('the shrink guard reverts compression that would not shrink anything', () => {
  const manager = new ContextManager();
  // Tiny turns: any summary — with its fixed preamble — costs more than the
  // turns it would replace.
  const history = [
    { role: 'user', content: 'hi?' },
    { role: 'assistant', content: 'hello.' },
    { role: 'user', content: 'still there?' },
    { role: 'assistant', content: 'yes.' },
    { role: 'user', content: 'now the real question: explain the whole system?' },
    { role: 'assistant', content: 'ok.' },
  ] as ModelMessage[];

  const result = manager.buildModelInput({
    conversationId: 'conversation-shrink-guard',
    history,
    mode: 'standard',
    budget: { totalTokens: 600, reservedTokens: 100 },
  });

  assert.equal(result.systemContextAddendum, null, 'no summary is built');
  assert.equal(result.usage.droppedTurnCount, 0, 'the raw turns are sent instead');
  assert.equal(result.recentMessages.length, history.length);
});

test('turn snapshots land after their user message and rebuild byte-identically', () => {
  const manager = new ContextManager();
  const history = createHistory(6);
  const snapshotFor = (text: string) =>
    text.includes('turn 0') || text.includes('turn 3') ? `<invoked_plugins>for: ${text.slice(0, 24)}</invoked_plugins>` : null;

  const first = manager.buildModelInput({
    conversationId: 'conversation-snap',
    history,
    mode: 'standard',
    turnSnapshot: snapshotFor,
  });
  const second = manager.buildModelInput({
    conversationId: 'conversation-snap',
    history,
    mode: 'standard',
    turnSnapshot: snapshotFor,
  });

  assert.deepEqual(first.recentMessages, second.recentMessages, 'rebuild is byte-identical');

  const wire = first.recentMessages;
  for (let index = 0; index < wire.length; index += 1) {
    if (typeof wire[index].content === 'string' && String(wire[index].content).startsWith('<invoked_plugins>')) {
      assert.equal(wire[index - 1].role, 'user', 'snapshot follows its own turn user message');
      assert.equal(wire[index + 1].role, 'assistant', 'snapshot precedes the reply');
    }
  }
});

test('snapshots stay put as history grows and vanish with compacted turns', () => {
  const manager = new ContextManager();
  const snapshotFor = (text: string) => (text.includes('turn 1') ? `<invoked_plugins>t1</invoked_plugins>` : null);
  const before = manager.buildModelInput({
    conversationId: 'conversation-sticky-snap',
    history: createHistory(8),
    mode: 'standard',
    turnSnapshot: snapshotFor,
  });

  const grown = [...createHistory(8), ...createTurn(8)];
  const after = manager.buildModelInput({
    conversationId: 'conversation-sticky-snap',
    history: grown,
    mode: 'standard',
    turnSnapshot: snapshotFor,
  });

  // The t1 snapshot keeps its exact bytes and position prefix while newer
  // turns append — nothing mid-history moved, so the provider's cache holds.
  const beforeIdx = before.recentMessages.findIndex(
    (message) => typeof message.content === 'string' && message.content === '<invoked_plugins>t1</invoked_plugins>'
  );
  const afterIdx = after.recentMessages.findIndex(
    (message) => typeof message.content === 'string' && message.content === '<invoked_plugins>t1</invoked_plugins>'
  );
  assert.ok(beforeIdx > 0 && afterIdx === beforeIdx, 'existing snapshot position is frozen');
  assert.deepEqual(
    after.recentMessages.slice(0, afterIdx + 1),
    before.recentMessages.slice(0, beforeIdx + 1),
    'prefix through the snapshot is unchanged'
  );
});

test('mention-free turns contribute no snapshot bytes', () => {
  const manager = new ContextManager();
  const history = createHistory(4);
  const plain = manager.buildModelInput({ conversationId: 'c', history, mode: 'standard' });
  const withNullSnapshots = manager.buildModelInput({
    conversationId: 'c',
    history,
    mode: 'standard',
    turnSnapshot: () => null,
  });
  assert.deepEqual(withNullSnapshots.recentMessages, plain.recentMessages);
});

test('ten-turn session grows the request as a pure prefix extension', () => {
  // The property a provider's prompt cache keys on: each turn's request must
  // contain the previous turn's request as an exact byte prefix. Anything that
  // mutates an earlier message — or inserts before it — re-reads the whole
  // conversation at full price. A generous budget keeps the sticky boundary
  // frozen, so the only thing allowed to happen is appending.
  const manager = new ContextManager();
  const snapshotFor = (text: string) =>
    text.includes('@github') ? `<invoked_plugins>scope: github</invoked_plugins>` : null;

  const history: ModelMessage[] = [];
  let previous: ModelMessage[] | null = null;

  for (let index = 0; index < 10; index += 1) {
    const turn = createTurn(index);
    if (index === 3 || index === 7) {
      turn[0] = { role: 'user', content: `${String(turn[0].content)} (@github review the diff please)` };
    }
    history.push(...turn);

    const build = manager.buildModelInput({
      conversationId: 'cache-simulation',
      history,
      mode: 'standard',
      budget: { totalTokens: 200_000, reservedTokens: 2_000 },
      turnSnapshot: snapshotFor,
    });

    if (previous) {
      assert.ok(
        build.recentMessages.length > previous.length,
        `turn ${index} must strictly grow the request`
      );
      previous.forEach((message, offset) => {
        assert.deepEqual(
          build.recentMessages[offset],
          message,
          `turn ${index} mutated position ${offset}; the cache re-keys from there`
        );
      });
    }

    previous = [...build.recentMessages];
  }

  // And the mentioned turns really did carry their snapshots.
  const snapshotCount = previous?.filter(
    (message) => typeof message.content === 'string' && message.content.startsWith('<invoked_plugins>')
  ).length;
  assert.equal(snapshotCount, 2);
});
