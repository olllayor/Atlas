/**
 * T2 — Subagent runtime (`docs/plans/agents/02-subagent-runtime.md`).
 *
 * Manages child sessions fan-out, attribution, concurrency capping, and cascade-stop.
 * Ensure child assistant text never leaks into the parent transcript, and tool
 * activity is stamped with `agentId` and `parentToolCallId`.
 */
import { randomUUID } from 'node:crypto';
import type { ActivityType, RuntimeEventEnvelope, StreamEvent } from '../../../shared/contracts';
import type { RecordRuntimeEventInput, RuntimeStateRepo } from '../../db/repositories/runtimeStateRepo';
import {
  CHILD_STEP_LIMIT,
  DEFAULT_CHILD_STEPS,
  describeSpawnViolations,
  validateSpawnRequest,
  type SubagentCapabilities,
} from './subagentCapabilities';
import {
  agentIdFor,
  applyTaskPatch,
  buildTaskEnvelope,
  createTask,
  isTerminalTaskStatus,
  SubagentTaskState,
  TaskSlotQueue,
} from './subagentTasks';
import { logger } from '../../observability/logger';
import { sleep } from '../core/ErrorNormalizer';
import { snapshotSubagentDescriptor } from './subagentDescriptor';

export type { SubagentCapabilities };

/** How long a cascade stop waits on a child before moving on. */
export const CHILD_INTERRUPT_TIMEOUT_MS = 800;

/**
 * How long clearing a conversation's background tasks waits for aborted
 * one-shot agents to settle before giving up on the join. Their records are
 * dropped either way; the bound only stops one wedged turn from hanging
 * conversation deletion forever.
 */
export const BACKGROUND_CLEAR_JOIN_TIMEOUT_MS = 2_000;

function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      }
    );
  });
}

export type SubagentSpawnRequest = {
  conversationId: string;
  parentTurnId: string;
  parentToolCallId: string;
  parentAgentId?: string;
  agentId?: string;
  agentIndex?: number;
  title: string;
  prompt: string;
  taskType?: string;
  agentKind?: 'agent' | 'background';
  model?: string;
  role?: string;
  outputFile?: string;
  tools?: string[];
  /**
   * The child's model-turn budget. Validated against the capabilities
   * `stepLimit` at spawn time (fail-loud, never clamped) and threaded to the
   * child turn loop. Omitted ⇒ the provider default.
   */
  maxSteps?: number;
  /**
   * Run in the background: the spawn returns immediately with a `pending`
   * state while the child queues for a slot and runs detached. The parent
   * keeps its turn, is notified when the child settles, and controls it via
   * the list/interrupt/output surfaces. Requires `supportsBackground`.
   */
  background?: boolean;
  /** Depth in the spawn chain (root = 0). Passed through by spawnBatch automatically. */
  depth?: number;
};

export type ChildTurnExecutor = (input: {
  conversationId: string;
  prompt: string;
  model?: string;
  role?: string;
  tools?: string[];
  outputFile?: string;
  /** The child's model-turn budget; the executor must honor it. */
  maxSteps?: number;
  signal: AbortSignal;
  onEvent: (event: StreamEvent) => void;
  parentAgentId?: string;
  /** Nesting depth of the current task (0 = root spawn, 1 = grandchild, …). */
  depth?: number;
}) => Promise<{
  content: string;
  status?: 'completed' | 'awaiting_approval';
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}>;

export type SubagentChildMode = 'one-shot' | 'continuable';

export interface SubagentChildInput {
  parentConversationId: string;
  title: string;
  delegationDepth: number;
  agentId: string;
  mode: SubagentChildMode;
  parentTurnId: string;
}

export interface SubagentRuntimeOptions {
  runtimeStateRepo?: Pick<RuntimeStateRepo, 'recordEvent'>;
  maxConcurrent?: number;
  /** Max nesting depth of subagent spawns (root = 0, children = 1, …). Default 3. */
  maxDepth?: number;
  childExecutor?: ChildTurnExecutor;
  onRuntimeEvent?: (envelope: RuntimeEventEnvelope) => void;
  /**
   * S1 hook: create a durable child conversation row for listing/cold-resume.
   * When undefined (tests, older wiring) the runtime keeps the ephemeral Task-only
   * behavior with no durable row — backward compat.
   * Should insert `conversations` with origin='subagent', side_of_conversation_id=parent,
   * subagent_mode, subagent_label, delegation_depth and return the new id.
   * Return null/undefined to skip durable creation (e.g. test mocks without DB).
   */
  createChildConversation?: (input: SubagentChildInput) => string | null | undefined | Promise<string | null | undefined>;
  /** Rollback for the hook above when spawn fails before slot acceptance. */
  deleteChildConversation?: (childConversationId: string) => void | Promise<void>;
  /** S2: continuable manager for background:true spawns. When present, background spawns become continuable. */
  continuationManager?: {
    startContinuable: (spec: {
      parentConversationId: string;
      parentTurnId: string;
      parentToolCallId: string;
      /** Batch position; keeps agent ids distinct across a fan-out. */
      agentIndex?: number;
      parentAgentId?: string;
      title: string;
      prompt: string;
      model?: string;
      tools?: string[];
      depth?: number;
      signal?: AbortSignal;
    }) => Promise<{ childId: string; messageId: string }>;
    interruptForParent?: (parentConversationId: string, childId: string) => Promise<{ accepted: true } | undefined>;
    interruptAllForConversation?: (conversationId: string) => number;
    interruptAll?: () => number;
  } | null;
}

