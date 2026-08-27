import type {
  ConversationGoalRecord,
  ConversationGoalsRepo,
  GoalBlockerKind,
} from '../../db/repositories/conversationGoalsRepo';
import { GOAL_STALL_LIMIT } from '../../db/repositories/conversationGoalsRepo';

/**
 * Goal mode state machine (plan: docs/superpowers/plans/2026-08-26-goal-mode.md).
 *
 * Deliberately Electron-free and I/O-thin: the state transitions live here,
 * the callers (ChatEngine, IPC handlers) own the side effects. The one
 * decision worth its own pure function is continuation admission — the gate
 * that turns a finished turn into the next one — because it is exactly where
 * a runaway loop would be born, so it is table-tested in isolation.
 */

/** The fixed steer line a continuation turn carries (never persisted to the transcript). */
export const GOAL_CONTINUATION_STEER =
  '<system-reminder>Goal continuation (auto): continue working toward the active goal stated in your instructions. Re-verify current state before acting; do not restart work you have already done.</system-reminder>';

/**
 * The per-turn dynamic envelope. Static goal etiquette lives in
 * GOAL_TOOL_SYSTEM_PROMPT (cache-stable); this block is the part that moves —
 * objective, budget state, and the resume-don't-restart instruction Orca
 * ships with every continued outer turn.
 */
export function buildGoalEnvelope(goal: {
  objective: string;
  turnCount: number;
  turnCap: number;
}): string {
  return [
    '=== ACTIVE GOAL ===',
    goal.objective,
    `Progress: turn ${goal.turnCount} of ${goal.turnCap}.`,
    'Verify current state before continuing; resume rather than restart. Report completion or blockers only through update_goal, with evidence.',
    '=== END ACTIVE GOAL ==='
  ].join('\n');
}

/**
 * Tool terminals that count as substantive progress toward a goal. This is
 * NOT the permission ladder's side-effecting list: web_search is gated there
 * but proves nothing about the workspace, while update_plan (read-only) is
 * exactly the structured-progress signal Orca accepts.
 */
export const GOAL_PROGRESS_TOOLS: ReadonlySet<string> = new Set([
  'bash',
  'write_file',
  'edit_file',
  'git_commit',
  'git_stash',
  'git_branch',
  'git_push',
  'github_pr_create',
  'update_plan',
]);

export type GoalActivityWriter = (input: {
  eventId: string;
  conversationId: string;
  activityType: string;
  payload: Record<string, unknown>;
}) => void;

export type GoalRuntimeDeps = {
  goals: ConversationGoalsRepo;
  recordActivity: GoalActivityWriter;
  randomId: () => string;
  /** Live turn or queued followup exists for this conversation? */
  isBusy: (conversationId: string) => boolean;
  /** An approval request awaits a user decision for this conversation? */
  hasPendingApproval: (conversationId: string) => boolean;
  /** Schedules the next goal turn (ChatEngine enqueues a tagged followup). */
  enqueueContinuation: (conversationId: string, goal: ConversationGoalRecord) => void;
  /** Optional live push of every projection-relevant change to the renderers.
   *  `notice` carries a human explanation for stops that leave no other trace
   *  (turn cap: the goal stays active but nothing runs). */
  pushEvent?: (conversationId: string, info?: { notice?: string }) => void;
};

/** Everything admission needs to know about the moment a turn settled. */
export type AdmissionContext = {
  goalActive: boolean;
  turnAborted: boolean;
  turnFailed: boolean;
  steerQueued: boolean;
  approvalPending: boolean;
  turnCount: number;
  turnCap: number;
  stalledTurns: number;
};

export type AdmissionReason =
  | 'goal_inactive'
  | 'turn_aborted'
  | 'turn_failed'
  | 'steer_queued'
  | 'approval_pending'
  | 'turn_cap_reached'
  | 'stalled';

export type AdmissionVerdict = { decision: 'admit' } | { decision: 'reject'; reason: AdmissionReason };

/**
 * Whether the runtime may start the next outer turn. Order matters: user
 * intent (steer queued, approval pending) outranks mechanical walls, so the
 * reason string names what the USER would want to know first.
 */
export function admitContinuation(ctx: AdmissionContext): AdmissionVerdict {
  if (!ctx.goalActive) return { decision: 'reject', reason: 'goal_inactive' };
  if (ctx.turnAborted) return { decision: 'reject', reason: 'turn_aborted' };
  if (ctx.turnFailed) return { decision: 'reject', reason: 'turn_failed' };
  if (ctx.steerQueued) return { decision: 'reject', reason: 'steer_queued' };
  if (ctx.approvalPending) return { decision: 'reject', reason: 'approval_pending' };
  if (ctx.turnCount >= ctx.turnCap) return { decision: 'reject', reason: 'turn_cap_reached' };
  if (ctx.stalledTurns >= GOAL_STALL_LIMIT) return { decision: 'reject', reason: 'stalled' };
  return { decision: 'admit' };
}

