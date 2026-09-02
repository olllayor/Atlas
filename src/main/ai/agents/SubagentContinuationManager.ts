/**
 * S2 — Continuable subagent continuation manager.
 *
 * Ported from harness `packages/subagent/subagent/src/continuation.ts` simplified
 * for Atlas single-process, better-sqlite3, and Task-based runtime.
 *
 * One durable `conversations` row (origin='subagent', mode='continuable') +
 * at most one live `Activation` holding the inbox FIFO. `Agent.inbox` is the
 * only queue — the manager has no second FIFO. Cold resume reconstructs an
 * Activation from the persisted row without provider help.
 *
 * Per-child mutex serializes concurrent `followup` / cold-resume so two rapid
 * calls cannot both create an Activation.
 */

import { randomUUID } from 'node:crypto';
import type { ConversationsRepo } from '../../db/repositories/conversationsRepo';
import type { RuntimeStateRepo } from '../../db/repositories/runtimeStateRepo';
import type { ChatSessionRuntime, ExecuteTurnResult } from '../core/ChatSessionRuntime';
import type { RuntimeEventEnvelope } from '../../../shared/contracts';
import { snapshotSubagentDescriptor } from './subagentDescriptor';

export type ContinuableStartSpec = {
  parentConversationId: string;
  parentTurnId: string;
  parentToolCallId: string;
  /**
   * Batch position of this task. Agent ids are deterministic
   * (`${parentToolCallId}:${agentIndex}`); omitting it collides two continuable
   * children spawned by the same fan-out tool call in descriptors and work-log ids.
   */
  agentIndex?: number;
  parentAgentId?: string;
  title: string;
  prompt: string;
  model?: string;
  tools?: string[];
  depth?: number;
  signal?: AbortSignal;
};

export type ContinuableStartResult = {
  childId: string;
  messageId: string;
};

export type SubagentFollowupOptions = {
  signal?: AbortSignal;
};

type QueuedMessage = {
  content: string;
  messageId: string;
};

type Activation = {
  childId: string;
  parentConversationId: string;
  mode: 'continuable';
  label: string;
  queue: QueuedMessage[];
  processing: boolean;
  currentController: AbortController | null;
  /** Wall-clock start of the in-flight turn, for live duration projections. */
  currentTurnStartedAt: number | null;
  ownedChildren: Set<string>;
  /**
   * Set by `interrupt()`, cleared by the next `followup()`. While parked, the
   * process loop drains nothing — queued messages wait for a waking send,
   * matching the harness contract and the control tools' wording.
   */
  parked: boolean;
  /** Set by `evict()`: stops the loop permanently. An evicted activation must never run another turn. */
  disposed?: boolean;
  /** Durable depth of this child (from spawn validation); followup turns keep it. */
  delegationDepth: number;
  /** Per-child composition captured at start; every turn reuses it. */
  model?: string;
  tools?: string[];
  createdAt: string;
};

export interface ContinuationManagerDeps {
  conversationsRepo: Pick<ConversationsRepo, 'createSubagentConversation' | 'getSubagentMeta' | 'delete' | 'getSummary'> & {
    getSummary: ConversationsRepo['getSummary'];
  };
  runtimeStateRepo?: Pick<RuntimeStateRepo, 'recordEvent'>;
  // Executes one child turn; must honor signal and persist when requested.
  executeTurn: (input: {
    childId: string;
    parentConversationId: string;
    prompt: string;
    model?: string;
    tools?: string[];
    depth?: number;
    parentAgentId?: string;
    signal: AbortSignal;
  }) => Promise<ExecuteTurnResult>;
  onRuntimeEvent?: (envelope: RuntimeEventEnvelope) => void;
  onLivenessChange?: (parentId: string, childId: string, status: 'running' | 'inactive') => void;
}

export class SubagentContinuationManager {
  private readonly activations = new Map<string, Activation>();
  private readonly mutexes = new Map<string, Promise<void>>();
  /**
   * Failure-only completion notices, drained exactly once by the parent's
   * next turn (`drainCompletionNotices`). Successes deliberately stay silent:
   * one-shot children already return their output through the spawn tool
   * call, and a notice per finished continuable turn would spam the parent
   * transcript — silence plus an inactive catalog row is the signal.
   */
  private readonly completionNotices = new Map<string, Array<{ childId: string; title: string; error: string }>>();
  private sequenceCounter = 0;

