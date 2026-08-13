/**
 * Slice 1 of T2 (`docs/plans/agents/02-subagent-runtime.md`).
 *
 * The task life-cycle state machine the `SubagentRuntime` uses to emit `task.*`
 * runtime events and roll up per-child usage — kept pure and UI/dependency-free
 * so every invariant the rest of the sub-agent series depends on is pinned in
 * isolation before any child-session streaming is wired on top.
 *
 * T1 rules this slice honours verbatim:
 * - **Repeat linkage on EVERY payload.** A fold must be able to reconstruct an
 *   agent whose start row aged out of retention, so no event is emitted without
 *   the full `TaskAgentLinkage`.
 * - **Sticky terminal + order-robust.** A terminal status cannot be regressed by
 *   a late progress/updated frame; usage is a field-wise max-merge so duplicate
 *   or out-of-order frames converge.
 * - **Classify once.** `agentKind` is decided at creation via
 *   `classifyTaskAgentKind` and stamped on every envelope.
 */
import type {
  ActivityType,
  RuntimeEventEnvelope,
  RuntimeTaskStatus,
  RuntimeTaskUsage,
  TaskAgentLinkage,
} from '../../../shared/contracts';
import { classifyTaskAgentKind, mergeTaskUsage } from '../../../shared/runtimeActivity';

/** The spawn tool call + its 0-based position in the batch ⇒ a deterministic id. */
export function agentIdFor(parentToolCallId: string, index: number): string {
  return `${parentToolCallId}:${index}`;
}

export type SubagentTaskState = {
  taskId: string;
  /** Deterministic `${parentToolCallId}:${index}`. */
  agentId: string;
  parentAgentId?: string;
  parentToolCallId: string;
  agentIndex: number;
  conversationId: string;
  turnId: string;
  title: string;
  taskType: string | undefined;
  agentKind: 'agent' | 'background';
  status: RuntimeTaskStatus;
  isFinal: boolean;
  usage: RuntimeTaskUsage | null;
  progress: string | null;
  result: string | null;
  error: string | null;
  role: string | null;
  model: string | null;
  outputFile: string | null;
  attempt: number;
};

/** Fields an emitter is allowed to patch mid-run. */
export type SubagentTaskPatch = {
  status?: RuntimeTaskStatus;
  usage?: RuntimeTaskUsage;
  progress?: string | null;
  result?: string | null;
  error?: string | null;
};

/** How a task ended, expressed as the work-log status vocabulary. */
export type SubagentTaskOutcome = {
  status: RuntimeTaskStatus;
  isFinal: boolean;
};

/** The terminal statuses. Once reached, nothing can un-terminate a task. */
const TERMINAL_STATUSES: ReadonlySet<RuntimeTaskStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

