import assert from 'node:assert/strict';
import test from 'node:test';

import {
  admitContinuation,
  GoalRuntime,
  type AdmissionContext,
  type GoalRuntimeDeps,
} from '../src/main/ai/goal/goalRuntime.js';
import type { ConversationGoalRecord, GoalStatus } from '../src/main/db/repositories/conversationGoalsRepo.js';
import { GOAL_STALL_LIMIT } from '../src/main/db/repositories/conversationGoalsRepo.js';

function base(overrides: Partial<AdmissionContext> = {}): AdmissionContext {
  return {
    goalActive: true,
    turnAborted: false,
    turnFailed: false,
    steerQueued: false,
    approvalPending: false,
    turnCount: 1,
    turnCap: 25,
    stalledTurns: 0,
    ...overrides,
  };
}

test('a healthy settled turn admits continuation', () => {
  assert.deepEqual(admitContinuation(base()), { decision: 'admit' });
});

const rejections: Array<[Partial<AdmissionContext>, string]> = [
  [{ goalActive: false }, 'goal_inactive'],
  [{ turnAborted: true }, 'turn_aborted'],
  [{ turnFailed: true }, 'turn_failed'],
  [{ steerQueued: true }, 'steer_queued'],
  [{ approvalPending: true }, 'approval_pending'],
  [{ turnCount: 25, turnCap: 25 }, 'turn_cap_reached'],
  [{ stalledTurns: 5 }, 'stalled'],
];

for (const [overrides, reason] of rejections) {
  test(`gate rejects with ${reason}`, () => {
    const verdict = admitContinuation(base(overrides));
    assert.equal(verdict.decision, 'reject');
    if (verdict.decision === 'reject') {
      assert.equal(verdict.reason, reason);
    }
  });
}

test('user-intent reasons outrank mechanical walls', () => {
  // A queued user message and an exhausted cap: the named reason must be the
  // one the user can act on (send the message), not the cap they cannot.
  const verdict = admitContinuation(base({ steerQueued: true, turnCount: 25, turnCap: 25 }));
  assert.equal(verdict.decision === 'reject' && verdict.reason, 'steer_queued');
});

test('stall boundary is exclusive at exactly GOAL_STALL_LIMIT turns', () => {
  assert.deepEqual(admitContinuation(base({ stalledTurns: 4 })), { decision: 'admit' });
});

/*
 * GoalRuntime-level admission behavior: edit semantics and the boot tick.
 * A minimal in-memory repo stands in for ConversationGoalsRepo — the CAS
 * mechanics themselves are table-tested against SQLite in conversationGoals.
 */
type FakeGoal = ConversationGoalRecord;