  constructor(private readonly deps: ContinuationManagerDeps) {}

  private async withLock<T>(childId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.mutexes.get(childId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((res) => (release = res));
    // Chain next after prev
    this.mutexes.set(childId, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      // Clean up if no further waiter chained beyond next
      // (next is now resolved; if current lock is still next, remove)
      if (this.mutexes.get(childId) === next) {
        // Keep resolved promise briefly to avoid race where a waiter started
        // between release and delete; just delete after a tick.
        queueMicrotask(() => {
          if (this.mutexes.get(childId) === next) this.mutexes.delete(childId);
        });
      }
    }
  }

  private emitDescriptor(activation: Activation, title: string, agentId: string, parentId: string, depth: number, model?: string, tools?: string[]): void {
    if (!this.deps.runtimeStateRepo) return;
    this.sequenceCounter += 1;
    const descriptor = snapshotSubagentDescriptor({
      mode: 'continuable',
      provider: 'atlas-turn-executor',
      label: title,
      agentId,
      parentConversationId: parentId,
      delegationDepth: depth,
      ...(model ? { model } : {}),
      ...(tools ? { toolFilter: tools } : {}),
    });
    const envelope: RuntimeEventEnvelope = {
      eventId: randomUUID(),
      conversationId: activation.childId,
      turnId: randomUUID(),
      requestId: agentId,
      sequence: this.sequenceCounter,
      occurredAt: new Date().toISOString(),
      activityType: 'subagent.descriptor' as const,
      tone: 'info',
      provider: 'system',
      providerEventType: 'subagent.descriptor',
      toolCallId: null,
      messageId: null,
      approvalId: null,
      agentId,
      parentToolCallId: agentId,
      payload: {
        subagentDescriptor: descriptor,
        agentId,
        parentToolCallId: agentId,
        title: descriptor.label,
        agentKind: 'agent',
      } as unknown as Record<string, unknown>,
    } as RuntimeEventEnvelope;
    try {
      this.deps.runtimeStateRepo.recordEvent(envelope as any);
    } catch (e) {
      // Let caller rollback child row
      throw e;
    }
    if (this.deps.onRuntimeEvent) this.deps.onRuntimeEvent(envelope);
  }

  /** Ensure an Activation exists, cold-resuming from DB if needed. */
  private ensureActivation(childId: string, parentId: string): Activation {
    let act = this.activations.get(childId);
    if (act) return act;
    // Verify child row exists and is continuable with correct parent
    const meta = this.deps.conversationsRepo.getSubagentMeta(childId);
    if (!meta || meta.origin !== 'subagent' || meta.mode !== 'continuable') {
      throw new Error(`Subagent ${childId} is not a continuable subagent`);
    }
    if (meta.parentId !== parentId) {
      throw new Error(`Parent mismatch for subagent ${childId}`);
    }
    act = {
      childId,
      parentConversationId: parentId,
      mode: 'continuable',
      label: meta.label ?? childId.slice(0, 8),
      queue: [],
      processing: false,
      currentController: null,
      currentTurnStartedAt: null,
      ownedChildren: new Set(),
      parked: false,
      // Cold resume trusts the persisted depth as the monotone floor — a resumed
      // child must never delegate as if it were top-level (harness depth rule).
      delegationDepth: meta.depth ?? 0,
      createdAt: new Date().toISOString(),
    };
    this.activations.set(childId, act);
    return act;
  }

  private ensureProcessing(activation: Activation): void {
    if (activation.processing) return;
    activation.processing = true;
    void this.processLoop(activation).finally(() => {
      activation.processing = false;
    });
  }

  private async processLoop(activation: Activation): Promise<void> {
    while (activation.queue.length > 0 && !activation.parked && !activation.disposed) {
      const next = activation.queue.shift()!;
      const controller = new AbortController();
      activation.currentController = controller;
      activation.currentTurnStartedAt = Date.now();
      let turnFailed = false;
      let failureMessage = '';
      try {
        const result = await this.deps.executeTurn({
          childId: activation.childId,
          parentConversationId: activation.parentConversationId,
          prompt: next.content,
          // Composition captured at start (persisted in the descriptor); every
          // turn of this child reuses it so overrides are never silently dropped.
          model: activation.model,
          tools: activation.tools,
          signal: controller.signal,
          parentAgentId: activation.childId, // for attribution nesting
          // Followup turns keep the child's durable depth — resetting to 0 would
          // let a deep chain respawn as top-level and bypass the global depth cap.
          depth: activation.delegationDepth,
        });
        // A turn that reports awaiting_approval or non-completed is effectively a failure for continuable
        if ((result as any)?.status && (result as any).status !== 'completed') {
          turnFailed = true;
          failureMessage = `Child turn ended with status ${(result as any).status}`;
        }
      } catch (err: unknown) {
        turnFailed = true;
        failureMessage = err instanceof Error ? err.message : String(err);
        // Swallow so next queued message still runs.
        // eslint-disable-next-line no-console
        console.error(`[continuation] turn failed for ${activation.childId}`, err);
      } finally {
        activation.currentController = null;
        activation.currentTurnStartedAt = null;
      }
      if (turnFailed) {
        const notices = this.completionNotices.get(activation.parentConversationId) ?? [];
        notices.push({ childId: activation.childId, title: activation.label, error: failureMessage || 'Child turn failed' });
        this.completionNotices.set(activation.parentConversationId, notices);
      }
    }
    // If queue empties and no owned children, this child is now idle for its parent.
    // Notify liveness so the parent's Working pill can clear.
    if (!activation.disposed && activation.queue.length === 0 && !activation.currentController && activation.ownedChildren.size === 0) {
      try {
        this.deps.onLivenessChange?.(activation.parentConversationId, activation.childId, 'inactive');
      } catch {}
    }
    // If queue empties (or parking interrupted the drain), remain idle until the
    // next followup or disposal. If this activation still owns live children, it stays
    // in "waiting" — not idle for disposal — until they are evicted.
  }

  /**
   * Start a new continuable child. Returns at inbox acceptance (messageId),
   * not turn completion.
   */
  async startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStartResult> {
    const parent = this.deps.conversationsRepo.getSummary(spec.parentConversationId);
    if (!parent) throw new Error(`Parent conversation ${spec.parentConversationId} not found`);

    const depth = spec.depth ?? 0;
    const agentId = `${spec.parentToolCallId}:${spec.agentIndex ?? 0}`;
    let childId: string | null = null;
    try {
      childId = this.deps.conversationsRepo.createSubagentConversation({
        parentConversationId: spec.parentConversationId,
        title: spec.title,
        delegationDepth: depth,
        agentId,
        mode: 'continuable',
        parentTurnId: spec.parentTurnId,
      });
      // Create activation before emitting descriptor so emit can find it for sequence
      const activation: Activation = {
        childId,
        parentConversationId: spec.parentConversationId,
        mode: 'continuable',
        label: spec.title,
        queue: [],
        processing: false,
        currentController: null,
        currentTurnStartedAt: null,
        ownedChildren: new Set(),
        parked: false,
        delegationDepth: depth,
        ...(spec.model ? { model: spec.model } : {}),
        ...(spec.tools ? { tools: [...spec.tools] } : {}),
        createdAt: new Date().toISOString(),
      };
      this.activations.set(childId, activation);
      // S3: link to parent's ownedChildren if parent is itself a continuable activation (nested)
      const parentAct = this.activations.get(spec.parentConversationId);
      if (parentAct) {
        parentAct.ownedChildren.add(childId);
      }
      try {
        this.deps.onLivenessChange?.(spec.parentConversationId, childId, 'running');
      } catch {}
      this.emitDescriptor(activation, spec.title, agentId, spec.parentConversationId, depth, spec.model, spec.tools);

      const messageId = randomUUID();
      activation.queue.push({ content: spec.prompt, messageId });
      this.ensureProcessing(activation);
      return { childId, messageId };
    } catch (err) {
      if (childId) {
        try {
          // Unlink from the parent FIRST — a parent stuck owning a deleted
          // child can never settle (whenIdle blocks on ownedChildren forever).
          this.activations.get(spec.parentConversationId)?.ownedChildren.delete(childId);
          this.activations.delete(childId);
          this.deps.conversationsRepo.delete(childId);
        } catch {}
      }
      throw err;
    }
  }

  /**
   * Followup: enqueue a new user message as next FIFO turn.
   * Returns messageId at inbox acceptance.
   */
  async followup(
    parentConversationId: string,
    childId: string,
    content: string,
    _options: SubagentFollowupOptions = {}
  ): Promise<string> {
    // Per-child mutex preserves FIFO even when first call blocks on cold resume
    return this.withLock(childId, async () => {
      // Authority check: exact live parent must match child's recorded parent
      const meta = this.deps.conversationsRepo.getSubagentMeta(childId);
      if (!meta || meta.mode !== 'continuable') throw new Error(`Subagent ${childId} not continuable`);
      if (meta.parentId !== parentConversationId) throw new Error(`Parent mismatch for subagent ${childId}`);
      // Also verify parent still exists (not deleted/archived)
      const parent = this.deps.conversationsRepo.getSummary(parentConversationId);
      if (!parent) throw new Error(`Parent ${parentConversationId} not found`);

      const activation = this.ensureActivation(childId, parentConversationId);
      // Bounded inbox (mimo feedback)
      if (activation.queue.length >= 10) throw new Error('Subagent inbox full (10 pending messages). Wait for it to drain.');

      const messageId = randomUUID();
      activation.queue.push({ content, messageId });
      // A waking send resumes a parked FIFO queue (harness interrupt semantics).
      activation.parked = false;
      try {
        this.deps.onLivenessChange?.(parentConversationId, childId, 'running');
      } catch {}
      this.ensureProcessing(activation);
      return messageId;
    });
  }

  /**
   * Interrupt one continuable child under exact-parent authority. Unlike
   * `interrupt()`, this is the model-facing path: a child addressed by id is
   * only interruptible by its own parent conversation, so one conversation's
   * model cannot reach another conversation's subagents. Absent or
   * non-continuable targets are accepted no-ops.
   */
  async interruptForParent(
    parentConversationId: string,
    childId: string
  ): Promise<{ accepted: true } | undefined> {
    return this.withLock(childId, async () => {
      const meta = this.deps.conversationsRepo.getSubagentMeta(childId);
      if (!meta || meta.origin !== 'subagent' || meta.mode !== 'continuable') {
        return undefined;
      }
      if (meta.parentId !== parentConversationId) {
        return undefined;
      }
      this.interrupt(childId);
      return { accepted: true } as const;
    });
  }

  /** Fire-and-return interrupt of current turn, keepInbox. Parks the queue. */
  interrupt(childId: string): { accepted: true } {
    const act = this.activations.get(childId);
    if (!act) return { accepted: true }; // absent = no-op per spec
    if (act.currentController) {
      try {
        act.currentController.abort();
      } catch {}
    }
    // Park the FIFO: queued messages wait for a waking send instead of auto-running.
    act.parked = true;
    return { accepted: true };
  }

  /** Live snapshot of one activation for listings; undefined when not resident. */
  getActivationStatus(childId: string): { processing: boolean; queued: number; since?: number } | undefined {
    const act = this.activations.get(childId);
    if (!act) return undefined;
    const processing = act.processing || act.currentController !== null;
    return {
      processing,
      queued: act.queue.length,
      ...(processing && act.currentTurnStartedAt !== null ? { since: act.currentTurnStartedAt } : {}),
    };
  }

  /** Resident child ids owned by ONE conversation — the fenced listing source. */
  listActivationsForParent(conversationId: string): Array<{ childId: string; processing: boolean; queued: number }> {
    const out: Array<{ childId: string; processing: boolean; queued: number }> = [];
    for (const act of this.activations.values()) {
      if (act.parentConversationId === conversationId) {
        out.push({
          childId: act.childId,
          processing: act.processing || act.currentController !== null,
          queued: act.queue.length,
        });
      }
    }
    return out;
  }

  /** Interrupt all activations owned by a conversation (parent), cascading through owned descendants. */
  interruptAllForConversation(conversationId: string): number {
    let count = 0;
    const interruptTree = (act: Activation): void => {
      this.interrupt(act.childId);
      count += 1;
      for (const owned of act.ownedChildren) {
        const child = this.activations.get(owned);
        if (child) interruptTree(child);
      }
    };
    for (const act of [...this.activations.values()]) {
      if (act.parentConversationId === conversationId) {
        interruptTree(act);
      }
    }
    return count;
  }

  /** Interrupt every live activation (app quit). */
  interruptAll(): number {
    let count = 0;
    for (const childId of [...this.activations.keys()]) {
      this.interrupt(childId);
      count += 1;
    }
    return count;
  }

  /** For tests / S3 drain: wait until activation idle (no live turn; parked queues count as idle; waiting for children counts as not idle). */
  async whenIdle(childId: string): Promise<void> {
    const act = this.activations.get(childId);
    if (!act) return;
    while (
      (act.processing || act.queue.length > 0 || act.currentController !== null || act.ownedChildren.size > 0) &&
      !act.parked
    ) {
      await new Promise((r) => setTimeout(r, 10));
    }
    // A parked activation may still have an in-flight turn winding down.
    while (act.currentController !== null) {
      await new Promise((r) => setTimeout(r, 10));
    }
    // Also wait for owned children to settle (child-first)
    for (const child of [...act.ownedChildren]) {
      await this.whenIdle(child);
    }
  }

  /** Evict activation on conversation delete — child-first, stopping every loop. */
  evict(childId: string): void {
    const act = this.activations.get(childId);
    if (act) {
      // Child-first: evict owned children before parent
      for (const owned of [...act.ownedChildren]) {
        this.evict(owned);
      }
      // Remove from parent's ownedChildren if parent is also a continuable activation
      const parentAct = this.activations.get(act.parentConversationId);
      if (parentAct) {
        parentAct.ownedChildren.delete(childId);
        // If parent now has no more owned children and is not processing, it's no longer waiting
        if (parentAct.ownedChildren.size === 0 && !parentAct.processing && parentAct.queue.length === 0 && !parentAct.currentController) {
          try {
            this.deps.onLivenessChange?.(parentAct.parentConversationId, parentAct.childId, 'inactive');
          } catch {}
          try {
            // Also update background liveness for the parent's parent (grandparent) if needed
            // (handled via the parent's own eviction or idle transition)
          } catch {}
        }
      }
      // Notify parent that this child is now inactive (for Working pill)
      try {
        this.deps.onLivenessChange?.(act.parentConversationId, childId, 'inactive');
      } catch {}
      // Stop the loop. Without this, the process loop keeps dequeuing and
      // executing turns for an activation nobody can reach anymore.
      act.disposed = true;
      act.parked = true;
      act.queue.length = 0;
      if (act.currentController) {
        try {
          act.currentController.abort();
        } catch {}
      }
    }
    if (act) {
      // completionNotices is keyed by parentConversationId, not childId — remove the child's notice from its parent bucket.
      const parentId = act.parentConversationId;
      const bucket = this.completionNotices.get(parentId);
      if (bucket) {
        const filtered = bucket.filter((n) => n.childId !== childId);
        if (filtered.length === 0) this.completionNotices.delete(parentId);
        else this.completionNotices.set(parentId, filtered);
      }
    }
    this.activations.delete(childId);
    this.mutexes.delete(childId);
  }

  /**
   * Evict every activation owned by a conversation (owner disposal, e.g.
   * conversation deleted). Child-first recursion handles nested trees; also
   * drops any completion notices the conversation never drained.
   */
  evictForConversation(conversationId: string): number {
    const roots = [...this.activations.values()].filter(
      (act) => act.parentConversationId === conversationId
    );
    for (const act of roots) {
      this.evict(act.childId);
    }
    this.completionNotices.delete(conversationId);
    return roots.length;
  }

  /** S3: drain completion notices for a parent (exactly once). */
  drainCompletionNotices(parentConversationId: string): Array<{ childId: string; title: string; error: string }> {
    const notices = this.completionNotices.get(parentConversationId);
    if (!notices || notices.length === 0) return [];
    this.completionNotices.delete(parentConversationId);
    return notices;
  }

  /** For observability: list active childIds. */
  listActivations(): string[] {
    return [...this.activations.keys()];
  }

  getActivation(childId: string): Activation | undefined {
    return this.activations.get(childId);
  }
}
