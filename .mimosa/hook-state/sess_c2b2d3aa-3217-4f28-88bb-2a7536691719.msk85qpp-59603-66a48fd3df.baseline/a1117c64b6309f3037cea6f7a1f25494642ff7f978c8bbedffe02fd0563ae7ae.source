import assert from 'node:assert/strict';
import test from 'node:test';

import { buildActivityFeed } from '../src/shared/activityFeed.js';
import type { ActivityType, WorkLogEntry } from '../src/shared/contracts.js';

/**
 * R3 — the activity-feed read-model fold over `WorkLogEntry[]`.
 *
 * The one spine is `conversation_events` → `deriveWorkLogEntry` → `WorkLogEntry`.
 * This module groups the flat list by turn and folds recurring rows for the same
 * tool call / task / approval onto one row (stable id), with sticky-terminal,
 * order-robust status semantics.
 */

function entry(partial: Partial<WorkLogEntry> & { activityType: ActivityType }): WorkLogEntry {
  const now = '2026-08-07T00:00:00.000Z';
  return {
    id: 'activity:default',
    conversationId: 'conv-1',
    turnId: 'turn-1',
    requestId: 'request-1',
    messageId: null,
    activityType: partial.activityType,
    tone: partial.activityType.startsWith('tool.') ? 'tool' : 'info',
    toolType: null,
    toolCallId: null,
    approvalId: null,
    title: '',
    summary: null,
    status: 'running',
    sequence: 1,
    isFinal: false,
    payload: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

const SERIAL = ['2026-08-07T00:00:01.000Z', '2026-08-07T00:00:02.000Z'];

test('a tool.started + tool.completed for the same call fold onto one row', () => {
  const feed = buildActivityFeed([
    entry({
      activityType: 'tool.started',
      id: 'tool:read-1',
      toolType: 'file_change',
      title: 'read',
      status: 'running',
      createdAt: SERIAL[0]!,
      updatedAt: SERIAL[0]!,
      sequence: 1,
    }),
    entry({
      activityType: 'tool.completed',
      id: 'tool:read-1',
      toolType: 'file_change',
      title: 'read',
      status: 'completed',
      isFinal: true,
      createdAt: SERIAL[0]!,
      updatedAt: SERIAL[1]!,
      sequence: 2,
    }),
  ]);

  const turn = feed[0]!;
  assert.equal(feed.length, 1);
  assert.equal(turn.rows.length, 1, 'both events collapse onto one row');
  const row = turn.rows[0]!;
  assert.equal(row.kind, 'tool');
  assert.equal(row.count, 2);
  assert.equal(row.status, 'completed');
  assert.equal(row.isFinal, true);
  assert.equal(row.firstAt, SERIAL[0]);
  assert.equal(row.lastAt, SERIAL[1], 'the terminal event advances lastAt');
  assert.equal(row.key, 'tool:read-1');
});

test('rows preserve first-seen order within a turn', () => {
  const feed = buildActivityFeed([
    entry({ activityType: 'turn.started', id: 'turn:1', status: 'running', sequence: 1 }),
    entry({ activityType: 'tool.started', id: 'tool:search-1', toolType: 'web_search', title: 'search', sequence: 2 }),
    entry({ activityType: 'tool.started', id: 'tool:edit-1', toolType: 'file_change', title: 'edit', sequence: 3 }),
  ]);

  assert.deepEqual(
    feed[0]!.rows.map((r) => r.key),
    ['turn:1', 'tool:search-1', 'tool:edit-1']
  );
});

test('entries from different turns group into separate turns', () => {
  const a = entry({ activityType: 'tool.started', id: 'tool:read-1', title: 'read', turnId: 'turn-a', sequence: 1 });
  const b = entry({ activityType: 'tool.started', id: 'tool:read-2', title: 'read', turnId: 'turn-b', sequence: 1 });

  const feed = buildActivityFeed([a, b]);
  assert.equal(feed.length, 2);
  assert.equal(feed[0]!.turnId, 'turn-a');
  assert.equal(feed[1]!.turnId, 'turn-b');
  assert.equal(feed[1]!.rows[0]!.key, 'tool:read-2');
});

test('order-robust: a terminal event with no start row still creates the row', () => {
  const feed = buildActivityFeed([
    entry({ activityType: 'tool.completed', id: 'tool:x-1', title: 'run', status: 'completed', isFinal: true, sequence: 1 }),
  ]);
  assert.equal(feed[0]!.rows.length, 1);
  assert.equal(feed[0]!.rows[0]!.status, 'completed');
});


test('order-robust: a late start row never regresses a final status', () => {
  const feed = buildActivityFeed([
    entry({ activityType: 'tool.completed', id: 'tool:x-1', title: 'run', status: 'error', isFinal: true, sequence: 1 }),
    // A start row that arrives late must only fill metadata, never resurrect.
    entry({ activityType: 'tool.started', id: 'tool:x-1', title: 'run', status: 'running', isFinal: false, sequence: 2 }),
  ]);

  const row = feed[0]!.rows[0]!;
  assert.equal(row.status, 'error', 'final status is sticky');
  assert.equal(row.isFinal, true);
  assert.equal(row.count, 2);
});

test('message and reasoning deltas are excluded from the feed', () => {
  const feed = buildActivityFeed([
    entry({ activityType: 'reasoning.delta', id: 'activity:r1', sequence: 1 }),
    entry({ activityType: 'message.delta', id: 'activity:m1', sequence: 2 }),
    entry({ activityType: 'message.completed', id: 'activity:m2', sequence: 3 }),
  ]);

  assert.equal(feed.length, 0, 'the answer stream is not feed activity');
});

test('headline falls back from title to summary to a humanized type', () => {
  const fromTitle = buildActivityFeed([
    entry({ activityType: 'task.started', id: 'task:1', title: 'Run tests', sequence: 1 }),
  ])[0]!.rows[0]!.headline;
  assert.equal(fromTitle, 'Run tests');

  const fromSummary = buildActivityFeed([
    entry({ activityType: 'tool.started', id: 'tool:grep-1', title: '', summary: 'grep for color', sequence: 1 }),
  ])[0]!.rows[0]!.headline;
  assert.equal(fromSummary, 'grep for color');

  const fromType = buildActivityFeed([
    entry({ activityType: 'tool.started', id: 'tool:wf-1', toolType: 'command_execution', title: '', summary: null, sequence: 1 }),
  ])[0]!.rows[0]!.headline;
  assert.equal(fromType, 'Command Execution');
});

test('recurring task.progress ticks fold onto the same task row', () => {
  const feed = buildActivityFeed([
    entry({ activityType: 'task.started', id: 'task:sub-1', title: 'Agent A', status: 'running', sequence: 1 }),
    entry({ activityType: 'task.progress', id: 'task:sub-1', title: 'Agent A', status: 'running', sequence: 2 }),
    entry({ activityType: 'task.completed', id: 'task:sub-1', title: 'Agent A', status: 'completed', isFinal: true, sequence: 3 }),
  ]);

  const row = feed[0]!.rows[0]!;
  assert.equal(row.kind, 'task');
  assert.equal(row.count, 3);
  assert.equal(row.status, 'completed');
});

test('approval.requested and approval.resolved fold onto one approval row', () => {
  const feed = buildActivityFeed([
    entry({ activityType: 'approval.requested', id: 'approval:appr-1', status: 'pending_approval', sequence: 1 }),
    entry({ activityType: 'approval.resolved', id: 'approval:appr-1', status: 'resolved', isFinal: true, sequence: 2 }),
  ] satisfies WorkLogEntry[]);

  const row = feed[0]!.rows[0]!;
  assert.equal(row.kind, 'approval');
  assert.equal(row.status, 'resolved');
  assert.equal(row.count, 2);
});
