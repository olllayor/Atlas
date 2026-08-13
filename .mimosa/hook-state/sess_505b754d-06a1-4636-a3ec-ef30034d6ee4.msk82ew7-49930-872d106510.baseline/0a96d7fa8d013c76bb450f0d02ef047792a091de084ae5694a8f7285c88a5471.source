import assert from 'node:assert/strict';
import test from 'node:test';

import type { RuntimeEventEnvelope, RuntimeTaskUsage, WorkLogEntry } from '../src/shared/contracts.js';
import {
  classifyTaskAgentKind,
  deriveWorkLogEntry,
  getWorkLogAgentKind,
  getWorkLogEntryId,
} from '../src/shared/runtimeActivity.js';

let sequenceCounter = 0;

/**
 * A `task.*` envelope with sane defaults. Every field a test cares about is
 * an override; everything else is filler that keeps the envelope valid.
 */
function makeTaskEvent(overrides: Partial<RuntimeEventEnvelope> = {}): RuntimeEventEnvelope {
  sequenceCounter += 1;
  const base: RuntimeEventEnvelope = {
    eventId: `event-${sequenceCounter}`,
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    requestId: 'request-1',
    sequence: sequenceCounter,
    occurredAt: new Date(sequenceCounter * 1000).toISOString(),
    activityType: 'task.progress',
    tone: 'info',
    provider: 'system',
    payload: { taskId: 'task-1' },
  };

  return {
    ...base,
    ...overrides,
    payload: { ...base.payload, ...(overrides.payload ?? {}) },
  };
}

/**
 * Mirrors `RuntimeStateRepo.projectEvent`'s upsert-by-id loop without a
 * database: look the row up by `getWorkLogEntryId`, fold the new event onto
 * whatever is there, write it back. This is what turns "N events" into "at
 * most N work-log rows, usually far fewer" in production.
 */
function fold(events: RuntimeEventEnvelope[]): Map<string, WorkLogEntry> {
  const store = new Map<string, WorkLogEntry>();
  for (const event of events) {
    const id = getWorkLogEntryId(event);
    const next = deriveWorkLogEntry(store.get(id) ?? null, event);
    if (next) {
      store.set(id, next);
    }
  }
  return store;
}

test('four task.* events for one taskId collapse onto one work-log row', () => {
  const events = [
    makeTaskEvent({ activityType: 'task.started', payload: { title: 'Research the API' } }),
    makeTaskEvent({ activityType: 'task.progress', payload: { summary: 'Reading docs' } }),
    makeTaskEvent({ activityType: 'task.updated', payload: { status: 'waiting' } }),
    makeTaskEvent({ activityType: 'task.completed', payload: { status: 'completed' } }),
  ];

  const store = fold(events);

  assert.equal(store.size, 1);
  const entry = store.get('task:task-1');
  assert.ok(entry);
  assert.equal(entry?.title, 'Research the API');
  assert.equal(entry?.status, 'completed');
  assert.equal(entry?.isFinal, true);
});

test('200 progress ticks for one task produce exactly one row', () => {
  const events: RuntimeEventEnvelope[] = [];
  for (let i = 0; i < 200; i += 1) {
    events.push(
      makeTaskEvent({
        activityType: 'task.progress',
        payload: { taskId: 'flood-task', summary: `tick ${i}`, usage: { totalTokens: i } },
      }),
    );
  }

  const store = fold(events);

  assert.equal(store.size, 1);
  const entry = store.get('task:flood-task');
  const usage = entry?.payload?.usage as RuntimeTaskUsage | undefined;
  assert.equal(usage?.totalTokens, 199);
});

test('task.completed with no preceding task.started still yields a coherent row', () => {
  const event = makeTaskEvent({
    activityType: 'task.completed',
    payload: { taskId: 'orphan-task', status: 'completed', title: 'Orphan task' },
  });

  const entry = deriveWorkLogEntry(null, event);

  assert.ok(entry);
  assert.equal(entry?.id, 'task:orphan-task');
  assert.equal(entry?.title, 'Orphan task');
  assert.equal(entry?.status, 'completed');
  assert.equal(entry?.isFinal, true);
  assert.equal(entry?.createdAt, event.occurredAt);
});

