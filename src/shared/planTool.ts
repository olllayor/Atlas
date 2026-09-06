/**
 * The `update_plan` tool's data model.
 *
 * Codex's plan tool has no state of its own: each call replaces the whole plan,
 * and the harness renders the newest one. Atlas keeps that shape — the plan
 * lives in the tool parts of the message that produced it, and this module is
 * the reduction from those parts to the one thing the transcript draws.
 *
 * Kept in `shared/` and free of React so it can be unit-tested directly, the
 * same reason `toolCellGrammar.ts` lives here.
 */

import type { ChatMessagePart, ChatToolPart, ChatToolState } from './contracts';

export const PLAN_TOOL_NAME = 'update_plan';
export const PLAN_MAX_STEPS = 50;
export const PLAN_STEP_MAX_CHARS = 512;

export type PlanStepStatus = 'pending' | 'in_progress' | 'completed';

export type PlanStep = {
  step: string;
  status: PlanStepStatus;
};

export type PlanToolInput = {
  explanation?: string;
  plan: PlanStep[];
};

/** The transcript's render model: the latest parseable plan in a run of calls. */
export type PlanView = {
  steps: PlanStep[];
  completed: number;
  total: number;
  explanation: string | null;
  /** True while the newest update_plan call has not reached a terminal state. */
  updating: boolean;
  /** Stable id (first plan part's id) — keys the disclosure store entry. */
  anchorId: string;
};

/**
 * An MCP server is free to expose a tool of the same name, and its output is
 * nothing like this one's, so a dynamic part never counts as a plan.
 */
export function isPlanToolPart(part: Pick<ChatToolPart, 'toolName' | 'dynamic'>): boolean {
  return part.dynamic !== true && part.toolName === PLAN_TOOL_NAME;
}

const PLAN_STEP_STATUSES: readonly PlanStepStatus[] = ['pending', 'in_progress', 'completed'];

const TERMINAL_TOOL_STATES: readonly ChatToolState[] = [
  'output-available',
  'output-error',
  'output-denied',
];

function toPlanStepStatus(value: unknown): PlanStepStatus {
  // An unrecognised status is a model typo, not a reason to drop the step: the
  // step text is the information, and `pending` is the honest default for a
  // step nobody has claimed progress on.
  return PLAN_STEP_STATUSES.includes(value as PlanStepStatus) ? (value as PlanStepStatus) : 'pending';
}

/**
 * Parse an `update_plan` argument payload.
 *
 * Accepts an object or a JSON string, because the `tool_executions` merge on
 * reload replaces a part's `input` with its string preview. Anything
 * unparseable — including a preview truncated mid-JSON — yields `null` so the
 * caller can fall back to the last plan it did understand.
 */
export function parsePlanToolInput(value: unknown): PlanToolInput | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return parsePlanToolInput(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.plan)) {
    return null;
  }

  const steps: PlanStep[] = [];
  for (const entry of source.plan) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const item = entry as Record<string, unknown>;
    const step = typeof item.step === 'string' ? item.step.trim() : '';
    if (!step) {
      continue;
    }

    steps.push({ step, status: toPlanStepStatus(item.status) });
  }

  const explanation = typeof source.explanation === 'string' ? source.explanation.trim() : '';

  return explanation ? { explanation, plan: steps } : { plan: steps };
}

/**
 * Enforce the one-in-progress rule the prompt asks for.
 *
 * Codex leaves this to the prompt and renders whatever arrives; a model that
 * marks three steps in progress then gets a plan that says three things are
 * happening at once. Demoting the extras keeps the display truthful, and the
 * count lets the executor tell the model what it did.
 */
export function normalizePlanSteps(steps: PlanStep[]): { steps: PlanStep[]; demotedCount: number } {
  let seenInProgress = false;
  let demotedCount = 0;

  const normalized = steps.map((item) => {
    if (item.status !== 'in_progress') {
      return item;
    }

    if (!seenInProgress) {
      seenInProgress = true;
      return item;
    }

    demotedCount += 1;
    return { ...item, status: 'pending' as const };
  });

  return { steps: normalized, demotedCount };
}

/**
 * Reduce a message's `update_plan` parts to the single plan to draw.
 *
 * The last call whose input parses wins, because each call replaces the plan
 * wholesale. A newest call that is still streaming its arguments — or whose
 * preview came back truncated — leaves the previous plan on screen and only
 * flags it as `updating`, so the checklist never blinks to empty mid-turn.
 * An empty winning plan means the model cleared it, and nothing renders.
 */
export function derivePlanView(parts: ChatToolPart[]): PlanView | null {
  const planParts = parts.filter(isPlanToolPart);
  if (planParts.length === 0) {
    return null;
  }

  let winner: PlanToolInput | null = null;
  for (const part of planParts) {
    const parsed = parsePlanToolInput(part.input) ?? parsePlanToolInput(part.rawInput);
    if (parsed) {
      winner = parsed;
    }
  }

  if (!winner) {
    return null;
  }

  const { steps } = normalizePlanSteps(winner.plan);
  if (steps.length === 0) {
    return null;
  }

  const anchor = planParts[0]!;
  const newest = planParts[planParts.length - 1]!;

  return {
    steps,
    completed: steps.filter((item) => item.status === 'completed').length,
    total: steps.length,
    explanation: winner.explanation ?? null,
    updating: !TERMINAL_TOOL_STATES.includes(newest.state),
    anchorId: anchor.id || anchor.toolCallId,
  };
}

