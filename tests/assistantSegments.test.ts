import assert from 'node:assert/strict';
import test from 'node:test';

import {
  groupAssistantParts,
  hasPendingApproval,
  mergeActivitySegments,
  shouldOpenActivityFold,
  shouldShowFailedToolThinkingFallback,
  splitAssistantTurn,
} from '../src/renderer/components/transcript/assistantSegments.js';
import type { ChatMessagePart, ChatReasoningPart, ChatToolPart, ChatToolState } from '../src/shared/contracts.js';

function toolPart(id: string, toolName: string): ChatToolPart {
  return {
    id,
    type: 'tool',
    toolCallId: id,
    toolName,
    state: 'output-available',
  };
}

function toolPartWithState(id: string, toolName: string, state: ChatToolState): ChatToolPart {
  return { ...toolPart(id, toolName), state };
}

function failedThinkingFallback(parts: ChatMessagePart[], isStreaming: boolean): boolean {
  const split = splitAssistantTurn(groupAssistantParts(parts));
  return shouldShowFailedToolThinkingFallback({
    activity: mergeActivitySegments(split.activity),
    isStreaming,
  });
}

function textPart(id: string, text: string): ChatMessagePart {
  return { id, type: 'text', text, state: 'complete' } as ChatMessagePart;
}

function reasoningPart(id: string, text: string, state: ChatReasoningPart['state'] = 'done'): ChatMessagePart {
  return { id, type: 'reasoning', text, state } as ChatMessagePart;
}

test('every update_plan call folds into one segment anchored at the first', () => {
  const segments = groupAssistantParts([
    textPart('t1', 'Here is the plan.'),
    toolPart('p1', 'update_plan'),
    toolPart('b1', 'bash'),
    toolPart('p2', 'update_plan'),
    textPart('t2', 'Done.'),
  ]);

  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ['part', 'plan', 'tools', 'part']
  );

  const plan = segments[1];
  assert.equal(plan.kind, 'plan');
  if (plan.kind !== 'plan') return;
  assert.deepEqual(
    plan.parts.map((part) => part.id),
    ['p1', 'p2'],
    'the second call joins the first call’s cell rather than opening a new one'
  );

  const tools = segments[2];
  assert.equal(tools.kind, 'tools');
  if (tools.kind !== 'tools') return;
  assert.deepEqual(
    tools.parts.map((part) => part.id),
    ['b1'],
    'plan parts must not also appear as generic tool cells'
  );
});

test('the turn folds its work and leaves the reply outside it', () => {
  const split = splitAssistantTurn(
    groupAssistantParts([
      textPart('t1', 'Let me look that up.'),
      toolPart('s1', 'web_search'),
      textPart('t2', 'One more search.'),
      toolPart('s2', 'web_search'),
      textPart('t3', "Here's the answer."),
    ])
  );

  assert.deepEqual(
    split.activity.map((segment) => (segment.kind === 'part' ? segment.part.id : segment.kind)),
    ['t1', 'tools', 't2', 'tools'],
    'everything up to the last tool call is work'
  );
  assert.deepEqual(
    split.answer.map((segment) => (segment.kind === 'part' ? segment.part.id : segment.kind)),
    ['t3'],
    'only the text after the last tool call is the reply'
  );
});

test('a turn that never called a tool folds nothing', () => {
  const split = splitAssistantTurn(groupAssistantParts([textPart('t1', 'Sure.')]));

  assert.equal(split.activity.length, 0);
  assert.deepEqual(
    split.answer.map((segment) => (segment.kind === 'part' ? segment.part.id : segment.kind)),
    ['t1']
  );
});

test('thinking without tools stays inline rather than nesting two folds', () => {
  const split = splitAssistantTurn(
    groupAssistantParts([
      { id: 'r1', type: 'reasoning', text: 'Thinking.', state: 'done' } as ChatMessagePart,
      textPart('t1', 'Here you go.'),
    ])
  );

  assert.equal(split.activity.length, 0, '`Thought for 8s` is already its own summary row');
  assert.deepEqual(
    split.answer.map((segment) => (segment.kind === 'part' ? segment.part.id : segment.kind)),
    ['r1', 't1']
  );
});

