import assert from 'node:assert/strict';
import test from 'node:test';

import {
  groupAssistantParts,
  hasPendingApproval,
  splitAssistantTurn,
} from '../src/renderer/components/transcript/assistantSegments.js';
import type { ChatMessagePart, ChatToolPart } from '../src/shared/contracts.js';

function toolPart(id: string, toolName: string): ChatToolPart {
  return {
    id,
    type: 'tool',
    toolCallId: id,
    toolName,
    state: 'output-available',
  };
}

function textPart(id: string, text: string): ChatMessagePart {
  return { id, type: 'text', text, state: 'complete' } as ChatMessagePart;
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