/** A model terminal claim accepted by preflight, awaiting turn-end commit. */
export type PendingTerminalIntent = {
  goalId: number | string;
  revision: number;
  status: 'complete' | 'blocked';
  reason: string;
  evidenceSummary: string;
  blockerKind?: GoalBlockerKind;
};

export class GoalRuntime {
  private readonly pendingIntents = new Map<string, PendingTerminalIntent>();

  constructor(private readonly deps: GoalRuntimeDeps) {}

  setGoal(conversationId: string, objective: string): ConversationGoalRecord {
    const previous = this.deps.goals.getActive(conversationId);
    const goal = this.deps.goals.create(conversationId, objective);
    this.emit(conversationId, 'goal.created', {
      goalId: goal.id,
      replacedGoalId: previous?.id ?? null,
      objectiveChars: objective.length,
    });
    // A brand-new goal may fire immediately when the conversation sits idle.
    this.tryContinue(conversationId);
    return goal;
  }

  /**
   * Dock edit path: rewrites the objective on the live row in place. Deliberately
   * unlike setGoal — no replacement, no counter reset, and no auto-continuation
   * (editing a paused goal must not silently resume it; editing mid-run must not
   * inject a turn). Null when there is nothing live to edit or the save lost a
   * race against clear/replace.
   */
  editGoal(conversationId: string, objective: string): ConversationGoalRecord | null {
    const goal = this.deps.goals.getActive(conversationId);
    if (!goal) return null;
    const updated = this.deps.goals.updateObjective(goal.id, goal.revision, objective);
    if (!updated) return this.deps.goals.getActive(conversationId);
    this.emit(conversationId, 'goal.edited', { goalId: updated.id, objectiveChars: objective.length });
    return updated;
  }

  pause(conversationId: string): ConversationGoalRecord | null {
    const goal = this.deps.goals.getActive(conversationId);
    if (!goal || goal.status !== 'active') return goal;
    // Persist-before-cancel ordering: the caller aborts any generation only
    // after this write commits, so a user stop can never be recorded as an
    // infrastructure failure (Orca's rule).
    const ok = this.deps.goals.transition(goal.id, goal.revision, 'active', {
      status: 'paused_user',
    });
    if (!ok) return this.deps.goals.getActive(conversationId);
    this.pendingIntents.delete(conversationId);
    const updated = this.deps.goals.getActive(conversationId)!;
    this.emit(conversationId, 'goal.paused', { goalId: updated.id, cause: 'user' });
    return updated;
  }

  resume(conversationId: string): ConversationGoalRecord | null {
    const goal = this.deps.goals.getActive(conversationId);
    if (!goal || !goal.status.startsWith('paused_')) return goal;
    const ok = this.deps.goals.transition(
      goal.id,
      goal.revision,
      goal.status as 'paused_user' | 'paused_stalled',
      {
        status: 'active',
        // Leaving the stall wall grants a fresh streak: the user just said
        // "go", and without this the very next admission check would measure
        // the old exhausted streak and refuse forever — a Resume button that
        // silently does nothing.
        ...(goal.status === 'paused_stalled' ? { lastProgressTurn: goal.turnCount } : {}),
      }
    );
    if (!ok) return this.deps.goals.getActive(conversationId);
    const updated = this.deps.goals.getActive(conversationId)!;
    this.emit(conversationId, 'goal.resumed', { goalId: updated.id });
    this.tryContinue(conversationId);
    return updated;
  }

  /**
   * Retry a model-declared blocked goal: back to active with a fresh stall
   * baseline. The human decides the blocker cleared — the runtime does not
   * second-guess them. Distinct from resume() only in which statuses it
   * accepts, so the dock can offer one honest Play button per stopped state.
   */
  retryBlocked(conversationId: string): ConversationGoalRecord | null {
    const goal = this.deps.goals.getActive(conversationId);
    if (!goal || goal.status !== 'blocked') return goal;
    const ok = this.deps.goals.transition(goal.id, goal.revision, 'blocked', {
      status: 'active',
      blockerKind: null,
      blockerNote: null,
      lastProgressTurn: goal.turnCount,
    });
    if (!ok) return this.deps.goals.getActive(conversationId);
    const updated = this.deps.goals.getActive(conversationId)!;
    this.emit(conversationId, 'goal.resumed', { goalId: updated.id, cause: 'retry_after_blocked' });
    this.tryContinue(conversationId);
    return updated;
  }