/** One live task's runtime handles, keyed by agentId. */
type ActiveTask = {
  state: SubagentTaskState;
  controller: AbortController;
  donePromise?: Promise<void>;
};

/**
 * A background task's durable record. Unlike `ActiveTask` (deleted on settle),
 * this survives settlement so the parent can still list, read output, and see
 * the outcome — and so the completion notice can be drained exactly once.
 * Mirrors `BackgroundJobRegistry`'s reported-flag idiom.
 */
type BackgroundTask = {
  state: SubagentTaskState;
  controller: AbortController;
  donePromise: Promise<void>;
  /** True once a drain, output read, or interrupt observed the terminal state. */
  reported: boolean;
  /**
   * True when the live lifecycle belongs to the continuation manager (S2).
   * Interrupt routing and terminal semantics differ — a continuable child is
   * keepInbox and never goes terminal from an interrupt, even when its
   * Activation is not currently resident (cold child must not be killed by a
   * stale one-shot abort path).
   */
  continuable?: boolean;
};

/** A read-only projection of one background agent for the model-facing tools. */
export type BackgroundAgentSnapshot = {
  agentId: string;
  title: string;
  status: SubagentTaskState['status'];
  isFinal: boolean;
  progress: string | null;
  result: string | null;
  error: string | null;
  totalTokens: number;
};

export class SubagentRuntime {
  private readonly runtimeStateRepo?: Pick<RuntimeStateRepo, 'recordEvent'>;
  private readonly slotQueue: TaskSlotQueue;
  private readonly maxDepth: number;
  private readonly childExecutor?: ChildTurnExecutor;
  private readonly onRuntimeEvent?: (envelope: RuntimeEventEnvelope) => void;
  private readonly createChildConversation?: SubagentRuntimeOptions['createChildConversation'];
  private readonly deleteChildConversation?: SubagentRuntimeOptions['deleteChildConversation'];
  private readonly continuationManager?: SubagentRuntimeOptions['continuationManager'];
  private readonly activeTasks = new Map<string, ActiveTask>();
  /** Background tasks, keyed by agentId; survive settlement for later reads. */
  private readonly backgroundTasks = new Map<string, BackgroundTask>();
  private sequenceCounter = 0;

  constructor(options: SubagentRuntimeOptions = {}) {
    this.runtimeStateRepo = options.runtimeStateRepo;
    this.slotQueue = new TaskSlotQueue(options.maxConcurrent ?? 4);
    this.maxDepth = options.maxDepth ?? 3;
    this.childExecutor = options.childExecutor;
    this.onRuntimeEvent = options.onRuntimeEvent;
    this.createChildConversation = options.createChildConversation;
    this.deleteChildConversation = options.deleteChildConversation;
    this.continuationManager = options.continuationManager ?? null;
  }

  /** S2: allow ChatEngine to inject manager after construction (circular dep). */
  setContinuationManager(manager: SubagentRuntimeOptions['continuationManager']): void {
    (this as unknown as { continuationManager: typeof manager }).continuationManager = manager;
  }

  /**
   * The static capability descriptor for this provider. Published so the
   * model-facing tools can state the real limits and validate requests
   * fail-loud before any resource is consumed.
   */
  get capabilities(): SubagentCapabilities {
    return {
      provider: 'atlas-turn-executor',
      maxDepth: this.maxDepth,
      maxConcurrent: this.slotQueue.capacity,
      supportsBackground: true,
      stepLimit: { min: CHILD_STEP_LIMIT.min, max: CHILD_STEP_LIMIT.max },
    };
  }