/**
 * The plan checklist as selectable text.
 *
 * Raw mode's rule is that what you see is what you copy, and the rendered
 * checklist carries status in a glyph plus a strikethrough — neither of which
 * survives a paste. `[x]` / `[~]` / `[ ]` is the same information in
 * characters, and is the form a reader can drop straight into an issue.
 */
export function planViewToPlainText(view: PlanView): string {
  const marker: Record<PlanStepStatus, string> = {
    completed: '[x]',
    in_progress: '[~]',
    pending: '[ ]',
  };

  const lines = [`Plan (${view.completed}/${view.total})`];
  if (view.explanation) lines.push(view.explanation);
  for (const item of view.steps) lines.push(`${marker[item.status]} ${item.step}`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------------ *
 * The tasks dock's render model.
 *
 * The transcript's `PlanView` answers "what is the plan"; the dock above the
 * composer also has to answer "how long did each step take", which no single
 * `update_plan` call carries. Nothing in the payload is a clock — the timing
 * is in the *sequence* of calls, so it is reconstructed here by walking every
 * plan the turn published and noticing when a step changed status.
 * ------------------------------------------------------------------------ */

/** One row of the tasks dock: a plan step plus what the call sequence timed. */
export type PlanTaskStep = PlanStep & {
  /**
   * Stable identity across plan revisions. The model rewrites the whole plan
   * each call and may legitimately repeat a step's text, so the occurrence
   * index disambiguates duplicates — matching on text alone would fuse two
   * identical steps into one timer.
   */
  key: string;
  /**
   * Wall-clock span between the call that marked this step `in_progress` and
   * the one that marked it `completed`. Null while it is still running, and
   * for a step that jumped straight to `completed` — there was no observed
   * moment it started, and inventing one would be a guess presented as a
   * measurement.
   */
  durationMs: number | null;
};

export type PlanTasksView = {
  steps: PlanTaskStep[];
  completed: number;
  total: number;
  /**
   * What the collapsed header names: the running step, or — when the model
   * has not claimed one — the next step it owes. Null once every step is
   * completed, which is what tells the dock it has nothing left to say.
   */
  current: PlanTaskStep | null;
  /** True while the newest update_plan call has not reached a terminal state. */
  updating: boolean;
  anchorId: string;
};

/** Plan calls only, in the order the turn made them. */
export function planPartsOf(parts: readonly ChatMessagePart[]): ChatToolPart[] {
  return parts.filter(
    (part): part is ChatToolPart => part.type === 'tool' && isPlanToolPart(part)
  );
}

/**
 * Pair each step with an identity that survives the next revision.
 *
 * `${step}:${occurrence}` rather than the array index: a model that inserts a
 * step at the top would shift every index by one and hand the second step the
 * first step's elapsed time.
 */
export function keyPlanSteps(steps: readonly PlanStep[]): { key: string; step: PlanStep }[] {
  const occurrences = new Map<string, number>();
  return steps.map((step) => {
    const occurrence = occurrences.get(step.step) ?? 0;
    occurrences.set(step.step, occurrence + 1);
    return { key: `${step.step}:${occurrence}`, step };
  });
}

/** When a plan call happened. `startedAt` is the call itself; the rest is fallback. */
function planPartTimestamp(part: ChatToolPart): number | null {
  for (const iso of [part.startedAt, part.completedAt]) {
    if (!iso) continue;
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/**
 * Time each step from the run of plan calls.
 *
 * A step is started by the first call that shows it `in_progress` and stopped
 * by the first call that shows it `completed`; a step never seen in progress
 * is left untimed rather than credited with the gap since the previous call,
 * which would be the time the *model* took, not the time the step took.
 */
export function derivePlanStepDurations(parts: readonly ChatToolPart[]): Map<string, number> {
  const startedAt = new Map<string, number>();
  const durations = new Map<string, number>();

  for (const part of parts) {
    const parsed = parsePlanToolInput(part.input) ?? parsePlanToolInput(part.rawInput);
    if (!parsed) continue;

    const at = planPartTimestamp(part);
    if (at == null) continue;

    for (const { key, step } of keyPlanSteps(normalizePlanSteps(parsed.plan).steps)) {
      if (step.status === 'in_progress' && !startedAt.has(key)) {
        startedAt.set(key, at);
        continue;
      }

      if (step.status !== 'completed' || durations.has(key)) continue;

      const start = startedAt.get(key);
      // A clock that ran backwards (a reordered event, a machine that slept)
      // is not a duration worth showing.
      if (start != null && at >= start) durations.set(key, at - start);
    }
  }

  return durations;
}

/**
 * Reduce a turn's plan calls to what the tasks dock draws.
 *
 * Same winner rule as `derivePlanView` — the newest plan that parses — with
 * the timings folded in and the current step resolved, so the dock's header
 * and its rows can never disagree about which step is live.
 */
export function derivePlanTasksView(parts: readonly ChatToolPart[]): PlanTasksView | null {
  const view = derivePlanView([...parts]);
  if (!view) {
    return null;
  }

  const durations = derivePlanStepDurations(parts.filter(isPlanToolPart));
  const steps: PlanTaskStep[] = keyPlanSteps(view.steps).map(({ key, step }) => ({
    ...step,
    key,
    durationMs: durations.get(key) ?? null,
  }));

  const current =
    steps.find((step) => step.status === 'in_progress') ??
    steps.find((step) => step.status === 'pending') ??
    null;

  return {
    steps,
    completed: view.completed,
    total: view.total,
    current,
    updating: view.updating,
    anchorId: view.anchorId,
  };
}