test('plans stay outside the fold, and reasoning counts as work', () => {
  const split = splitAssistantTurn(
    groupAssistantParts([
      { id: 'r1', type: 'reasoning', text: 'Thinking.', state: 'done' } as ChatMessagePart,
      toolPart('p1', 'update_plan'),
      toolPart('b1', 'bash'),
      textPart('t1', 'Done.'),
    ])
  );

  assert.deepEqual(split.plan.length, 1, 'the checklist is not hidden behind the disclosure');
  assert.deepEqual(
    split.activity.map((segment) => (segment.kind === 'part' ? segment.part.id : segment.kind)),
    ['r1', 'tools']
  );
  assert.deepEqual(
    split.answer.map((segment) => (segment.kind === 'part' ? segment.part.id : segment.kind)),
    ['t1']
  );
});

test('a turn waiting on approval is detected so the fold can be forced open', () => {
  const pending: ChatToolPart = { ...toolPart('b1', 'bash'), state: 'approval-requested' };
  const split = splitAssistantTurn(groupAssistantParts([textPart('t1', 'Running it.'), pending]));

  assert.equal(hasPendingApproval(split.activity), true);
  assert.equal(hasPendingApproval(splitAssistantTurn(groupAssistantParts([textPart('t1', 'Hi.')])).activity), false);
});

test('returned files stay in the reply even when a tool call follows them', () => {
  const filePart = {
    id: 'f1',
    type: 'file',
    filename: 'chart.png',
    mediaType: 'image/png',
    sizeBytes: null,
    storageKey: null,
    url: 'atlas://chart.png',
  } as ChatMessagePart;

  const split = splitAssistantTurn(groupAssistantParts([filePart, toolPart('s1', 'web_search')]));

  assert.deepEqual(
    split.answer.map((segment) => (segment.kind === 'part' ? segment.part.id : segment.kind)),
    ['f1']
  );
});

test('a turn that ends on a tool call still shows its reply outside the fold', () => {
  const split = splitAssistantTurn(
    groupAssistantParts([
      toolPart('s1', 'web_search'),
      textPart('t1', 'Let me check one file.'),
      textPart('t2', "Bottom line: here's the answer."),
      toolPart('g1', 'glob'),
    ])
  );

  assert.deepEqual(
    split.answer.map((segment) => (segment.kind === 'part' ? segment.part.id : segment.kind)),
    ['t1', 't2'],
    'the trailing call must not swallow the reply into the disclosure'
  );
  assert.deepEqual(
    split.activity.map((segment) => (segment.kind === 'part' ? segment.part.id : segment.kind)),
    ['tools', 'tools'],
    'the stray call folds in with the rest of the work'
  );
});

test('a message without a plan groups exactly as before', () => {
  const segments = groupAssistantParts([
    toolPart('r1', 'read_file'),
    toolPart('r2', 'read_file'),
    textPart('t1', 'Found it.'),
  ]);

  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ['tools', 'part']
  );
});

// ── spawn batches (Variant B) ─────────────────────────────────────────────

test('every spawn_agent call in a turn joins one batch segment', () => {
  const segments = groupAssistantParts([
    toolPart('s1', 'spawn_agent'),
    toolPart('b1', 'bash'),
    toolPart('s2', 'spawn_agent'),
    toolPart('s3', 'spawn_agent'),
  ]);

  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ['spawn', 'tools']
  );

  const spawn = segments[0];
  assert.equal(spawn.kind, 'spawn');
  if (spawn.kind !== 'spawn') return;
  assert.deepEqual(
    spawn.parts.map((part) => part.toolCallId),
    ['s1', 's2', 's3']
  );
});