test('task.completed with non-completed status uses mapTaskStatus rather than defaulting to completed', () => {
  const eventFailed = makeTaskEvent({
    activityType: 'task.completed',
    payload: { taskId: 'failed-task', status: 'failed', title: 'Failed task' },
  });
  const entryFailed = deriveWorkLogEntry(null, eventFailed);
  assert.ok(entryFailed);
  assert.equal(entryFailed?.status, 'error');
  assert.equal(entryFailed?.isFinal, true);

  const eventCancelled = makeTaskEvent({
    activityType: 'task.completed',
    payload: { taskId: 'cancelled-task', status: 'cancelled', title: 'Cancelled task' },
  });
  const entryCancelled = deriveWorkLogEntry(null, eventCancelled);
  assert.ok(entryCancelled);
  assert.equal(entryCancelled?.status, 'error');
  assert.equal(entryCancelled?.isFinal, true);
});

test('a late task.started after task.completed fills metadata but never resets status or createdAt', () => {
  const completedEvent = makeTaskEvent({
    activityType: 'task.completed',
    payload: { taskId: 'late-start-task', status: 'completed' },
  });
  const completedEntry = deriveWorkLogEntry(null, completedEvent);
  assert.ok(completedEntry);

  // Simulates a start row that aged out of retention and only now resurfaces,
  // after the task has already been folded to completion.
  const lateStartEvent = makeTaskEvent({
    activityType: 'task.started',
    payload: { taskId: 'late-start-task', title: 'Backfilled title', model: 'gpt-5' },
  });
  const merged = deriveWorkLogEntry(completedEntry, lateStartEvent);

  assert.ok(merged);
  assert.equal(merged?.status, 'completed');
  assert.equal(merged?.isFinal, true);
  assert.equal(merged?.createdAt, completedEntry?.createdAt);
  // The metadata it carried that was previously unknown is still filled in.
  assert.equal(merged?.title, 'Backfilled title');
  assert.equal(merged?.payload?.model, 'gpt-5');
});

test('a terminal payload carrying only totalTokens preserves an earlier inputTokens', () => {
  const startedEvent = makeTaskEvent({
    activityType: 'task.started',
    payload: { taskId: 'usage-task', usage: { totalTokens: 100, inputTokens: 60 } },
  });
  const startedEntry = deriveWorkLogEntry(null, startedEvent);

  const completedEvent = makeTaskEvent({
    activityType: 'task.completed',
    payload: { taskId: 'usage-task', status: 'completed', usage: { totalTokens: 150 } },
  });
  const completedEntry = deriveWorkLogEntry(startedEntry, completedEvent);

  assert.ok(completedEntry);
  const usage = completedEntry?.payload?.usage as RuntimeTaskUsage | undefined;
  assert.equal(usage?.totalTokens, 150);
  assert.equal(usage?.inputTokens, 60);
});

test('classifyTaskAgentKind denylists known background types and fails open on unknown ones', () => {
  assert.equal(classifyTaskAgentKind({ taskType: 'some_brand_new_agent_flavour' }), 'agent');
  assert.equal(classifyTaskAgentKind({ taskType: 'shell' }), 'background');
  assert.equal(classifyTaskAgentKind({ agentId: 'agent-1', taskType: 'shell' }), 'background');
  // Nested but agent-flavoured: stays in the roster rather than being folded
  // into "internal work" just because it has a parent.
  assert.equal(classifyTaskAgentKind({ agentId: 'agent-1', taskType: 'subagent' }), 'agent');
});

test('a work-log row with no agentKind stamp is treated as background', () => {
  assert.equal(getWorkLogAgentKind({ payload: null }), 'background');
  assert.equal(getWorkLogAgentKind({ payload: {} }), 'background');
  assert.equal(getWorkLogAgentKind({ payload: { agentKind: 'agent' } }), 'agent');
  assert.equal(getWorkLogAgentKind({ payload: { agentKind: 'something-unexpected' } }), 'background');
});
