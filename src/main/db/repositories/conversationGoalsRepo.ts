import { randomUUID } from 'node:crypto';

import type { SqliteDatabase } from '../client';

/**
 * One persistent objective per conversation (`/goal`). See
 * docs/superpowers/plans/2026-08-26-goal-mode.md for the state machine and the
 * reasoning behind each column.
 *
 * Statuses:
 *  active            — eligible for automatic continuation
 *  paused_user       — yielded by an explicit user action (pause / edit)
 *  paused_stalled    — admission gate stopped the loop: too many consecutive
 *                      turns without a substantive-progress signal
 *  complete          — model claimed completion with evidence; accepted at turn end
 *  blocked           — model declared a non-model-fixable blocker
 *  cleared           — user deleted the goal; row kept as history only
 */

export type GoalStatus =
  | 'active'
  | 'paused_user'
  | 'paused_stalled'
  | 'complete'
  | 'blocked'
  | 'cleared';

export const GOAL_BLOCKER_KINDS = [
  'user_decision',
  'missing_authority',
  'external_state',
  'environment_contradiction',
  'unverifiable_requirement',
] as const;

export type GoalBlockerKind = (typeof GOAL_BLOCKER_KINDS)[number];

export type ConversationGoalRecord = {
  id: string;
  conversationId: string;
  objective: string;
  status: GoalStatus;
  blockerKind: GoalBlockerKind | null;
  blockerNote: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  turnCap: number;
  tokensIn: number;
  tokensOut: number;
  lastProgressTurn: number | null;
};

export const MAX_GOAL_OBJECTIVE_CHARS = 4000;
/** Default outer-turn ceiling; the hard wall that makes runaway loops impossible. */
export const GOAL_TURN_CAP_DEFAULT = 25;
/** Consecutive turns without substantive progress before the loop stalls out. */
export const GOAL_STALL_LIMIT = 5;

type GoalRow = {
  id: string;
  conversation_id: string;
  objective: string;
  status: string;
  blocker_kind: string | null;
  blocker_note: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  turn_count: number;
  turn_cap: number;
  tokens_in: number;
  tokens_out: number;
  last_progress_turn: number | null;
};

const GOAL_STATUSES: readonly string[] = [
  'active',
  'paused_user',
  'paused_stalled',
  'complete',
  'blocked',
  'cleared',
];

function mapRow(row: GoalRow): ConversationGoalRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    objective: row.objective,
    status: (GOAL_STATUSES.includes(row.status) ? row.status : 'active') as GoalStatus,
    blockerKind: (row.blocker_kind as GoalBlockerKind | null) ?? null,
    blockerNote: row.blocker_note ?? null,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    turnCount: row.turn_count,
    turnCap: row.turn_cap,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    lastProgressTurn: row.last_progress_turn ?? null,
  };
}

export class ConversationGoalsRepo {
  constructor(private readonly db: SqliteDatabase) {}

  /** The live goal of a conversation, or null. Cleared rows never answer here. */
  getActive(conversationId: string): ConversationGoalRecord | null {
    const row = this.db
      .prepare<{ conversationId: string }, GoalRow>(
        `SELECT * FROM conversation_goals
         WHERE conversation_id = @conversationId AND status != 'cleared'`
      )
      .get({ conversationId });
    return row ? mapRow(row) : null;
  }

