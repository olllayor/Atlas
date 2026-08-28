/**
 * S6 — Background liveness for the sidebar Working pill.
 *
 * Tracks whether a conversation has live subagent work after its turn has
 * settled. `working` means an agent-owned task/subagent is still running;
 * `monitoring` is reserved for watch loops (terminal, site dev server) when
 * they are the only live work. `null` means nothing live.
 *
 * In-memory only, never persisted — after a restart the registry is empty,
 * which is correct for orphaned work. Classification is per-transition, not
 * sticky, and idle counts as not live.
 */

import type { RuntimeEventEnvelope } from '../../../shared/contracts';

export type BackgroundLiveness = 'working' | 'monitoring' | null;

const TASK_EVENT_KINDS = {
  'task.started': 'started',
  'task.progress': 'progress',
  'task.updated': 'updated',
  'task.completed': 'completed',
} as const;

const MONITOR_TASK_TYPES = new Set(['shell', 'local_bash', 'terminal', 'site_dev_server', 'monitor']);
const INERT_TASK_TYPES = new Set(['plan']);

function isTerminalStatus(status: string | undefined | null): boolean {
  if (!status) return false;
  return ['completed', 'failed', 'stopped', 'cancelled', 'interrupted', 'idle', 'error'].includes(status.toLowerCase());
}

export class BackgroundLivenessService {
  // conversationId -> { agents: Set<taskId>, monitors: Set<taskId> }
  private readonly byConversation = new Map<string, { agents: Set<string>; monitors: Set<string> }>();

  recordTaskLiveness(input: {
    conversationId: string;
    taskId: string;
    taskType?: string | null;
    status?: string | null;
    kind: 'started' | 'progress' | 'updated' | 'completed';
    agentId?: string | null;
  }): void {
    const { conversationId, taskId, taskType, status, kind, agentId } = input;

    // Inert: never live
    if (taskType && INERT_TASK_TYPES.has(taskType.toLowerCase())) {
      this.drop(conversationId, taskId);
      return;
    }

    // Agent-owned shell/monitor is covered by its owning agent's liveness
    if (agentId && taskType && MONITOR_TASK_TYPES.has(taskType.toLowerCase())) {
      this.drop(conversationId, taskId);
      return;
    }

    // Terminal or idle -> not live
    if (kind === 'completed' || isTerminalStatus(status)) {
      this.drop(conversationId, taskId);
      return;
    }

    // Otherwise, drop then re-bucket (per-transition, not sticky)
    this.drop(conversationId, taskId);
    const bucket = this.byConversation.get(conversationId) ?? { agents: new Set<string>(), monitors: new Set<string>() };
    if (taskType && MONITOR_TASK_TYPES.has(taskType.toLowerCase())) {
      bucket.monitors.add(taskId);
    } else {
      bucket.agents.add(taskId);
    }
    this.byConversation.set(conversationId, bucket);
  }

  /**
   * Fold a runtime envelope into the registry, ignoring anything that is not
   * a task event.
   *
   * Every `task.*` row goes through here — it is the only path by which
   * one-shot fan-outs reach the sidebar pill, since `recordSubagentLiveness`
   * only ever sees continuable children.
   */
  recordTaskEnvelope(envelope: RuntimeEventEnvelope): void {
    const kind = TASK_EVENT_KINDS[envelope.activityType as keyof typeof TASK_EVENT_KINDS];
    if (!kind) return;

    const payload = (envelope.payload ?? {}) as Record<string, unknown>;
    const taskId =
      pick(payload.taskId) ?? envelope.agentId ?? pick(payload.agentId);
    if (!taskId) return;

    this.recordTaskLiveness({
      conversationId: envelope.conversationId,
      taskId,
      taskType: pick(payload.taskType) ?? null,
      status: pick(payload.status) ?? null,
      kind,
      // A task's own row owns its liveness; a shell an agent started does not,
      // which is what `parentAgentId` marks.
      agentId: pick(payload.parentAgentId) ?? null,
    });
  }

  recordSubagentLiveness(input: { conversationId: string; subagentId: string; status: 'running' | 'inactive' }): void {
    const { conversationId, subagentId, status } = input;
    if (status === 'running') {
      const bucket = this.byConversation.get(conversationId) ?? { agents: new Set<string>(), monitors: new Set<string>() };
      // Drop from monitors if it was there, then add to agents
      bucket.monitors.delete(subagentId);
      bucket.agents.add(subagentId);
      this.byConversation.set(conversationId, bucket);
    } else {
      this.drop(conversationId, subagentId);
    }
  }

  clearConversationLiveness(conversationId: string): void {
    this.byConversation.delete(conversationId);
  }

  getBackgroundLiveness(conversationId: string): BackgroundLiveness {
    const bucket = this.byConversation.get(conversationId);
    if (!bucket) return null;
    if (bucket.agents.size > 0) return 'working';
    if (bucket.monitors.size > 0) return 'monitoring';
    return null;
  }

  getAllLiveness(): Map<string, BackgroundLiveness> {
    const out = new Map<string, BackgroundLiveness>();
    for (const [conversationId, bucket] of this.byConversation.entries()) {
      if (bucket.agents.size > 0) out.set(conversationId, 'working');
      else if (bucket.monitors.size > 0) out.set(conversationId, 'monitoring');
    }
    return out;
  }

  private drop(conversationId: string, taskId: string): void {
    const bucket = this.byConversation.get(conversationId);
    if (!bucket) return;
    bucket.agents.delete(taskId);
    bucket.monitors.delete(taskId);
    if (bucket.agents.size === 0 && bucket.monitors.size === 0) {
      this.byConversation.delete(conversationId);
    }
  }
}

function pick(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
