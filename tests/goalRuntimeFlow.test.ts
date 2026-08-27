import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { ConversationGoalsRepo } from '../src/main/db/repositories/conversationGoalsRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import {
  GoalRuntime,
  GOAL_CONTINUATION_STEER,
  buildGoalEnvelope,
} from '../src/main/ai/goal/goalRuntime.js';

function wrap(raw: DatabaseSync): SqliteDatabase {
  return {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction:
      <TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) =>
      (...args: TArgs) => callback(...args),
  } as unknown as SqliteDatabase;
}

type Harness = {
  runtime: GoalRuntime;
  repo: ConversationGoalsRepo;
  events: Array<{ conversationId: string; activityType: string; payload: Record<string, unknown> }>;
  continuations: string[];
  busy: (conversationId: string) => boolean;
};

function makeHarness(t: TestContext): Harness {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-goal-flow-'));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));
  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });
  const db = wrap(raw);
  applySchema(db);
  db
    .prepare(
      `INSERT INTO conversations (id, title, created_at, updated_at)
       VALUES ('conv-1', 'chat', @now, @now)`
    )
    .run({ now: new Date().toISOString() });

  const repo = new ConversationGoalsRepo(db);
  const h: Harness = {
    repo,
    events: [],
    continuations: [],
    busy: () => false,
    runtime: null as unknown as GoalRuntime,
  };
  h.runtime = new GoalRuntime({
    goals: repo,
    randomId: (() => {
      let n = 0;
      return () => `evt-${++n}`;
    })(),
    recordActivity: ({ eventId: _eventId, conversationId, activityType, payload }) => {
      h.events.push({ conversationId, activityType, payload });
    },
    isBusy: (conversationId) => h.busy(conversationId),
    hasPendingApproval: () => false,
    enqueueContinuation: (conversationId) => h.continuations.push(conversationId),
  });
  return h;
}

test('resume from stalled grants a fresh streak and admits continuation', (t) => {
  const h = makeHarness(t);
  h.runtime.setGoal('conv-1', 'ship it');

  // Drive to the stall wall: five progressless turns.
  for (let i = 0; i < 5; i++) {
    h.runtime.onTurnSettled('conv-1', {
      aborted: false,
      failed: false,
      hadSubstantiveProgress: false,
      tokensIn: 10,
      tokensOut: 5,
    });
  }
  assert.equal(h.repo.getActive('conv-1')?.status, 'paused_stalled');
  const continuationsBefore = h.continuations.length;

  // The bug this locks in: Resume must not flip the chip to active while the
  // exhausted streak keeps refusing every admission forever after.
  h.runtime.resume('conv-1');
  assert.equal(h.repo.getActive('conv-1')?.status, 'active');
  assert.equal(h.continuations.length, continuationsBefore + 1, 'resume admits the next turn');

  // And the granted baseline holds: one more quiet turn must NOT re-stall.
  h.runtime.onTurnSettled('conv-1', {
    aborted: false,
    failed: false,
    hadSubstantiveProgress: false,
    tokensIn: 10,
    tokensOut: 5,
  });
  assert.equal(h.repo.getActive('conv-1')?.status, 'active');
});

test('blocked goal retries into active with a cleared blocker and fresh streak', (t) => {
  const h = makeHarness(t);
  h.runtime.setGoal('conv-1', 'deploy');
  // Some progress first — terminal claims need at least one recorded turn.
  h.runtime.onTurnSettled('conv-1', {
    aborted: false,
    failed: false,
    hadSubstantiveProgress: true,
    tokensIn: 10,
    tokensOut: 5,
  });
  const ack = h.runtime.recordTerminalIntent('conv-1', {
    status: 'blocked',
    reason: 'needs deploy credentials',
    evidenceSummary: 'manual_check: deployment requires an operator secret',
    blockerKind: 'missing_authority',
  });
  assert.equal(ack, 'DeferredToTurnEnd');
  h.runtime.onTurnSettled('conv-1', {
    aborted: false,
    failed: false,
    hadSubstantiveProgress: false,
    tokensIn: 10,
    tokensOut: 5,
  });
  assert.equal(h.repo.getActive('conv-1')?.status, 'blocked');

  // Human says the blocker cleared.
  const retried = h.runtime.retryBlocked('conv-1');
  assert.equal(retried?.status, 'active');
  assert.equal(retried?.blockerKind, null);
  assert.equal(h.continuations.at(-1), 'conv-1');
});

test('steer line and envelope keep their contracts', () => {
  // The steer rides unpersisted inside the request payload; if someone makes
  // it empty the goal loop silently loses its instruction to the model.
  assert.ok(GOAL_CONTINUATION_STEER.includes('Goal continuation'));
  const envelope = buildGoalEnvelope({ objective: 'ship', turnCount: 3, turnCap: 25 });
  assert.ok(envelope.includes('ship'));
  assert.ok(envelope.includes('turn 3 of 25'));
});
