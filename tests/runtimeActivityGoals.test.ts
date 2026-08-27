import assert from 'node:assert/strict';
import test from 'node:test';

import type { RuntimeEventEnvelope, WorkLogEntry } from '../src/shared/contracts.js';
import { deriveWorkLogEntry, getWorkLogEntryId } from '../src/shared/runtimeActivity.js';

let sequenceCounter = 0;

function makeGoalEvent(
  activityType: RuntimeEventEnvelope['activityType'],
  payload: Record<string, unknown> = {},
): RuntimeEventEnvelope {
  sequenceCounter += 1;
  return {
    eventId: `event-${sequenceCounter}`,
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    requestId: 'request-1',
    sequence: sequenceCounter,
    occurredAt: new Date(sequenceCounter * 1000).toISOString(),
    activityType,
    tone: 'info',
    provider: 'system',
    payload,
  };
}

test('goal lifecycle events fold into visible transcript rows', () => {
  const created = deriveWorkLogEntry(null, makeGoalEvent('goal.created', { goalId: 'g1', objectiveChars: 24 }));
  assert.equal(created?.title, 'Goal set');
  assert.equal(created?.isFinal, true);
  assert.equal(created?.status, 'completed');

  const completed = deriveWorkLogEntry(null, makeGoalEvent('goal.completed', { reason: 'tests pass' }));
  assert.equal(completed?.title, 'Goal completed');
  assert.equal(completed?.summary, 'tests pass');

  const blocked = deriveWorkLogEntry(null, makeGoalEvent('goal.blocked', { reason: 'needs a key', blockerKind: 'missing_authority' }));
  assert.equal(blocked?.title, 'Goal blocked (missing_authority)');
  assert.equal(blocked?.tone, 'error');
  assert.equal(blocked?.status, 'error');

  const stalled = deriveWorkLogEntry(null, makeGoalEvent('goal.paused', { cause: 'stalled' }));
  assert.match(stalled?.title ?? '', /stalled/i);

  const userPaused = deriveWorkLogEntry(null, makeGoalEvent('goal.paused', { cause: 'user' }));
  assert.equal(userPaused?.title, 'Goal paused');

  const cleared = deriveWorkLogEntry(null, makeGoalEvent('goal.cleared'));
  assert.equal(cleared?.title, 'Goal cleared');
});

test('per-turn goal noise stays out of the transcript', () => {
  // One row per admitted outer turn would bury the work it narrates.
  assert.equal(deriveWorkLogEntry(null, makeGoalEvent('goal.continuation.admitted')), null);
  // A mid-turn claim is superseded by its committed settle row.
  assert.equal(deriveWorkLogEntry(null, makeGoalEvent('goal.intent.requested')), null);
});

test('cap rejection renders; other rejections duplicate visible state', () => {
  const capped = deriveWorkLogEntry(null, makeGoalEvent('goal.continuation.rejected', { reason: 'turn_cap_reached' }));
  assert.equal(capped?.title, 'Goal turn cap reached');
  assert.match(capped?.summary ?? '', /resume/);

  // Aborted/steer/approval rejections restate state the UI already shows.
  assert.equal(deriveWorkLogEntry(null, makeGoalEvent('goal.continuation.rejected', { reason: 'turn_aborted' })), null);
  assert.equal(deriveWorkLogEntry(null, makeGoalEvent('goal.continuation.rejected', { reason: 'steer_queued' })), null);
});

test('every goal event gets its own stable row id', () => {
  const first = getWorkLogEntryId(makeGoalEvent('goal.created'));
  const second = getWorkLogEntryId(makeGoalEvent('goal.paused'));
  assert.notEqual(first, second);
  assert.match(first, /^activity:/);
});