test('a spawn batch is split out of the fold, not into it', () => {
  const split = splitAssistantTurn(
    groupAssistantParts([
      toolPart('r1', 'read_file'),
      toolPart('s1', 'spawn_agent'),
      textPart('t1', 'Four agents are on it.'),
    ])
  );

  // The fleet outlives the turn, so its row cannot live inside the collapsed
  // `Worked for …` block the way the read does.
  assert.equal(split.spawn.length, 1);
  assert.deepEqual(
    split.activity.map((segment) => segment.kind),
    ['tools']
  );
  assert.deepEqual(
    split.answer.map((segment) => segment.kind),
    ['part']
  );
});

test('a turn whose only tool call is a spawn keeps its reply outside the fold', () => {
  const split = splitAssistantTurn(
    groupAssistantParts([toolPart('s1', 'spawn_agent'), textPart('t1', 'Spawned.')])
  );

  assert.equal(split.spawn.length, 1);
  assert.deepEqual(split.activity, []);
  assert.deepEqual(
    split.answer.map((segment) => segment.kind),
    ['part']
  );
});

test('a spawn waiting on approval still counts as a pending question', () => {
  const pending: ChatToolPart = { ...toolPart('s1', 'spawn_agent'), state: 'approval-requested' };
  const segments = groupAssistantParts([pending]);
  assert.equal(hasPendingApproval(segments), true);
});

// ── merged activity runs (one Thought row per turn) ───────────────────────

test('alternating reasoning and tool steps merge into one run each', () => {
  const split = splitAssistantTurn(
    groupAssistantParts([
      reasoningPart('r1', 'First thought.'),
      toolPart('b1', 'bash'),
      reasoningPart('r1#1', 'Second thought.'),
      toolPart('b2', 'bash'),
      reasoningPart('r1#2', 'Third thought.'),
      textPart('t1', 'Done.'),
    ])
  );

  const merged = mergeActivitySegments(split.activity);
  assert.deepEqual(
    merged.map((segment) => segment.kind),
    ['reasoning', 'tools'],
    'five alternating rows become one Thought row and one tool run'
  );

  const reasoning = merged[0];
  assert.equal(reasoning.kind, 'reasoning');
  if (reasoning.kind !== 'reasoning') return;
  assert.equal(reasoning.key, 'activity-reasoning:r1');
  assert.deepEqual(reasoning.partIds, ['r1', 'r1#1', 'r1#2']);
  assert.equal(reasoning.text, 'First thought.\n\nSecond thought.\n\nThird thought.');
  assert.equal(reasoning.isStreaming, false);

  const tools = merged[1];
  assert.equal(tools.kind, 'tools');
  if (tools.kind !== 'tools') return;
  assert.equal(tools.key, 'activity-tools:b1');
  assert.deepEqual(
    tools.parts.map((part) => part.toolCallId),
    ['b1', 'b2'],
    'tool order is preserved for the summary grammar'
  );
});

test('a run closes at commentary so later work renders below it', () => {
  const split = splitAssistantTurn(
    groupAssistantParts([
      textPart('t1', 'Let me look that up.'),
      toolPart('s1', 'web_search'),
      textPart('t2', 'One more search.'),
      toolPart('s2', 'web_search'),
      textPart('t3', "Here's the answer."),
    ])
  );

  const merged = mergeActivitySegments(split.activity);
  assert.deepEqual(
    merged.map((segment) => (segment.kind === 'part' ? segment.part.id : segment.kind)),
    ['t1', 'tools', 't2', 'tools'],
    'the second search ran after the comment and renders after it'
  );

  // The property the live log depends on: the last row is the newest work.
  const lastRun = merged[merged.length - 1];
  assert.equal(lastRun?.kind, 'tools');
  if (lastRun?.kind !== 'tools') return;
  assert.deepEqual(lastRun.parts.map((part) => part.toolCallId), ['s2']);
});

test('a streaming reasoning part keeps the merged run live', () => {
  const split = splitAssistantTurn(
    groupAssistantParts([
      reasoningPart('r1', 'Done thinking.', 'done'),
      toolPart('b1', 'bash'),
      reasoningPart('r1#1', 'Still thinking…', 'streaming'),
      textPart('t1', 'Done.'),
    ])
  );

  const merged = mergeActivitySegments(split.activity);
  const reasoning = merged.find((segment) => segment.kind === 'reasoning');
  assert.equal(reasoning?.kind, 'reasoning');
  if (reasoning?.kind !== 'reasoning') return;
  assert.equal(reasoning.isStreaming, true);
});