  /** Most recent row regardless of status, for "what was the last goal" UI. */
  getLatest(conversationId: string): ConversationGoalRecord | null {
    const row = this.db
      .prepare<{ conversationId: string }, GoalRow>(
        `SELECT * FROM conversation_goals
         WHERE conversation_id = @conversationId
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get({ conversationId });
    return row ? mapRow(row) : null;
  }

  /**
   * Creates the conversation's goal, clearing any previous one first.
   *
   * The old row is archived to `cleared` rather than deleted, so the audit
   * trail survives a replace; the partial unique index permits exactly one
   * non-cleared row per conversation, which is what makes create-before-clear
   * impossible rather than merely discouraged.
   */
  create(conversationId: string, objective: string, turnCap = GOAL_TURN_CAP_DEFAULT): ConversationGoalRecord {
    const now = new Date().toISOString();
    const run = this.db.transaction((): ConversationGoalRecord => {
      this.db
        .prepare(
          `UPDATE conversation_goals
           SET status = 'cleared', updated_at = @now
           WHERE conversation_id = @conversationId AND status != 'cleared'`
        )
        .run({ conversationId, now });

      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO conversation_goals (
            id, conversation_id, objective, status, created_at, updated_at, turn_cap
          ) VALUES (
            @id, @conversationId, @objective, 'active', @now, @now, @turnCap
          )`
        )
        .run({ id, conversationId, objective, now, turnCap });

      return this.getActive(conversationId)!;
    });
    return run();
  }

  /**
   * Guarded transition: applies `patch` only when the row still sits at
   * `expectedRevision` in `expectedStatus`. False means the caller lost a race
   * (replaced, cleared, or already moved on) and must re-read before deciding
   * anything else — never blind-retry.
   */
  transition(
    goalId: string,
    expectedRevision: number,
    expectedStatus: GoalStatus,
    patch: {
      status?: GoalStatus;
      blockerKind?: GoalBlockerKind | null;
      blockerNote?: string | null;
      bumpTurnCount?: boolean;
      lastProgressTurn?: number;
      accountTokens?: { in: number; out: number };
    }
  ): boolean {
    const sets: string[] = ['updated_at = @updatedAt'];
    const params: Record<string, unknown> = {
      goalId,
      expectedRevision,
      expectedStatus,
      updatedAt: new Date().toISOString(),
    };

    if (patch.status) {
      sets.push('status = @status');
      params.status = patch.status;
    }
    if (patch.blockerKind !== undefined) {
      sets.push('blocker_kind = @blockerKind');
      params.blockerKind = patch.blockerKind;
    }
    if (patch.blockerNote !== undefined) {
      sets.push('blocker_note = @blockerNote');
      params.blockerNote = patch.blockerNote;
    }
    if (patch.bumpTurnCount) {
      sets.push('turn_count = turn_count + 1');
    }
    if (patch.lastProgressTurn !== undefined) {
      sets.push('last_progress_turn = @lastProgressTurn');
      params.lastProgressTurn = patch.lastProgressTurn;
    }
    if (patch.accountTokens) {
      sets.push('tokens_in = tokens_in + @tokensIn', 'tokens_out = tokens_out + @tokensOut');
      params.tokensIn = patch.accountTokens.in;
      params.tokensOut = patch.accountTokens.out;
    }

    // Revision bumps on every successful write so the next writer must have
    // read the post-write state — the stale-update protection Codex built
    // goal_id for, expressed as a compare-and-swap.
    sets.push('revision = revision + 1');

    const result = this.db
      .prepare(
        `UPDATE conversation_goals SET ${sets.join(', ')}
         WHERE id = @goalId AND revision = @expectedRevision AND status = @expectedStatus`
      )
      .run(params);
    return result.changes > 0;
  }

  /**
   * In-place objective rewrite for the dock's edit flow: same row, same id,
   * same counters — the plan's "confirm-free since edit keeps same goal id".
   * Guarded like transition so a clear/replace racing the save wins.
   */
  updateObjective(goalId: string, expectedRevision: number, objective: string): ConversationGoalRecord | null {
    const result = this.db
      .prepare(
        `UPDATE conversation_goals
         SET objective = @objective, revision = revision + 1, updated_at = @updatedAt
         WHERE id = @goalId AND revision = @expectedRevision AND status != 'cleared'`
      )
      .run({ goalId, expectedRevision, objective, updatedAt: new Date().toISOString() });
    if (result.changes === 0) return null;
    const row = this.db
      .prepare<{ goalId: string }, GoalRow>('SELECT * FROM conversation_goals WHERE id = @goalId')
      .get({ goalId });
    return row ? mapRow(row) : null;
  }

  /** Every non-cleared goal, for the boot admission tick over idle conversations. */
  listLiveGoals(): ConversationGoalRecord[] {
    return this.db
      .prepare<Record<string, never>, GoalRow>(
        `SELECT * FROM conversation_goals WHERE status != 'cleared'`
      )
      .all({})
      .map(mapRow);
  }

  deleteHistoryForConversation(conversationId: string): void {
    this.db
      .prepare('DELETE FROM conversation_goals WHERE conversation_id = @conversationId')
      .run({ conversationId });
  }
}
