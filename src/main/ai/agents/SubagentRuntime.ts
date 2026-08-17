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
  agentIdFor,
  applyTaskPatch,
  buildTaskEnvelope,
  createTask,
  isTerminalTaskStatus,
  SubagentTaskState,
  TaskSlotQueue,
} from './subagentTasks';

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
  maxSteps?: number;
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

export interface SubagentRuntimeOptions {
  runtimeStateRepo?: Pick<RuntimeStateRepo, 'recordEvent'>;
  maxConcurrent?: number;
  /** Max nesting depth of subagent spawns (root = 0, children = 1, …). Default 3. */
  maxDepth?: number;
  childExecutor?: ChildTurnExecutor;
  onRuntimeEvent?: (envelope: RuntimeEventEnvelope) => void;
}

/** One live task's runtime handles, keyed by agentId. */
type ActiveTask = {
  state: SubagentTaskState;
  controller: AbortController;
  donePromise?: Promise<void>;
};

export class SubagentRuntime {
  private readonly runtimeStateRepo?: Pick<RuntimeStateRepo, 'recordEvent'>;
  private readonly slotQueue: TaskSlotQueue;
  private readonly maxDepth: number;
  private readonly childExecutor?: ChildTurnExecutor;
  private readonly onRuntimeEvent?: (envelope: RuntimeEventEnvelope) => void;
  private readonly activeTasks = new Map<string, ActiveTask>();
  private sequenceCounter = 0;

  constructor(options: SubagentRuntimeOptions = {}) {
    this.runtimeStateRepo = options.runtimeStateRepo;
    this.slotQueue = new TaskSlotQueue(options.maxConcurrent ?? 4);
    this.maxDepth = options.maxDepth ?? 3;
    this.childExecutor = options.childExecutor;
    this.onRuntimeEvent = options.onRuntimeEvent;
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
   * Returns false when nesting would exceed maxDepth — the caller should
   * omit the spawn_agent tool in this case so the model never attempts it.
   */
  canSpawn(depth: number): boolean {
    return depth < this.maxDepth && this.slotQueue.inUse < this.slotQueue.capacity;
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

  /** Emit task event envelope to repo if available. */
  private emitEvent(
    state: SubagentTaskState,
    activityType: 'task.started' | 'task.progress' | 'task.updated' | 'task.completed'
  ) {
    this.sequenceCounter += 1;
    const envelope = buildTaskEnvelope(state, activityType, {
      eventId: randomUUID(),
      sequence: this.sequenceCounter,
      occurredAt: new Date().toISOString(),
    });
    if (this.runtimeStateRepo) {
      this.runtimeStateRepo.recordEvent(envelope);
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
    tasks: Array<{
      title: string;
      prompt: string;
      model?: string;
      role?: string;
      outputFile?: string;
      tools?: string[];
      taskType?: string;
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

    // C4: compute nesting depth. Root tasks (no parentAgentId) start at 0.
    const depth = req.depth != null ? req.depth : 0;

    // C4: reject immediately if we would exceed maxDepth — no resource consumed.
    if (depth > this.maxDepth) {
      state = applyTaskPatch(state, {
        status: 'failed',
        error: `Nesting depth ${depth} exceeds maximum (${this.maxDepth})`,
      });
      return state;
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

    let releaseSlot: (() => void) | undefined;
    try {
      // C5: register in activeTasks only after the early-depth guard passes.
      this.activeTasks.set(state.agentId, { state, controller, donePromise });

      // C5: emit is now inside the try block so cleanup runs on any throw.
      this.emitEvent(state, 'task.started');

      // C4: pass the controller's signal so queue waiters can be cancelled atomically.
      releaseSlot = await this.slotQueue.acquire(req.conversationId, controller.signal);

      if (controller.signal.aborted || isTerminalTaskStatus(state.status)) {
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
      try { resolveDone(); } catch {}
    }

    return state;
  }

  /**
   * Cascade stop: Interrupt all live child tasks for a conversation.
   * Drains the queue and aborts controllers.
   */
  async interruptAll(conversationId: string, reason = 'Parent turn aborted'): Promise<number> {
    this.slotQueue.drainQueue(conversationId);

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

    await Promise.allSettled(promisesToAwait);

    for (const { state } of tasksToInterrupt) {
      this.activeTasks.delete(state.agentId);
    }

    return interruptedCount;
  }
}
