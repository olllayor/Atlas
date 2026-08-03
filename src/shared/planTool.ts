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

import type { ChatToolPart, ChatToolState } from './contracts';

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