export function isTerminalTaskStatus(status: RuntimeTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Map a reported status to a terminal-compatible one; non-final otherwise. */
export function resolveTaskOutcome(status: RuntimeTaskStatus): SubagentTaskOutcome {
  if (TERMINAL_STATUSES.has(status)) {
    return { status, isFinal: true };
  }
  return { status, isFinal: false };
}

/**
 * Merge a patch onto the current state with the two order-robust rules:
 * terminal is sticky (a late non-final frame only fills metadata) and usage is
 * a field-wise max-merge. Returns the new state.
 */
export function applyTaskPatch(state: SubagentTaskState, patch: SubagentTaskPatch): SubagentTaskState {
  const next: SubagentTaskState = { ...state };

  if (patch.progress !== undefined) next.progress = patch.progress;
  // A late frame must never blank a known result/error with a null.
  if (patch.result !== undefined && patch.result !== null) next.result = patch.result;
  if (patch.error !== undefined && patch.error !== null) next.error = patch.error;

  if (patch.usage) {
    next.usage = mergeTaskUsage(state.usage ?? undefined, patch.usage) ?? null;
  }

  if (patch.status) {
    if (state.isFinal) {
      // Terminal is sticky: a stray progress/updated frame after completion
      // must not resurrect the task or change its outcome.
      next.status = state.status;
    } else {
      const outcome = resolveTaskOutcome(patch.status);
      next.status = outcome.status;
      next.isFinal = outcome.isFinal;
    }
  }

  return next;
}

/** The linkage repeated on every emitted payload (caller may set attempt/index). */
export function linkageFor(state: SubagentTaskState): TaskAgentLinkage {
  return {
    agentKind: state.agentKind,
    agentId: state.agentId,
    parentAgentId: state.parentAgentId,
    toolCallId: state.parentToolCallId,
    title: state.title,
    taskType: state.taskType,
    agentIndex: state.agentIndex,
    attempt: state.attempt,
    role: state.role ?? undefined,
    model: state.model ?? undefined,
    outputFile: state.outputFile ?? undefined,
  };
}

function payloadFor(state: SubagentTaskState, extra: { progress?: string | null } = {}): Record<string, unknown> {
  return {
    taskId: state.taskId,
    status: state.status,
    isFinal: state.isFinal,
    ...(state.result != null ? { result: state.result } : {}),
    ...(state.error != null ? { error: state.error } : {}),
    ...(state.usage != null ? { usage: state.usage } : {}),
    ...(state.progress != null || extra.progress != null ? { progress: extra.progress ?? state.progress } : {}),
    ...linkageFor(state),
  };
}

/**
 * Build a `RuntimeEventEnvelope` for one task event. `emit` passes the id/sequence
 * the caller owns from the runtime; everything else is derived from state so the
 * four event types for one task cannot drift apart.
 */
export function buildTaskEnvelope(
  state: SubagentTaskState,
  activityType: Extract<ActivityType, 'task.started' | 'task.progress' | 'task.updated' | 'task.completed'>,
  options: { eventId: string; sequence: number; occurredAt: string }
): RuntimeEventEnvelope {
  return {
    eventId: options.eventId,
    conversationId: state.conversationId,
    turnId: state.turnId,
    requestId: state.parentToolCallId,
    sequence: options.sequence,
    occurredAt: options.occurredAt,
    activityType,
    tone: 'info',
    provider: 'system',
    agentId: state.agentId,
    parentToolCallId: state.parentToolCallId,
    payload: payloadFor(state, { progress: state.progress }),
  };
}

/**
 * A FIFO slot queue enforcing the T2 bounded-concurrency rule: at most
 * `maxConcurrent` tasks hold a slot; the rest sit `pending` in first-come order.
 */
export class TaskSlotQueue {
  private waiting: Array<{
    resolve: (release: () => void) => void;
    reject: (reason: Error) => void;
    conversationId?: string;
  }> = [];
  private slotsInUse = 0;

  constructor(private readonly maxConcurrent: number) {}

  get inUse(): number {
    return this.slotsInUse;
  }

  get queued(): number {
    return this.waiting.length;
  }

  get capacity(): number {
    return this.maxConcurrent;
  }

  /** Try to take a slot now; if the cap is reached, hold until one frees. */
  async acquire(conversationId?: string, signal?: AbortSignal): Promise<() => void> {
    if (this.slotsInUse < this.maxConcurrent) {
      this.slotsInUse += 1;
      return () => this.release();
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter = { resolve: (release: () => void) => resolve(release), reject, conversationId };
      this.waiting.push(waiter);

      if (signal) {
        if (signal.aborted) {
          // Remove from queue before rejecting so release() doesn't try to promote a stale waiter.
          const idx = this.waiting.indexOf(waiter);
          if (idx !== -1) this.waiting.splice(idx, 1);
          reject(new DOMException('Operation aborted', 'AbortError'));
        } else {
          signal.addEventListener(
            'abort',
            () => {
              const i = this.waiting.indexOf(waiter);
              if (i !== -1) this.waiting.splice(i, 1);
              reject(new DOMException('Operation aborted', 'AbortError'));
            },
            { once: true }
          );
        }
      }
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next.resolve(() => this.release());
    } else {
      this.slotsInUse = Math.max(0, this.slotsInUse - 1);
    }
  }

  /** Drop every queued waiter (used by cascade interrupt); returns how many were waiting. */
  drainQueue(conversationId?: string): number {
    let toDrain: Array<{
      resolve: (release: () => void) => void;
      reject: (reason: Error) => void;
      conversationId?: string;
    }>;

    if (conversationId !== undefined) {
      toDrain = this.waiting.filter((w) => w.conversationId === conversationId);
      const remaining = this.waiting.filter((w) => w.conversationId !== conversationId);
      this.waiting.length = 0;
      this.waiting.push(...remaining);
    } else {
      toDrain = [...this.waiting];
      this.waiting.length = 0;
    }

    for (const waiter of toDrain) {
      const err = new Error('Task slot queue drained');
      err.name = 'AbortError';
      waiter.reject(err);
    }

    return toDrain.length;
  }
}

/**
 * Create a task from a spawn request. `agentKind` defaults to `classifyTaskAgentKind`
 * (unknown type ⇒ agent); a nested agent carrying its own kind is respected.
 */
export function createTask(input: {
  parentToolCallId: string;
  parentAgentId?: string;
  index: number;
  conversationId: string;
  turnId: string;
  title: string;
  prompt: string;
  taskType?: string;
  agentKind?: 'agent' | 'background';
  model?: string;
  role?: string;
  outputFile?: string;
}): SubagentTaskState {
  const agentKind = input.agentKind ?? classifyTaskAgentKind({ taskType: input.taskType, agentId: undefined });

  return {
    taskId: agentIdFor(input.parentToolCallId, input.index),
    agentId: agentIdFor(input.parentToolCallId, input.index),
    parentAgentId: input.parentAgentId,
    parentToolCallId: input.parentToolCallId,
    agentIndex: input.index,
    conversationId: input.conversationId,
    turnId: input.turnId,
    title: input.title,
    taskType: input.taskType,
    agentKind,
    status: 'pending',
    isFinal: false,
    usage: null,
    progress: null,
    result: null,
    error: null,
    role: input.role ?? null,
    model: input.model ?? null,
    outputFile: input.outputFile ?? null,
    attempt: 1,
  };
}
