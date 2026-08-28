/**
 * T3 — Client fold for Subagent Activity and Roster (`docs/plans/agents/03-agents-panel-and-quiet-timeline.md`).
 *
 * A pure function over persisted activities (`WorkLogEntry[]`) folding them into an `AgentPanelModel`.
 * Pure TypeScript — zero React or DOM dependencies for complete testability.
 */

import type { RuntimeTaskStatus, RuntimeTaskUsage, WorkLogEntry } from '../../shared/contracts';
import { getWorkLogAgentKind, mergeTaskUsage } from '../../shared/runtimeActivity';

export type RuntimeAgent = {
  id: string;
  kind: 'subagent' | 'nested';
  title: string;
  role: string | null;
  model: string | null;
  status: RuntimeTaskStatus;
  activationCount: number;
  usage: RuntimeTaskUsage | null;
  progress: string | null;
  lastToolName: string | null;
  result: string | null;
  error: string | null;
  outputFile: string | null;
  parentAgentId: string | null;
  /** Spawn tool call that created this agent — how a CTA pins its batch membership. */
  parentToolCallId: string | null;
  recentActivity: ReadonlyArray<{ at: string; summary: string }>; // ring buffer, cap 6
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type AgentPanelModel = {
  agents: RuntimeAgent[];
  activeAgents: RuntimeAgent[];
  settledAgents: RuntimeAgent[];
  totalTokens: number;
};

const TERMINAL_STATUSES: ReadonlySet<RuntimeTaskStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

const ACTIVE_STATUSES: ReadonlySet<RuntimeTaskStatus> = new Set([
  'pending',
  'running',
  'waiting',
]);

export function isTerminalAgentStatus(s: RuntimeTaskStatus): boolean {
  return TERMINAL_STATUSES.has(s);
}

export function isActiveAgentStatus(s: RuntimeTaskStatus): boolean {
  return ACTIVE_STATUSES.has(s);
}

/**
 * Returns true if an entry represents background work (e.g. shells, monitors, un-attributed tools)
 * rather than a dedicated subagent.
 */
export function isBackgroundTaskActivity(entry: WorkLogEntry): boolean {
  const kind = getWorkLogAgentKind(entry);
  return kind !== 'agent';
}

function truncateSummary(text: string, maxLen = 180): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1).trimEnd()}…`;
}

function pushActivityRing(
  ring: ReadonlyArray<{ at: string; summary: string }>,
  at: string,
  rawSummary: string
): ReadonlyArray<{ at: string; summary: string }> {
  const summary = truncateSummary(rawSummary);
  if (!summary) return ring;

  // Deduplicate consecutive identical summaries
  const last = ring[ring.length - 1];
  if (last && last.summary === summary) {
    return ring;
  }

  const next = [...ring, { at, summary }];
  if (next.length > 6) {
    return next.slice(next.length - 6);
  }
  return next;
}

/**
 * Fold sequence-ordered `WorkLogEntry[]` into `AgentPanelModel`.
 */
export function foldAgents(activities: readonly WorkLogEntry[]): AgentPanelModel {
  const agentMap = new Map<string, RuntimeAgent>();

  for (const entry of activities) {
    // Only process subagent tasks/tool calls (agentKind === 'agent' or explicitly stamped)
    if (isBackgroundTaskActivity(entry)) {
      continue;
    }

    const payload = entry.payload ?? {};
    const agentId = (payload.agentId as string | undefined) ?? (payload.taskId as string | undefined) ?? entry.id;
    if (!agentId) continue;

    const reportedStatus: RuntimeTaskStatus =
      (payload.status as RuntimeTaskStatus | undefined) ??
      (entry.status === 'error' || entry.status === 'denied'
        ? 'failed'
        : entry.status === 'completed' || entry.status === 'resolved'
        ? 'completed'
        : 'running');

    const incomingUsage = payload.usage as RuntimeTaskUsage | undefined;
    const incomingResult = typeof payload.result === 'string' ? payload.result : null;
    const incomingError = typeof payload.error === 'string' ? payload.error : (payload.errorMessage as string | undefined) ?? null;
    const incomingProgress = typeof payload.progress === 'string' ? payload.progress : entry.summary;
    const incomingToolName = entry.toolType ?? (payload.toolName as string | undefined) ?? null;
    const incomingOutputFile = (payload.outputFile as string | undefined) ?? null;
    const incomingRole = (payload.role as string | undefined) ?? null;
    const incomingModel = (payload.model as string | undefined) ?? null;
    const incomingTitle = entry.title || (payload.title as string | undefined) || `Agent ${agentId}`;
    const parentAgentId = (payload.parentAgentId as string | undefined) ?? null;
    const parentToolCallId =
      entry.parentToolCallId ??
      (payload.parentToolCallId as string | undefined) ??
      (payload.toolCallId as string | undefined) ??
      null;
    const timestamp = entry.updatedAt || entry.createdAt || (entry as any).occurredAt || new Date().toISOString();

    const existing = agentMap.get(agentId);

    if (entry.activityType === 'task.started') {
      if (!existing) {
        const agent: RuntimeAgent = {
          id: agentId,
          kind: parentAgentId ? 'nested' : 'subagent',
          title: incomingTitle,
          role: incomingRole,
          model: incomingModel,
          status: reportedStatus,
          activationCount: 1,
          usage: incomingUsage ?? null,
          progress: incomingProgress,
          lastToolName: incomingToolName,
          result: null,
          error: null,
          outputFile: incomingOutputFile,
          parentAgentId,
          parentToolCallId,
          recentActivity: pushActivityRing([], timestamp, incomingProgress ?? 'Task started'),
          startedAt: timestamp,
          completedAt: null,
          updatedAt: timestamp,
        };
        agentMap.set(agentId, agent);
      } else {
        // Is this event in chronological order after completion? (Reactivation)
        const isReactivation = existing.completedAt && timestamp >= existing.completedAt;

        if (isReactivation) {
          const agent: RuntimeAgent = {
            ...existing,
            title: incomingTitle || existing.title,
            role: incomingRole ?? existing.role,
            model: incomingModel ?? existing.model,
            status: reportedStatus,
            activationCount: existing.activationCount + 1,
            usage: mergeTaskUsage(existing.usage ?? undefined, incomingUsage) ?? null,
            progress: incomingProgress ?? 'Task restarted',
            lastToolName: incomingToolName ?? existing.lastToolName,
            result: null, // clear previous run's result on reactivation
            error: null,  // clear previous run's error on reactivation
            outputFile: incomingOutputFile ?? existing.outputFile,
            parentToolCallId: existing.parentToolCallId ?? parentToolCallId,
            recentActivity: pushActivityRing(existing.recentActivity, timestamp, incomingProgress ?? 'Task restarted'),
            startedAt: timestamp,
            completedAt: null,
            updatedAt: timestamp,
          };
          agentMap.set(agentId, agent);
        } else {
          // Late-arriving start event (out-of-order) for an already completed run:
          // fill metadata only; preserve sticky terminal status, result, error, completedAt.
          const agent: RuntimeAgent = {
            ...existing,
            title: existing.title || incomingTitle,
            role: existing.role ?? incomingRole,
            model: existing.model ?? incomingModel,
            parentToolCallId: existing.parentToolCallId ?? parentToolCallId,
            startedAt: existing.startedAt ? (timestamp < existing.startedAt ? timestamp : existing.startedAt) : timestamp,
            updatedAt: timestamp,
          };
          agentMap.set(agentId, agent);
        }
      }
      continue;
    }

    if (!existing) {
      // Completion can create: terminal row without a preceding start row still creates agent
      const isTerminal = isTerminalAgentStatus(reportedStatus);
      const agent: RuntimeAgent = {
        id: agentId,
        kind: parentAgentId ? 'nested' : 'subagent',
        title: incomingTitle,
        role: incomingRole,
        model: incomingModel,
        status: reportedStatus,
        activationCount: 1,
        usage: incomingUsage ?? null,
        progress: incomingProgress,
        lastToolName: incomingToolName,
        result: incomingResult,
        error: incomingError,
        outputFile: incomingOutputFile,
        parentAgentId,
        parentToolCallId,
        recentActivity: pushActivityRing([], timestamp, incomingProgress ?? incomingResult ?? 'Activity logged'),
        startedAt: timestamp,
        completedAt: isTerminal ? timestamp : null,
        updatedAt: timestamp,
      };
      agentMap.set(agentId, agent);
      continue;
    }

    // Existing agent update
    const alreadyTerminal = isTerminalAgentStatus(existing.status);
    const newIsTerminal = isTerminalAgentStatus(reportedStatus);

    // Late non-final events cannot downgrade a sticky terminal status
    const finalStatus = alreadyTerminal ? existing.status : reportedStatus;
    const completedAt = alreadyTerminal
      ? existing.completedAt
      : newIsTerminal
      ? timestamp
      : existing.completedAt;

    const mergedUsage = mergeTaskUsage(existing.usage ?? undefined, incomingUsage) ?? null;

    const updatedAgent: RuntimeAgent = {
      ...existing,
      title: existing.title || incomingTitle,
      role: existing.role ?? incomingRole,
      model: existing.model ?? incomingModel,
      status: finalStatus,
      usage: mergedUsage,
      progress: incomingProgress ?? existing.progress,
      lastToolName: incomingToolName ?? existing.lastToolName,
      result: alreadyTerminal ? (existing.result ?? incomingResult) : (incomingResult ?? existing.result),
      error: alreadyTerminal ? (existing.error ?? incomingError) : (incomingError ?? existing.error),
      outputFile: existing.outputFile ?? incomingOutputFile,
      parentToolCallId: existing.parentToolCallId ?? parentToolCallId,
      recentActivity: incomingProgress
        ? pushActivityRing(existing.recentActivity, timestamp, incomingProgress)
        : existing.recentActivity,
      completedAt,
      updatedAt: timestamp,
    };

    agentMap.set(agentId, updatedAgent);
  }

  // Convert map to bounded list (max 100 agents)
  const agents = Array.from(agentMap.values()).slice(0, 100);

  const activeAgents = agents.filter((a) => isActiveAgentStatus(a.status));
  const settledAgents = agents.filter((a) => !isActiveAgentStatus(a.status));

  const totalTokens = agents.reduce((acc, a) => acc + (a.usage?.totalTokens ?? 0), 0);

  return {
    agents,
    activeAgents,
    settledAgents,
    totalTokens,
  };
}

/**
 * The agents a single spawn batch owns, in roster order.
 *
 * Membership is pinned by the spawn tool call: agent ids are minted as
 * `${parentToolCallId}:${index}` (`subagentTasks.agentIdFor`), and every task
 * payload repeats the linkage, so a batch can be named without the transcript
 * having to keep its own list. Rows persisted before the linkage existed match
 * on the id prefix instead.
 */
export function selectBatchAgents(
  agents: readonly RuntimeAgent[],
  toolCallIds: readonly string[]
): RuntimeAgent[] {
  if (toolCallIds.length === 0) return [];
  const owned = new Set(toolCallIds);
  return agents.filter(
    (agent) =>
      (agent.parentToolCallId != null && owned.has(agent.parentToolCallId)) ||
      toolCallIds.some((id) => agent.id.startsWith(`${id}:`))
  );
}

/** Batch counters the Spawn CTA reads. `elapsedMs` is the longest live run. */
export function summarizeBatch(agents: readonly RuntimeAgent[], nowMs: number) {
  let active = 0;
  let totalTokens = 0;
  let elapsedMs = 0;

  for (const agent of agents) {
    if (isActiveAgentStatus(agent.status)) active += 1;
    totalTokens += agent.usage?.totalTokens ?? 0;
    const started = agent.startedAt ? Date.parse(agent.startedAt) : NaN;
    if (!Number.isNaN(started)) {
      const end = agent.completedAt ? Date.parse(agent.completedAt) : nowMs;
      const span = (Number.isNaN(end) ? nowMs : end) - started;
      if (span > elapsedMs) elapsedMs = span;
    }
  }

  return { total: agents.length, active, settled: agents.length - active, totalTokens, elapsedMs };
}