  clear(conversationId: string): ConversationGoalRecord | null {
    const goal = this.deps.goals.getActive(conversationId);
    if (!goal) return null;
    const ok = this.deps.goals.transition(goal.id, goal.revision, goal.status as 'active' | 'paused_user' | 'paused_stalled', {
      status: 'cleared',
    });
    this.pendingIntents.delete(conversationId);
    if (ok) {
      this.emit(conversationId, 'goal.cleared', { goalId: goal.id });
    }
    return this.deps.goals.getLatest(conversationId);
  }

  /**
   * Preflight for the model's terminal claim. Returns the ack string the tool
   * relays verbatim; only fully valid claims reach the pending map, and the
   * actual transition commits at turn settle (deferred-to-turn-end), never
   * mid-loop.
   */
  recordTerminalIntent(
    conversationId: string,
    intent: {
      status: 'complete' | 'blocked';
      reason: string;
      evidenceSummary: string;
      blockerKind?: GoalBlockerKind;
    }
  ): string {
    const goal = this.deps.goals.getActive(conversationId);
    if (!goal || goal.status !== 'active') {
      return 'BlockedAgainstInactive';
    }
    if (intent.status === 'blocked') {
      if (!intent.blockerKind) {
        return 'Rejected: a blocked claim must name blocker_kind.';
      }
    }
    if (!intent.evidenceSummary.trim()) {
      return 'Rejected: completion requires at least one concrete piece of evidence.';
    }
    if (goal.turnCount < 1) {
      return 'Rejected: no verified work has been done toward this goal yet.';
    }
    if (this.pendingIntents.has(conversationId)) {
      return 'AlreadyPending';
    }
    this.pendingIntents.set(conversationId, {
      goalId: goal.id,
      revision: goal.revision,
      status: intent.status,
      reason: intent.reason,
      evidenceSummary: intent.evidenceSummary,
      blockerKind: intent.blockerKind,
    });
    this.emit(conversationId, 'goal.intent.requested', {
      goalId: goal.id,
      status: intent.status,
      reason: intent.reason,
    });
    return 'DeferredToTurnEnd';
  }

  /**
   * The turn-settle hook. Accounts usage, records progress signals, commits
   * any pending terminal intent, then decides whether the loop continues.
   */
  onTurnSettled(
    conversationId: string,
    info: {
      aborted: boolean;
      failed: boolean;
      hadSubstantiveProgress: boolean;
      tokensIn: number;
      tokensOut: number;
    }
  ): void {
    const goal = this.deps.goals.getActive(conversationId);
    if (!goal) return;

    // Terminal intents commit before anything else: a completed goal does not
    // continue regardless of what the gate would say.
    const intent = this.pendingIntents.get(conversationId);
    if (intent && intent.goalId === goal.id) {
      this.pendingIntents.delete(conversationId);
      const committed = this.deps.goals.transition(goal.id, goal.revision, 'active', {
        status: intent.status,
        blockerKind: intent.blockerKind ?? null,
        blockerNote: intent.reason,
        accountTokens: { in: info.tokensIn, out: info.tokensOut },
        bumpTurnCount: true,
        ...(info.hadSubstantiveProgress ? { lastProgressTurn: goal.turnCount + 1 } : {}),
      });
      if (committed) {
        this.emit(conversationId, intent.status === 'complete' ? 'goal.completed' : 'goal.blocked', {
          goalId: goal.id,
          reason: intent.reason,
          evidence: intent.evidenceSummary,
          blockerKind: intent.blockerKind ?? null,
        });
        return;
      }
      // CAS lost — the goal moved under us (replaced/cleared). Fall through
      // with fresh state; the gate below re-reads it.
    } else if (intent) {
      // Intent for a since-replaced goal: drop silently, the new goal wins.
      this.pendingIntents.delete(conversationId);
    }

    const current = this.deps.goals.getActive(conversationId);
    if (!current || current.status !== 'active') return;

    const progressed = this.deps.goals.transition(current.id, current.revision, 'active', {
      bumpTurnCount: true,
      accountTokens: { in: info.tokensIn, out: info.tokensOut },
      ...(info.hadSubstantiveProgress
        ? { lastProgressTurn: current.turnCount + 1 }
        : {}),
    });
    if (!progressed) return;
    const afterBump = this.deps.goals.getActive(conversationId)!;

    const stalledTurns =
      afterBump.lastProgressTurn == null
        ? afterBump.turnCount
        : afterBump.turnCount - afterBump.lastProgressTurn;

    const verdict = admitContinuation({
      goalActive: true,
      turnAborted: info.aborted,
      turnFailed: info.failed,
      steerQueued: this.deps.isBusy(conversationId),
      approvalPending: this.deps.hasPendingApproval(conversationId),
      turnCount: afterBump.turnCount,
      turnCap: afterBump.turnCap,
      stalledTurns,
    });

    if (verdict.decision === 'admit') {
      this.emit(conversationId, 'goal.continuation.admitted', {
        goalId: afterBump.id,
        turn: `${afterBump.turnCount}/${afterBump.turnCap}`,
      });
      this.deps.enqueueContinuation(conversationId, afterBump);
      return;
    }

    // Only the stall wall changes state on rejection: an exhausted cap or a
    // queued user message leaves the goal active-but-waiting by design, and
    // the UI shows "cap reached" against a still-active goal. A queued user
    // message explains itself; a cap does not, so it rides a notice.
    if (verdict.reason === 'stalled') {
      this.deps.goals.transition(afterBump.id, afterBump.revision, 'active', {
        status: 'paused_stalled',
      });
      this.emit(conversationId, 'goal.paused', { goalId: afterBump.id, cause: 'stalled' });
    }
    this.emit(
      conversationId,
      'goal.continuation.rejected',
      { goalId: afterBump.id, reason: verdict.reason },
      verdict.reason === 'turn_cap_reached'
        ? { notice: 'Goal turn cap reached — it stays active but waits. Send a message or /goal resume to continue.' }
        : undefined,
    );
  }