  /** Get current active task count for a conversation. */
  getActiveCount(conversationId: string): number {
    let count = 0;
    for (const { state } of this.activeTasks.values()) {
      if (state.conversationId === conversationId && !state.isFinal) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * Whether a new spawn at the given depth can proceed.
   *
   * Depth-only on purpose: this gates whether the `spawn_agent` tool is
   * registered, and the tool catalog must stay stable across turns so the
   * provider's prompt cache is not invalidated. Slot pressure is deliberately
   * NOT checked here — it is enforced at `acquire` time, where an over-capacity
   * spawn is rejected with an actionable per-task error instead of the tool
   * silently vanishing from the catalog.
   */
  canSpawn(depth: number): boolean {
    return depth < this.maxDepth;
  }

  /** Total concurrency capacity (read for observability / tests). */
  get maxSlots(): number {
    return this.slotQueue.capacity;
  }

  /** Record and emit an attributed child runtime event envelope. */
  private emitChildEvent(state: SubagentTaskState, event: StreamEvent): RuntimeEventEnvelope {
    (event as any).agentId = state.agentId;
    (event as any).parentToolCallId = state.parentToolCallId;
    if (state.parentAgentId) {
      (event as any).parentAgentId = state.parentAgentId;
    }
    if ((event as any).payload && typeof (event as any).payload === 'object') {
      (event as any).payload.agentId = state.agentId;
      (event as any).payload.parentToolCallId = state.parentToolCallId;
      // The fold routes on payload.agentKind: without this stamp the row
      // classifies as background and the Agents panel never sees the child's
      // tool activity (toolCount stays 0, lastTool/recent-activity stay empty).
      if ((event as any).payload.agentKind == null) {
        (event as any).payload.agentKind = state.agentKind;
      }
      if (state.parentAgentId) {
        (event as any).payload.parentAgentId = state.parentAgentId;
      }
    }

    this.sequenceCounter += 1;

    let activityType: ActivityType = (event as any).activityType;
    if (!activityType) {
      const typeStr = String(event.type ?? '');
      if (
        typeStr === 'tool.call' ||
        typeStr === 'tool.started' ||
        typeStr === 'tool-input-start' ||
        typeStr === 'tool-input-available'
      ) {
        activityType = 'tool.started';
      } else if (
        typeStr === 'tool.result' ||
        typeStr === 'tool.completed' ||
        typeStr === 'tool-output-available'
      ) {
        activityType = 'tool.completed';
      } else if (typeStr === 'tool.updated' || typeStr === 'tool-input-delta') {
        activityType = 'tool.updated';
      } else {
        activityType = 'task.progress';
      }
    }

    const inputEnvelope: RecordRuntimeEventInput = {
      eventId: (event as any).eventId ?? randomUUID(),
      conversationId: (event as any).conversationId ?? state.conversationId,
      turnId: (event as any).turnId ?? state.turnId,
      requestId: (event as any).requestId ?? state.parentToolCallId,
      occurredAt: new Date().toISOString(),
      activityType,
      tone: (event as any).tone ?? (activityType.startsWith('tool.') ? 'tool' : 'info'),
      provider: (event as any).provider ?? 'system',
      providerEventType: (event as any).providerEventType ?? event.type ?? null,
      toolCallId: (event as any).toolCallId ?? (event as any).payload?.toolCallId ?? null,
      messageId: (event as any).messageId ?? null,
      agentId: state.agentId,
      parentToolCallId: state.parentToolCallId,
      ...(state.parentAgentId ? { parentAgentId: state.parentAgentId } : {}),
      payload: {
        ...((event as any).payload ?? {}),
        ...(event as any),
        agentId: state.agentId,
        parentToolCallId: state.parentToolCallId,
        // Covers payload-less child events (e.g. bare chunk frames): the fold
        // routes on payload.agentKind, so every child row must carry it.
        agentKind: (event as any).payload?.agentKind ?? state.agentKind,
        ...(state.parentAgentId ? { parentAgentId: state.parentAgentId } : {}),
      },
    };

    let envelope: RuntimeEventEnvelope;
    if (this.runtimeStateRepo) {
      envelope = this.runtimeStateRepo.recordEvent(inputEnvelope);
    } else {
      envelope = {
        ...inputEnvelope,
        sequence: this.sequenceCounter,
        occurredAt: inputEnvelope.occurredAt ?? new Date().toISOString(),
      } as RuntimeEventEnvelope;
    }

    if (this.onRuntimeEvent) {
      this.onRuntimeEvent(envelope);
    }

    return envelope;
  }

  /** Emit a durable subagent descriptor (S1). Stored under the child conversation so listing can find it after restart. */
  private emitDescriptorEvent(state: SubagentTaskState, descriptor: ReturnType<typeof snapshotSubagentDescriptor>): void {
    this.sequenceCounter += 1;
    const inputEnvelope: RecordRuntimeEventInput = {
      eventId: randomUUID(),
      conversationId: state.childConversationId ?? state.conversationId,
      turnId: state.turnId,
      requestId: state.parentToolCallId,
      occurredAt: new Date().toISOString(),
      activityType: 'subagent.descriptor' as ActivityType,
      tone: 'info',
      provider: 'system',
      providerEventType: 'subagent.descriptor',
      toolCallId: null,
      messageId: null,
      approvalId: null,
      agentId: state.agentId,
      parentToolCallId: state.parentToolCallId,
      payload: {
        subagentDescriptor: descriptor,
        agentId: state.agentId,
        parentToolCallId: state.parentToolCallId,
        title: descriptor.label,
        agentKind: state.agentKind,
      } as unknown as Record<string, unknown>,
    };

    let envelope: RuntimeEventEnvelope;
    if (this.runtimeStateRepo) {
      // S1: must throw on failure so the caller can rollback the child row.
      // Swallowing here would leave a child conversation with no descriptor — cold resume (S2) would see a diagnostic orphan.
      // Use the repo's returned envelope: it carries the authoritative
      // per-conversation sequence. Forwarding a locally-built sequence here
      // would trip the renderer's stale-sequence drop (runtime-sync <= watermark).
      envelope = this.runtimeStateRepo.recordEvent(inputEnvelope);
    } else {
      envelope = {
        ...inputEnvelope,
        sequence: this.sequenceCounter,
        occurredAt: inputEnvelope.occurredAt ?? new Date().toISOString(),
      } as RuntimeEventEnvelope;
    }
    if (this.onRuntimeEvent) {
      this.onRuntimeEvent(envelope);
    }
  }

  /** Emit task event envelope to repo if available. */
  private emitEvent(
    state: SubagentTaskState,
    activityType: 'task.started' | 'task.progress' | 'task.updated' | 'task.completed'
  ) {
    this.sequenceCounter += 1;
    const fallbackEnvelope = buildTaskEnvelope(state, activityType, {
      eventId: randomUUID(),
      sequence: this.sequenceCounter,
      occurredAt: new Date().toISOString(),
    });
    let envelope: RuntimeEventEnvelope = fallbackEnvelope;
    if (this.runtimeStateRepo) {
      // Use the repo's returned envelope for its authoritative sequence.
      // The local counter is fallback-only (no-repo mode); pushing it when a
      // repo exists would emit a small shared integer against a large
      // per-conversation watermark and the renderer would silently drop it.
      const { sequence: _droppedSequence, ...inputWithoutSequence } = fallbackEnvelope as unknown as Record<string, unknown> as RecordRuntimeEventInput & { sequence: number };
      void _droppedSequence;
      envelope = this.runtimeStateRepo.recordEvent(inputWithoutSequence);
    }
    if (this.onRuntimeEvent) {
      this.onRuntimeEvent(envelope);
    }
  }



  /**
   * Spawn a batch of tasks in parallel with bounded concurrency.
   */
  async spawnBatch(input: {
    conversationId: string;
    parentTurnId: string;
    parentToolCallId: string;
    parentAgentId?: string;
    /** Depth of the caller (children will be depth+1). Omit for top-level spawns. */
    depth?: number;
    /** Run every task in this batch in the background. */
    background?: boolean;
    tasks: Array<{
      title: string;
      prompt: string;
      model?: string;
      role?: string;
      outputFile?: string;
      tools?: string[];
      taskType?: string;
      maxSteps?: number;
    }>;
    parentSignal?: AbortSignal;
  }): Promise<SubagentTaskState[]> {
    const childDepth = (input.depth ?? 0) + 1;
    const promises = input.tasks.map((taskSpec, index) =>
      this.spawn({
        conversationId: input.conversationId,
        parentTurnId: input.parentTurnId,
        parentToolCallId: input.parentToolCallId,
        parentAgentId: input.parentAgentId,
        agentIndex: index,
        title: taskSpec.title,
        prompt: taskSpec.prompt,
        model: taskSpec.model,
        role: taskSpec.role,
        outputFile: taskSpec.outputFile,
        tools: taskSpec.tools,
        taskType: taskSpec.taskType,
        maxSteps: taskSpec.maxSteps,
        background: input.background,
        depth: childDepth,
      }, input.parentSignal)
    );

    const results = await Promise.allSettled(promises);
    return results.map((res, idx) => {
      if (res.status === 'fulfilled') {
        return res.value;
      }
      const agentId = agentIdFor(input.parentToolCallId, idx);
      const fallbackState = this.activeTasks.get(agentId)?.state ?? createTask({
        parentToolCallId: input.parentToolCallId,
        parentAgentId: input.parentAgentId,
        index: idx,
        conversationId: input.conversationId,
        turnId: input.parentTurnId,
        title: input.tasks[idx].title,
        prompt: input.tasks[idx].prompt,
      });
      return applyTaskPatch(fallbackState, {
        status: 'failed',
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
    });
  }

  /**
   * Spawn a single subagent task.
   *
   * Validates the request against the provider `capabilities` fail-loud
   * BEFORE consuming any resource (depth, background support, maxSteps range).
   * A violation returns a `failed` state carrying every actionable message —
   * never accept-then-ignore.
   *
   * With `background: true`, the task is registered and kicked off detached,
   * and this returns immediately with the `pending` state while the child
   * queues for a slot and runs. The parent keeps its turn and later controls
   * the task via `listBackgroundAgents` / `interruptAgent` /
   * `readBackgroundOutput`, and is notified via `drainBackgroundNotices`.
   */
  async spawn(req: SubagentSpawnRequest, parentSignal?: AbortSignal): Promise<SubagentTaskState> {
    const index = req.agentIndex ?? 0;
    let state = createTask({
      parentToolCallId: req.parentToolCallId,
      parentAgentId: req.parentAgentId,
      index,
      conversationId: req.conversationId,
      turnId: req.parentTurnId,
      title: req.title,
      prompt: req.prompt,
      taskType: req.taskType,
      agentKind: req.agentKind,
      model: req.model,
      role: req.role,
      outputFile: req.outputFile,
    });

    // Fail-loud capability check. `depth` here is the spawned task's own depth
    // (root tasks start at 0), matching the historical backstop below.
    const depth = req.depth != null ? req.depth : 0;
    const violations = validateSpawnRequest(this.capabilities, {
      depth,
      background: req.background,
      maxSteps: req.maxSteps,
    });
    if (violations.length > 0) {
      return applyTaskPatch(state, {
        status: 'failed',
        error: describeSpawnViolations(violations),
      });
    }

    // C4: reject immediately if we would exceed maxDepth — no resource consumed.
    // (Retained as a defense-in-depth backstop identical to the capability
    // check above; the capability path produces the richer message.)
    if (depth > this.maxDepth) {
      state = applyTaskPatch(state, {
        status: 'failed',
        error: `Nesting depth ${depth} exceeds maximum (${this.maxDepth})`,
      });
      return state;
    }

    // S2: continuable path — background spawns become durable sessions with inbox FIFO.
    // When a continuation manager is present, background:true means continuable.
    if (req.background && this.continuationManager) {
      try {
        const started = await this.continuationManager.startContinuable({
          parentConversationId: req.conversationId,
          parentTurnId: req.parentTurnId,
          parentToolCallId: req.parentToolCallId,
          agentIndex: index,
          parentAgentId: req.parentAgentId,
          title: req.title,
          prompt: req.prompt,
          model: req.model,
          tools: req.tools,
          depth,
          signal: parentSignal,
        });
        state = { ...state, childConversationId: started.childId, status: 'pending', isFinal: false } as SubagentTaskState;
        // Keep a lightweight background record so old listBackgroundAgents still surfaces continuable children until S5 catalog lands.
        // The real execution is owned by the manager; this record is just for backward compat listing.
        this.backgroundTasks.set(state.agentId, {
          state,
          controller: new AbortController(), // unused — the manager owns the live controller
          continuable: true,
          donePromise: new Promise<void>(() => {}), // never settles via Task; manager owns lifecycle (S3 will wire interrupt)
          reported: false,
        });
        try { this.emitEvent(state, 'task.started'); } catch {}
        return state;
      } catch (err) {
        this.backgroundTasks.delete(state.agentId);
        const msg = err instanceof Error ? err.message : String(err);
        return applyTaskPatch(state, { status: 'failed', error: msg });
      }
    }

    const controller = new AbortController();
    if (parentSignal) {
      if (parentSignal.aborted) {
        controller.abort();
      } else {
        parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    // S1: create durable child conversation synchronously so background callers
    // get childConversationId immediately and listing sees it even while queued.
    // NOTE: mode is 'one-shot' until S2 manager exists. Persisting
    // 'continuable' now would lie to cold-resume (S2 would misread old rows).
    if (this.createChildConversation) {
      let created: string | null | undefined = null;
      try {
        const mode = 'one-shot' as const; // S2 will switch to req.background ? 'continuable' : 'one-shot'
        created = (await this.createChildConversation({
          parentConversationId: req.conversationId,
          title: req.title,
          delegationDepth: depth,
          agentId: state.agentId,
          mode,
          parentTurnId: req.parentTurnId,
        })) ?? null;
        if (created) {
          state = { ...state, childConversationId: created };
          const descriptor = snapshotSubagentDescriptor({
            mode,
            provider: 'atlas-turn-executor',
            label: req.title,
            agentId: state.agentId,
            parentConversationId: req.conversationId,
            delegationDepth: depth,
            ...(req.model ? { model: req.model } : {}),
            ...(req.tools ? { toolFilter: req.tools } : {}),
          });
          // Emit under child conversation for catalog durability.
          // S2-must-tighten: failure here must rollback the child row (cold resume breaks silently otherwise).
          this.emitDescriptorEvent(state, descriptor);
        }
      } catch (err) {
        // Rollback the orphaned child row if we already created it.
        if (created && this.deleteChildConversation) {
          try { await this.deleteChildConversation(created); } catch {}
        }
        const msg = err instanceof Error ? err.message : String(err);
        return applyTaskPatch(state, {
          status: 'failed',
          error: `Failed to create subagent session: ${msg}`,
        });
      }
    }

    if (req.background) {
      // Register the durable record first so the task is listable/interruptible
      // from the moment the spawn returns, even while it still waits for a slot.
      this.backgroundTasks.set(state.agentId, {
        state,
        controller,
        donePromise,
        reported: false,
      });
      // Detached: the child runs to completion on its own; settlement updates
      // the record and resolves donePromise. Errors are contained in runTask.
      void this.runTask(req, state, controller, resolveDone, true, donePromise);
      return state;
    }

    return this.runTask(req, state, controller, resolveDone, false, donePromise);
  }

  /**
   * The shared task lifecycle for inline and background spawns: acquire a
   * slot, run the child executor, and finalize. For background tasks the
   * durable record in `backgroundTasks` is updated (not deleted) on settle so
   * the parent can still read the outcome; inline tasks leave no residue.
   */
  private async runTask(
    req: SubagentSpawnRequest,
    initialState: SubagentTaskState,
    controller: AbortController,
    resolveDone: () => void,
    background: boolean,
    donePromise?: Promise<void>
  ): Promise<SubagentTaskState> {
    let state = initialState;
    let releaseSlot: (() => void) | undefined;
    let childConversationId: string | null = null;
    try {
      // C5: register in activeTasks only after the early-depth guard passes.
      this.activeTasks.set(state.agentId, { state, controller, donePromise });

      // C5: emit is now inside the try block so cleanup runs on any throw.
      this.emitEvent(state, 'task.started');

      // S1: create durable child conversation + descriptor before slot acceptance.
      // Created in spawn() synchronously for background immediate visibility;
      // inline path may still need it if spawn was bypassed (e.g. direct runTask).
      if (this.createChildConversation && !state.childConversationId) {
        try {
          const mode = req.background ? 'continuable' as const : 'one-shot' as const;
          const created = await this.createChildConversation({
            parentConversationId: req.conversationId,
            title: req.title,
            delegationDepth: req.depth ?? 0,
            agentId: state.agentId,
            mode,
            parentTurnId: req.parentTurnId,
          });
          if (created) {
            childConversationId = created;
            state = { ...state, childConversationId: created };
            // Refresh the active record so readers see the durable id immediately.
            this.activeTasks.set(state.agentId, { state, controller, donePromise });
            if (background) {
              const bg = this.backgroundTasks.get(state.agentId);
              if (bg) bg.state = state;
            }
            const descriptor = snapshotSubagentDescriptor({
              mode,
              provider: 'atlas-turn-executor',
              label: req.title,
              agentId: state.agentId,
              parentConversationId: req.conversationId,
              delegationDepth: req.depth ?? 0,
              ...(req.model ? { model: req.model } : {}),
              ...(req.tools ? { toolFilter: req.tools } : {}),
            });
            this.emitDescriptorEvent(state, descriptor);
          }
        } catch (err) {
          // Hook failure should not hide as silent ignore — surface as task error.
          const msg = err instanceof Error ? err.message : String(err);
          state = applyTaskPatch(state, { status: 'failed', error: `Failed to create subagent session: ${msg}` });
          this.emitEvent(state, 'task.completed');
          return state;
        }
      } else if (state.childConversationId) {
        childConversationId = state.childConversationId;
      }

      // C4: pass the controller's signal so queue waiters can be cancelled atomically.
      try {
        releaseSlot = await this.slotQueue.acquire(req.conversationId, controller.signal);
      } catch (acquireErr) {
        // Acquire failed (capacity or abort) before acceptance — rollback durable child.
        if (childConversationId && this.deleteChildConversation) {
          try { await this.deleteChildConversation(childConversationId); } catch {}
          childConversationId = null;
          state = { ...state, childConversationId: null };
          this.activeTasks.set(state.agentId, { state, controller, donePromise });
          if (background) {
            const bg = this.backgroundTasks.get(state.agentId);
            if (bg) bg.state = state;
          }
        }
        throw acquireErr;
      }

      if (controller.signal.aborted || isTerminalTaskStatus(state.status)) {
        if (childConversationId && this.deleteChildConversation) {
          try { await this.deleteChildConversation(childConversationId); } catch {}
          childConversationId = null;
          state = { ...state, childConversationId: null };
        }
        state = applyTaskPatch(state, { status: 'interrupted', error: 'Aborted before start' });
        return state;
      }

      // Transition to running
      state = applyTaskPatch(state, { status: 'running', progress: 'Task started' });
      this.activeTasks.set(state.agentId, { state, controller, donePromise });
      this.emitEvent(state, 'task.progress');

      if (this.childExecutor) {
        const executorResult = await this.childExecutor({
          conversationId: req.conversationId,
          prompt: req.prompt,
          model: req.model,
          role: req.role,
          tools: req.tools,
          outputFile: req.outputFile,
          maxSteps: req.maxSteps ?? DEFAULT_CHILD_STEPS,
          parentAgentId: state.agentId,
          depth: req.depth,
          signal: controller.signal,
          onEvent: (event) => {
            state = applyTaskPatch(state, {
              progress: event.type === 'chunk' ? 'Generating response...' : `Event: ${event.type}`,
            });
            this.emitEvent(state, 'task.progress');
            this.emitChildEvent(state, event);
          },
        });

        if (executorResult.status === 'awaiting_approval') {
          state = applyTaskPatch(state, {
            status: 'failed',
            error: 'Child task requested unapproved tool execution',
          });
        } else {
          state = applyTaskPatch(state, {
            status: 'completed',
            result: executorResult.content,
            usage: executorResult.usage
              ? {
                  inputTokens: executorResult.usage.inputTokens ?? 0,
                  outputTokens: executorResult.usage.outputTokens ?? 0,
                  totalTokens: executorResult.usage.totalTokens ?? 0,
                }
              : undefined,
          });
        }
      } else {
        // Fallback execution mock/placeholder if no childExecutor provided
        state = applyTaskPatch(state, {
          status: 'completed',
          result: `Executed task: ${req.title}`,
        });
      }
    } catch (err: unknown) {
      const isAbort = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
      // Rollback durable child if we never acquired a slot (never accepted).
      if (childConversationId && !releaseSlot && this.deleteChildConversation) {
        try { await this.deleteChildConversation(childConversationId); } catch {}
        childConversationId = null;
        state = { ...state, childConversationId: null };
      }
      const outcomeStatus = isAbort ? 'interrupted' : 'failed';
      const errorMsg = err instanceof Error ? err.message : String(err);

      state = applyTaskPatch(state, {
        status: outcomeStatus,
        error: errorMsg,
      });
    } finally {
      if (releaseSlot) {
        releaseSlot();
      }
      // C5: each finalizer is individually protected so one failure
      // cannot prevent the others from completing.
      try { this.emitEvent(state, 'task.completed'); } catch {}
      this.activeTasks.delete(state.agentId);
      if (background) {
        // Keep the durable record for later reads; refresh its terminal state.
        const record = this.backgroundTasks.get(state.agentId);
        if (record) {
          record.state = state;
        }
      }
      try { resolveDone(); } catch {}
    }

    return state;
  }

  /**
   * Cascade stop: Interrupt all live child tasks for a conversation.
   * Drains the queue and aborts controllers. Also interrupts continuable activations.
   */
  async interruptAll(conversationId: string, reason = 'Parent turn aborted'): Promise<number> {
    this.slotQueue.drainQueue(conversationId);

    if (this.continuationManager?.interruptAllForConversation) {
      try {
        this.continuationManager.interruptAllForConversation(conversationId);
      } catch {}
    }

    const tasksToInterrupt: ActiveTask[] = [];
    for (const item of this.activeTasks.values()) {
      if (item.state.conversationId === conversationId && !item.state.isFinal) {
        tasksToInterrupt.push(item);
      }
    }

    return this.interruptTasks(tasksToInterrupt, reason);
  }

  /**
   * Cascade stop across EVERY conversation (app quit). Mirrors the
   * background-job registry's `killAll`: live subagent sessions are tracked,
   * not detached, so quitting cancels them instead of orphaning them.
   */
  async interruptAllConversations(reason = 'App quitting'): Promise<number> {
    this.slotQueue.drainQueue();
    if (this.continuationManager?.interruptAll) {
      try {
        this.continuationManager.interruptAll();
      } catch {}
    }

    const tasksToInterrupt: ActiveTask[] = [];
    for (const item of this.activeTasks.values()) {
      if (!item.state.isFinal) {
        tasksToInterrupt.push(item);
      }
    }

    return this.interruptTasks(tasksToInterrupt, reason);
  }

  /** Shared abort-and-await core for the cascade-stop entry points. */
  private async interruptTasks(tasksToInterrupt: ActiveTask[], reason: string): Promise<number> {
    let interruptedCount = 0;
    const promisesToAwait: Promise<void>[] = [];

    for (const { state, controller, donePromise } of tasksToInterrupt) {
      interruptedCount += 1;
      controller.abort();

      const updatedState = applyTaskPatch(state, {
        status: 'interrupted',
        error: reason,
      });
      this.activeTasks.set(state.agentId, { state: updatedState, controller, donePromise });
      this.emitEvent(updatedState, 'task.updated');
      if (donePromise) {
        promisesToAwait.push(donePromise);
      }
    }

    // Bounded: the abort has already been signalled and the interrupted state
    // already emitted, so this wait is only a courtesy to children that stop
    // cleanly. A child wedged in a provider call must not hold the parent's
    // own interrupt open behind it.
    await withTimeout(Promise.allSettled(promisesToAwait), CHILD_INTERRUPT_TIMEOUT_MS);

    for (const { state } of tasksToInterrupt) {
      this.activeTasks.delete(state.agentId);
    }

    return interruptedCount;
  }

  // ── Background-agent control surfaces ────────────────────────────────────
  //
  // The model-facing half of background spawns, mirroring the
  // `BackgroundJobRegistry` idiom: conversation-fenced reads, terminal tasks
  // go "unreported" until a drain/read/interrupt claims them, and snapshots
  // are fresh projections, never live state.

  /** Fresh projection of one background agent, or `undefined` when unknown. */
  private backgroundRecord(agentId: string, conversationId: string): BackgroundTask | undefined {
    const record = this.backgroundTasks.get(agentId);
    if (!record) {
      return undefined;
    }
    // Agent ids are deterministic (`${toolCallId}:${index}`), so this fence —
    // not id secrecy — is the authorization boundary.
    if (record.state.conversationId !== conversationId) {
      return undefined;
    }
    return record;
  }

  private snapshotBackground(record: BackgroundTask): BackgroundAgentSnapshot {
    const { state } = record;
    return {
      agentId: state.agentId,
      title: state.title,
      status: state.status,
      isFinal: state.isFinal,
      progress: state.progress,
      result: state.result,
      error: state.error,
      totalTokens: state.usage?.totalTokens ?? 0,
    };
  }

  /** Snapshots of every background agent owned by the conversation, spawn order. */
  listBackgroundAgents(conversationId: string): BackgroundAgentSnapshot[] {
    const snapshots: BackgroundAgentSnapshot[] = [];
    for (const record of this.backgroundTasks.values()) {
      if (record.state.conversationId === conversationId) {
        snapshots.push(this.snapshotBackground(record));
      }
    }
    return snapshots;
  }

  /**
   * Interrupt one background agent by id. Returns its snapshot, or `undefined`
   * when no such agent belongs to the conversation. Already-terminal agents
   * are returned as-is (and marked reported — the caller saw the outcome).
   */
  async interruptAgent(
    agentId: string,
    conversationId: string,
    reason = 'Interrupted by parent agent'
  ): Promise<BackgroundAgentSnapshot | undefined> {
    const record = this.backgroundRecord(agentId, conversationId);
    if (!record) {
      return undefined;
    }

    if (record.state.isFinal) {
      record.reported = true;
      return this.snapshotBackground(record);
    }

    // S2: continuable agents are keepInbox — interrupt only aborts the current
    // turn (and parks the queue), never the whole agent. The durable flag, not
    // live-activation residency, decides routing: after a restart a cold
    // continuable child has no Activation but must still not be killed here.
    if (record.continuable && record.state.childConversationId) {
      const childId = record.state.childConversationId;
      try {
        await this.continuationManager?.interruptForParent?.(conversationId, childId);
      } catch {}
      // Do not mark Task terminal; the Activation stays available for followups.
      // Emit a progress event so UI shows interrupt, but keep isFinal false.
      this.emitEvent({ ...record.state, status: 'running' } as SubagentTaskState, 'task.updated');
      return this.snapshotBackground(record);
    }

    record.controller.abort();
    record.state = applyTaskPatch(record.state, { status: 'interrupted', error: reason });
    this.emitEvent(record.state, 'task.updated');
    record.reported = true;

    // Await settlement so the caller sees the real terminal state, not the
    // optimistic patch — bounded by the child executor honoring its signal.
    await record.donePromise;
    return this.snapshotBackground(record);
  }

  /**
   * Read a background agent's outcome. Terminal results are idempotent (never
   * consumed); a terminal read marks the agent reported. Live agents return
   * their progress instead.
   */
  readBackgroundOutput(
    agentId: string,
    conversationId: string
  ): { snapshot: BackgroundAgentSnapshot; text: string } | undefined {
    const record = this.backgroundRecord(agentId, conversationId);
    if (!record) {
      return undefined;
    }

    if (record.state.isFinal) {
      record.reported = true;
      const text = record.state.result ?? record.state.error ?? '';
      return { snapshot: this.snapshotBackground(record), text };
    }

    return {
      snapshot: this.snapshotBackground(record),
      text: record.state.progress ?? '(still running)',
    };
  }

  /**
   * Wait for a background agent to settle, up to `timeoutMs`. Resolves with
   * the snapshot at settlement or timeout — a timed-out agent keeps running.
   * An aborted `signal` resolves early with the live snapshot instead of
   * idling out the remaining timeout. A settled wait marks the agent reported.
   */
  async waitBackgroundAgent(
    agentId: string,
    timeoutMs: number,
    conversationId: string,
    options?: { signal?: AbortSignal }
  ): Promise<BackgroundAgentSnapshot | undefined> {
    const record = this.backgroundRecord(agentId, conversationId);
    if (!record) {
      return undefined;
    }

    if (!record.state.isFinal) {
      await Promise.race([
        record.donePromise,
        sleep(Math.max(0, timeoutMs), options?.signal),
      ]);
    }

    if (record.state.isFinal) {
      record.reported = true;
    }
    return this.snapshotBackground(record);
  }

  /**
   * Claim every unreported settled background agent for the conversation,
   * marking each reported. The turn loop injects one notice per drained
   * snapshot — several agents settling together cost one step, not one turn
   * each. Exactly-once delivery mirrors `BackgroundJobRegistry`.
   */
  drainBackgroundNotices(conversationId: string): BackgroundAgentSnapshot[] {
    const drained: BackgroundAgentSnapshot[] = [];
    for (const record of this.backgroundTasks.values()) {
      if (record.state.conversationId !== conversationId || !record.state.isFinal || record.reported) {
        continue;
      }
      record.reported = true;
      drained.push(this.snapshotBackground(record));
    }
    return drained;
  }

  /**
   * Forget every background record for a conversation (owner disposal). Live
   * one-shot agents are interrupted and awaited; live continuable children are
   * handed to the continuation manager (their records never settle via Task, so
   * awaiting them here would hang forever). Called on conversation deletion so
   * the map cannot grow without bound.
   */
  async clearConversationBackground(conversationId: string, reason?: string): Promise<number> {
    const liveOneShot: BackgroundTask[] = [];
    const ids: string[] = [];
    let continuableCount = 0;
    for (const [agentId, record] of this.backgroundTasks.entries()) {
      if (record.state.conversationId !== conversationId) {
        continue;
      }
      ids.push(agentId);
      if (record.state.isFinal) continue;
      if (record.continuable) {
        continuableCount += 1;
        const childId = record.state.childConversationId;
        if (childId) {
          try {
            await this.continuationManager?.interruptForParent?.(conversationId, childId);
          } catch (err) {
            // A failed interrupt must not block the delete path, but it must
            // also not vanish: the child may keep running against a
            // conversation that no longer exists.
            logger.warn('subagent.background_clear_interrupt_failed', {
              conversationId,
              childId,
              reason,
              error: err,
            });
          }
        }
      } else {
        liveOneShot.push(record);
      }
    }

    for (const record of liveOneShot) {
      record.controller.abort();
      record.reported = true;
    }
    // Bounded join: the records are dropped right after this either way, so a
    // wedged aborted turn must not hang conversation deletion. Abandoning the
    // loser is the intended semantics here — same trade as cascade stop.
    await withTimeout(
      Promise.allSettled(liveOneShot.map((record) => record.donePromise)),
      BACKGROUND_CLEAR_JOIN_TIMEOUT_MS
    );
    for (const agentId of ids) {
      this.backgroundTasks.delete(agentId);
    }

    return liveOneShot.length + continuableCount;
  }
}