test('merging an empty activity is a no-op', () => {
  assert.deepEqual(mergeActivitySegments([]), []);
});

test('the work fold stays open for the whole live run', () => {
  // The turn the screenshot caught: tools, a sentence of commentary, more
  // tools. `splitAssistantTurn` calls that sentence the answer and keeps
  // calling it that, so keying the fold on it alone hid every later step.
  const parts = [
    toolPart('t1', 'read_file'),
    textPart('m1', 'Found one real issue. Let me check the remaining views.'),
    toolPart('t2', 'read_file'),
  ];
  const split = splitAssistantTurn(groupAssistantParts(parts));
  assert.equal(split.answer.length, 1);
  assert.equal(
    shouldOpenActivityFold({ isStreaming: true, hasAnswer: split.answer.length > 0 }),
    true
  );
});

test('the work fold closes itself once the turn settles on an answer', () => {
  assert.equal(shouldOpenActivityFold({ isStreaming: false, hasAnswer: true }), false);
});

test('the work fold stays open on a turn that ended without a reply', () => {
  assert.equal(shouldOpenActivityFold({ isStreaming: false, hasAnswer: false }), true);
});

// ── failed-tool thinking fallback (t3code PR #9165, adapted) ───────────────
// Upstream replaces a terminal failed live row with Thinking; Atlas keeps the
// failed cells and appends one shimmer row while the turn keeps streaming.

test('a failed latest tool appends thinking while the turn keeps streaming', () => {
  assert.equal(
    failedThinkingFallback(
      [reasoningPart('r1', 'Checking.'), toolPartWithState('b1', 'bash', 'output-error')],
      true
    ),
    true
  );
});

test('a denied tool counts as failed for the thinking fallback', () => {
  assert.equal(
    failedThinkingFallback([toolPartWithState('b1', 'bash', 'output-denied')], true),
    true
  );
});

test('a settled turn never shows the failed-tool thinking fallback', () => {
  assert.equal(
    failedThinkingFallback([toolPartWithState('b1', 'bash', 'output-error')], false),
    false
  );
});

test('a running tool keeps the live indicator instead of thinking', () => {
  // Second commit in the PR: an in-progress tool (even one whose partial
  // detail mentions an exit code upstream) preserves running activity.
  assert.equal(
    failedThinkingFallback(
      [
        toolPartWithState('b1', 'bash', 'output-error'),
        toolPartWithState('b2', 'bash', 'output-partial'),
      ],
      true
    ),
    false
  );
  assert.equal(
    failedThinkingFallback([toolPartWithState('b1', 'bash', 'input-available')], true),
    false
  );
});

test('a successful latest tool does not append thinking', () => {
  assert.equal(
    failedThinkingFallback(
      [
        toolPartWithState('b1', 'bash', 'output-error'),
        toolPartWithState('b2', 'bash', 'output-available'),
      ],
      true
    ),
    false
  );
});

test('streaming reasoning already owns the live indicator', () => {
  assert.equal(
    failedThinkingFallback(
      [
        toolPartWithState('b1', 'bash', 'output-error'),
        reasoningPart('r1', 'Retrying…', 'streaming'),
      ],
      true
    ),
    false
  );
});

test('an approval prompt suppresses the failed-tool thinking fallback', () => {
  assert.equal(
    failedThinkingFallback(
      [
        toolPartWithState('b1', 'bash', 'output-error'),
        toolPartWithState('b2', 'bash', 'approval-requested'),
      ],
      true
    ),
    false
  );
});

test('no tools means no failed-tool thinking fallback', () => {
  assert.equal(failedThinkingFallback([reasoningPart('r1', 'Thinking.'), textPart('t1', 'Hi.')], true), false);
  assert.equal(failedThinkingFallback([], true), false);
});