  /**
   * Boot admission tick (plan §2.7): a crash mid-turn leaves the goal active
   * with no settle coming. Every live goal whose conversation sits idle gets
   * one admission decision; busy conversations are skipped, their own settle
   * will decide.
   */
  continueIdleGoals(): void {
    let live: ConversationGoalRecord[] = [];
    try {
      live = this.deps.goals.listLiveGoals();
    } catch {
      return;
    }
    for (const goal of live) {
      this.tryContinue(goal.conversationId);
    }
  }

  /** Resume/replace paths call this for the idle case: no settle coming. */
  tryContinue(conversationId: string): void {
    if (this.deps.isBusy(conversationId)) return;
    const goal = this.deps.goals.getActive(conversationId);
    if (!goal || goal.status !== 'active') return;
    if (goal.turnCount >= goal.turnCap) return;
    if (this.deps.hasPendingApproval(conversationId)) return;
    const stalledTurns =
      goal.lastProgressTurn == null ? goal.turnCount : goal.turnCount - goal.lastProgressTurn;
    if (stalledTurns >= GOAL_STALL_LIMIT) return;
    this.emit(conversationId, 'goal.continuation.admitted', {
      goalId: goal.id,
      trigger: 'resume_or_create',
      turn: `${goal.turnCount}/${goal.turnCap}`,
    });
    this.deps.enqueueContinuation(conversationId, goal);
  }

  /** What the prompt builder needs to render this turn's goal envelope. */
  describeForPrompt(conversationId: string): {
    objective: string;
    status: string;
    turnCount: number;
    turnCap: number;
  } | null {
    const goal = this.deps.goals.getActive(conversationId);
    if (!goal || goal.status !== 'active') return null;
    return {
      objective: goal.objective,
      status: goal.status,
      turnCount: goal.turnCount,
      turnCap: goal.turnCap,
    };
  }

  /** The live goal for a conversation, or null. IPC `goals.get` reads this. */
  getActive(conversationId: string): ConversationGoalRecord | null {
    return this.deps.goals.getActive(conversationId);
  }

  /** Most recent row regardless of status, for post-clear UI. */
  getLatestForBroadcast(conversationId: string): ConversationGoalRecord | null {
    return this.deps.goals.getLatest(conversationId);
  }

  private emit(
    conversationId: string,
    activityType: string,
    payload: Record<string, unknown>,
    info?: { notice?: string },
  ): void {
    try {
      this.deps.recordActivity({
        eventId: this.deps.randomId(),
        conversationId,
        activityType,
        payload,
      });
    } catch {
      // Activity log failures must never break goal state transitions.
    }
    // Projection push rides outside the try: a dead window must not swallow
    // it for every listener, and index.ts owns the fan-out shape.
    this.deps.pushEvent?.(conversationId, info);
  }
}