function makeRuntime(options: { busy?: boolean | ((conversationId: string) => boolean); approval?: boolean } = {}) {
  const history: FakeGoal[] = [];
  const live = new Map<string, FakeGoal>();
  let seq = 0;
  const enqueued: string[] = [];
  const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];

  const seed = (conversationId: string, status: GoalStatus, turns = 2): FakeGoal => {
    seq += 1;
    const goal: FakeGoal = {
      id: `goal-${seq}`,
      conversationId,
      objective: `objective ${seq}`,
      status,
      blockerKind: null,
      blockerNote: null,
      revision: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      turnCount: turns,
      turnCap: 25,
      tokensIn: 0,
      tokensOut: 0,
      lastProgressTurn: turns,
    };
    live.set(conversationId, goal);
    return goal;
  };

  const goals = {
    getActive: (conversationId: string) => live.get(conversationId) ?? null,
    getLatest: (conversationId: string) => live.get(conversationId) ?? history.filter((g) => g.conversationId === conversationId).at(-1) ?? null,
    create: (conversationId: string, objective: string): FakeGoal => {
      const previous = live.get(conversationId);
      if (previous) {
        previous.status = 'cleared';
        history.push(previous);
      }
      return { ...seed(conversationId, 'active', 0), objective };
    },
    transition: (
      goalId: string,
      expectedRevision: number,
      expectedStatus: GoalStatus,
      patch: { status?: GoalStatus; bumpTurnCount?: boolean; lastProgressTurn?: number; accountTokens?: { in: number; out: number } }
    ): boolean => {
      for (const goal of live.values()) {
        if (goal.id !== goalId || goal.revision !== expectedRevision || goal.status !== expectedStatus) continue;
        goal.revision += 1;
        if (patch.status) goal.status = patch.status;
        if (patch.bumpTurnCount) goal.turnCount += 1;
        if (patch.lastProgressTurn !== undefined) goal.lastProgressTurn = patch.lastProgressTurn;
        if (patch.accountTokens) {
          goal.tokensIn += patch.accountTokens.in;
          goal.tokensOut += patch.accountTokens.out;
        }
        return true;
      }
      return false;
    },
    updateObjective: (goalId: string, expectedRevision: number, objective: string): FakeGoal | null => {
      for (const goal of live.values()) {
        if (goal.id !== goalId || goal.revision !== expectedRevision) continue;
        goal.revision += 1;
        goal.objective = objective;
        return goal;
      }
      return null;
    },
    listLiveGoals: (): FakeGoal[] => [...live.values()].filter((g) => g.status !== 'cleared'),
  };

  const deps: GoalRuntimeDeps = {
    goals: goals as unknown as GoalRuntimeDeps['goals'],
    recordActivity: ({ activityType, payload }) => emitted.push({ type: activityType, payload }),
    randomId: (() => {
      let n = 0;
      return () => `evt-${(n += 1)}`;
    })(),
    isBusy: (conversationId) =>
      typeof options.busy === 'function' ? options.busy(conversationId) : (options.busy ?? false),
    hasPendingApproval: () => options.approval ?? false,
    enqueueContinuation: (conversationId) => enqueued.push(conversationId),
  };

  return { runtime: new GoalRuntime(deps), seed, enqueued, emitted, live };
}

test('edit rewrites the objective in place: same id, counters kept, no continuation fired', () => {
  const { runtime, seed, enqueued, emitted } = makeRuntime();
  const original = seed('conv-1', 'active', 7);
  const revisionBefore = original.revision;

  const edited = runtime.editGoal('conv-1', 'a sharper objective');

  assert.equal(edited?.id, original.id);
  assert.equal(edited?.revision, revisionBefore + 1);
  assert.equal(edited?.turnCount, 7);
  assert.equal(edited?.objective, 'a sharper objective');
  assert.equal(enqueued.length, 0);
  assert.ok(emitted.some((event) => event.type === 'goal.edited'));
  assert.equal(emitted.some((event) => event.type === 'goal.continuation.admitted'), false);
});

test('editing a paused goal keeps it paused and idle', () => {
  const { runtime, seed, enqueued } = makeRuntime();
  seed('conv-1', 'paused_user');
  const edited = runtime.editGoal('conv-1', 'still paused, new words');
  assert.equal(edited?.status, 'paused_user');
  assert.equal(enqueued.length, 0);
});

test('edit with nothing live returns null', () => {
  const { runtime } = makeRuntime();
  assert.equal(runtime.editGoal('conv-none', 'ghost'), null);
});

test('boot tick admits idle active goals only', () => {
  const { runtime, seed, enqueued } = makeRuntime({
    busy: (conversationId) => conversationId === 'conv-busy',
  });
  seed('conv-idle', 'active');
  const stalled = seed('conv-stalled', 'active', GOAL_STALL_LIMIT);
  stalled.lastProgressTurn = 0;
  seed('conv-busy', 'active');
  seed('conv-paused', 'paused_stalled');
  const capped = seed('conv-capped', 'active', 25);
  capped.turnCount = capped.turnCap;

  runtime.continueIdleGoals();

  assert.deepEqual(enqueued.sort(), ['conv-idle']);
});
