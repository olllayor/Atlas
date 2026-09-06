/**
 * T3 — Client fold for Subagent Activity and Roster (`docs/plans/agents/03-agents-panel-and-quiet-timeline.md`).
 *
 * A pure function over persisted activities (`WorkLogEntry[]`) folding them into an `AgentPanelModel``.
 * Pure TypeScript — zero React or DOM dependencies for complete testability.
 */

import type { RuntimeTaskStatus, RuntimeTaskUsage, WorkLogEntry } from '../../shared/contracts';
import { getWorkLogAgentKind, mergeTaskUsage } from '../../shared/runtimeActivity';

export type RuntimeAgentKind = 'subagent' | 'nested' | 'workflow' | 'workflow_agent';

export type RuntimePhase = {
  index: number;
  title: string;
};

export type RuntimeRunHandles = {
  runId?: string;
  scriptPath?: string;
  transcriptDir?: string;
  sessionUrl?: string;
};

export type RuntimeAgent = {
  id: string;
  kind: RuntimeAgentKind;
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
  toolCount: number;
  reasoningEffort: string | null;
  // ── Workflow linkage (null when flat) ──
  /** Stable workflow run id this agent belongs to (coordinator id for members). */
  workflowId: string | null;
  workflowName: string | null;
  phaseIndex: number | null;
  phaseTitle: string | null;
  /** Ordered phases (coordinator repeats on every row so start can age out). */
  phases: ReadonlyArray<RuntimePhase> | null;
  runHandles: RuntimeRunHandles | null;
  agentPath: string | null;
  /** Position inside its workflow run (stable slot). */
  agentIndex: number | null;
  attempt: number | null;
};

export type RuntimeWorkflow = {
  id: string;
  name: string;
  status: RuntimeTaskStatus;
  phases: ReadonlyArray<RuntimePhase>;
  members: RuntimeAgent[];
  coordinator: RuntimeAgent | null;
  parentToolCallId: string | null;
  totalTokens: number;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  runHandles: RuntimeRunHandles | null;
};

export type AgentPanelModel = {
  agents: RuntimeAgent[];
  activeAgents: RuntimeAgent[];
  settledAgents: RuntimeAgent[];
  totalTokens: number;
  workflows: RuntimeWorkflow[];
  /** Flat agents not in any workflow (direct + nested). */
  directAgents: RuntimeAgent[];
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
 * Monitoring-pill rule: only pending/running/waiting present as Working.
 * Idle is nonterminal in state but settled in presentation — it must never
 * pin a Working indicator.
 */
export function isWorkingAgentStatus(s: RuntimeTaskStatus): boolean {
  return isActiveAgentStatus(s);
}

/** Settled visual: terminal + idle. Idle keeps its roster row, resumable. */
export function isSettledVisualStatus(s: RuntimeTaskStatus): boolean {
  return !isActiveAgentStatus(s);
}

/**
 * Returns true if an entry represents background work (e.g. shells, monitors, un-attributed tools)
 * rather than a dedicated subagent.
 */
export function isBackgroundTaskActivity(entry: WorkLogEntry): boolean {
  const kind = getWorkLogAgentKind(entry);
  return kind !== 'agent';
}

/** Provider-synthesized rows that belong only in the Agents surface. */
export function isTimelineBypassEntry(entry: Pick<WorkLogEntry, 'payload'>): boolean {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  return payload.timelineBypass === true;
}

/**
 * Agent-attributed tool rows re-home to the panel.
 * Any `tool.*` row carrying an agent linkage (top-level or payload) belongs
 * to its owning agent's progress/recent-activity, never to the main chat.
 * Background shells (no agent linkage) stay ordinary work-log rows.
 */
export function isAgentAttributedToolEntry(
  entry: Pick<WorkLogEntry, 'payload' | 'agentId' | 'activityType'>
): boolean {
  if (!entry.activityType.startsWith('tool.')) return false;
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  const agentId =
    (entry as { agentId?: string | null }).agentId ??
    (payload.agentId as string | undefined) ??
    (payload.taskId as string | undefined) ??
    null;
  return agentId != null && agentId !== '';
}

/**
 * Quiet-timeline filter for the main work log.
 * Drops agent-attributed tool rows and timelineBypass rows; keeps everything
 * else (including background shells) exactly as before.
 */
export function filterQuietTimeline<T extends WorkLogEntry>(entries: readonly T[]): T[] {
  return entries.filter((entry) => {
    if (isTimelineBypassEntry(entry)) return false;
    if (isAgentAttributedToolEntry(entry)) return false;
    return true;
  });
}

/** Format tokens cleanly with k / M suffixes matching the design specs (e.g. 636k, 1.2M). */
export function formatTokens(total: number): string {
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`;
  if (total >= 10_000) {
    const roundedK = Math.round(total / 1000);
    // 999_500+ would round to "1000k" — roll over to megabytes instead.
    if (roundedK >= 1000) return `${(total / 1_000_000).toFixed(1)}M`;
    return `${roundedK}k`;
  }
  if (total >= 1_000) return `${(total / 1000).toFixed(1)}k`;
  return total.toLocaleString();
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

function asPhaseList(value: unknown): ReadonlyArray<RuntimePhase> | null {
  if (!Array.isArray(value)) return null;
  const phases: RuntimePhase[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item == null) continue;
    const rec = item as Record<string, unknown>;
    const index = typeof rec.index === 'number' ? rec.index : phases.length;
    const title = typeof rec.title === 'string' ? rec.title : `Phase ${index + 1}`;
    phases.push({ index, title });
  }
  if (phases.length === 0) return null;
  // Deterministic order, dedupe by index (defensive: upstream may resend).
  const byIndex = new Map<number, RuntimePhase>();
  for (const phase of phases) {
    if (!byIndex.has(phase.index)) byIndex.set(phase.index, phase);
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

function asRunHandles(value: unknown): RuntimeRunHandles | null {
  if (typeof value !== 'object' || value == null) return null;
  const rec = value as Record<string, unknown>;
  const handles: RuntimeRunHandles = {};
  if (typeof rec.runId === 'string') handles.runId = rec.runId;
  if (typeof rec.scriptPath === 'string') handles.scriptPath = rec.scriptPath;
  if (typeof rec.transcriptDir === 'string') handles.transcriptDir = rec.transcriptDir;
  if (typeof rec.sessionUrl === 'string' && /^https?:\/\//.test(rec.sessionUrl)) {
    handles.sessionUrl = rec.sessionUrl;
  }
  return Object.keys(handles).length > 0 ? handles : null;
}

function pickNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Canonical identity for a task row.
 *
 * Workflow members key on their stable slot (`workflowId:agentIndex`), never
 * per-attempt agent id, so retries reactivate one identity (ordinal++) instead
 * of duplicating rows. All other rows key on agentId/taskId as before.
 */
function canonicalAgentId(payload: Record<string, unknown>, fallbackId: string): string {
  const workflowId = pickString(payload.workflowId);
  const agentIndex = pickNumber(payload.agentIndex);
  if (workflowId != null && agentIndex != null) {
    return `${workflowId}:${agentIndex}`;
  }
  return fallbackId;
}

function isCoordinatorPayload(payload: Record<string, unknown>, canonicalId: string): boolean {
  const taskType = typeof payload.taskType === 'string' ? payload.taskType.toLowerCase() : '';
  if (taskType === 'workflow' || taskType === 'local_workflow') return true;
  if (payload.phases != null || payload.workflowName != null) {
    const workflowId = pickString(payload.workflowId);
    // A coordinator either omits workflowId or names itself.
    if (workflowId == null || workflowId === canonicalId) return true;
    // A row carrying its own agentId equal to workflowId is the coordinator.
    const agentId = pickString(payload.agentId) ?? pickString(payload.taskId);
    if (agentId != null && agentId === workflowId) return true;
  }
  return false;
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

    const payload = (entry.payload ?? {}) as Record<string, unknown>;
    const rawAgentId =
      pickString(payload.agentId) ??
      pickString(payload.taskId) ??
      entry.agentId ??
      entry.id;
    if (!rawAgentId) continue;
    const agentId = canonicalAgentId(payload, rawAgentId);
    const coordinatorHint = isCoordinatorPayload(payload, agentId);

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
    const incomingToolName = entry.toolType ?? (payload.toolName as string | undefined) ?? (payload.lastToolName as string | undefined) ?? null;
    const incomingOutputFile = (payload.outputFile as string | undefined) ?? null;
    const incomingRole = (payload.role as string | undefined) ?? null;
    const incomingModel = (payload.model as string | undefined) ?? null;
    // Never invent an effort level: the emitter rarely sends one (linkage
    // carries `effort`, older rows `reasoningEffort`/`priority`), so unknown
    // stays null and the UI hides the segment instead of printing "high".
    const incomingReasoningEffort =
      (payload.effort as string | undefined) ??
      (payload.reasoningEffort as string | undefined) ??
      (payload.priority as string | undefined) ??
      null;
    const usageToolUses =
      incomingUsage && typeof incomingUsage.toolUses === 'number' ? incomingUsage.toolUses : 0;
    const explicitToolCount = Math.max(
      typeof payload.toolCount === 'number' ? payload.toolCount : 0,
      typeof payload.toolCallCount === 'number' ? payload.toolCallCount : 0,
      usageToolUses
    );
    const isToolCallEvent = entry.activityType.startsWith('tool.') || entry.toolCallId != null || entry.toolType != null;
    const incomingTitle = entry.title || (payload.title as string | undefined) || `Agent ${agentId}`;
    const parentAgentId = (payload.parentAgentId as string | undefined) ?? null;
    const parentToolCallId =
      entry.parentToolCallId ??
      (payload.parentToolCallId as string | undefined) ??
      (payload.toolCallId as string | undefined) ??
      null;
    const timestamp = entry.updatedAt || entry.createdAt || (entry as any).occurredAt || new Date().toISOString();

    // Workflow linkage (repeated on every row so start can age out).
    const incomingWorkflowId =
      pickString(payload.workflowId) ?? (coordinatorHint ? agentId : null);
    const incomingWorkflowName = pickString(payload.workflowName) ?? null;
    const incomingPhaseIndex = pickNumber(payload.phaseIndex);
    const incomingPhaseTitle = pickString(payload.phaseTitle) ?? null;
    const incomingPhases = asPhaseList(payload.phases);
    const incomingRunHandles = asRunHandles(payload.runHandles);
    // scriptPath may arrive top-level (older emitters) or inside runHandles.
    const incomingScriptPath =
      pickString(payload.scriptPath) ?? incomingRunHandles?.scriptPath ?? null;
    const mergedHandles: RuntimeRunHandles | null =
      incomingRunHandles != null || incomingScriptPath != null
        ? { ...(incomingRunHandles ?? {}), ...(incomingScriptPath ? { scriptPath: incomingScriptPath } : {}) }
        : null;
    const incomingAgentPath = pickString(payload.agentPath) ?? null;
    const incomingAgentIndex = pickNumber(payload.agentIndex);
    const incomingAttempt = pickNumber(payload.attempt);

    const existing = agentMap.get(agentId);

    const kindFor = (isCoordinator: boolean): RuntimeAgentKind => {
      if (isCoordinator) return 'workflow';
      if (incomingWorkflowId != null) return 'workflow_agent';
      return parentAgentId ? 'nested' : 'subagent';
    };

    if (entry.activityType === 'task.started') {
      if (!existing) {
        const isCoordinator = coordinatorHint;
        const agent: RuntimeAgent = {
          id: agentId,
          kind: kindFor(isCoordinator),
          title: incomingWorkflowName && isCoordinator ? (incomingTitle || incomingWorkflowName) : incomingTitle,
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
          toolCount: Math.max(explicitToolCount, isToolCallEvent ? 1 : 0),
          reasoningEffort: incomingReasoningEffort,
          workflowId: incomingWorkflowId,
          workflowName: incomingWorkflowName,
          phaseIndex: incomingPhaseIndex,
          phaseTitle: incomingPhaseTitle,
          phases: incomingPhases,
          runHandles: mergedHandles,
          agentPath: incomingAgentPath,
          agentIndex: incomingAgentIndex,
          attempt: incomingAttempt,
        };
        agentMap.set(agentId, agent);
      } else {
        // Is this event in chronological order after completion? (Reactivation)
        const isReactivation = existing.completedAt && timestamp >= existing.completedAt;

        if (isReactivation) {
          const agent: RuntimeAgent = {
            ...existing,
            kind: existing.kind === 'workflow' || coordinatorHint ? 'workflow' : existing.kind,
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
            toolCount: Math.max(existing.toolCount, explicitToolCount),
            reasoningEffort: incomingReasoningEffort ?? existing.reasoningEffort,
            workflowId: existing.workflowId ?? incomingWorkflowId,
            workflowName: existing.workflowName ?? incomingWorkflowName,
            phaseIndex: incomingPhaseIndex ?? existing.phaseIndex,
            phaseTitle: incomingPhaseTitle ?? existing.phaseTitle,
            phases: incomingPhases ?? existing.phases,
            runHandles: mergedHandles ?? existing.runHandles,
            agentPath: incomingAgentPath ?? existing.agentPath,
            agentIndex: incomingAgentIndex ?? existing.agentIndex,
            attempt: incomingAttempt ?? existing.attempt,
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
            toolCount: Math.max(existing.toolCount, explicitToolCount),
            reasoningEffort: incomingReasoningEffort ?? existing.reasoningEffort,
            workflowId: existing.workflowId ?? incomingWorkflowId,
            workflowName: existing.workflowName ?? incomingWorkflowName,
            phaseIndex: existing.phaseIndex ?? incomingPhaseIndex,
            phaseTitle: existing.phaseTitle ?? incomingPhaseTitle,
            phases: existing.phases ?? incomingPhases,
            runHandles: existing.runHandles ?? mergedHandles,
            agentPath: existing.agentPath ?? incomingAgentPath,
            agentIndex: existing.agentIndex ?? incomingAgentIndex,
          };
          agentMap.set(agentId, agent);
        }
      }
      continue;
    }

    if (!existing) {
      // Completion can create: terminal row without a preceding start row still creates agent
      const isTerminal = isTerminalAgentStatus(reportedStatus);
      const isCoordinator = coordinatorHint;
      const agent: RuntimeAgent = {
        id: agentId,
        kind: kindFor(isCoordinator),
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
        toolCount: Math.max(explicitToolCount, isToolCallEvent ? 1 : 0),
        reasoningEffort: incomingReasoningEffort,
        workflowId: incomingWorkflowId,
        workflowName: incomingWorkflowName,
        phaseIndex: incomingPhaseIndex,
        phaseTitle: incomingPhaseTitle,
        phases: incomingPhases,
        runHandles: mergedHandles,
        agentPath: incomingAgentPath,
        agentIndex: incomingAgentIndex,
        attempt: incomingAttempt,
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
    const updatedToolCount = Math.max(
      existing.toolCount + (isToolCallEvent ? 1 : 0),
      explicitToolCount
    );

    const updatedAgent: RuntimeAgent = {
      ...existing,
      kind: existing.kind === 'workflow' || coordinatorHint ? 'workflow' : existing.kind === 'workflow_agent' || incomingWorkflowId != null ? 'workflow_agent' : existing.kind,
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
      toolCount: updatedToolCount,
      reasoningEffort: incomingReasoningEffort ?? existing.reasoningEffort,
      workflowId: existing.workflowId ?? incomingWorkflowId,
      workflowName: existing.workflowName ?? incomingWorkflowName,
      phaseIndex: incomingPhaseIndex ?? existing.phaseIndex,
      phaseTitle: incomingPhaseTitle ?? existing.phaseTitle,
      phases: incomingPhases ?? existing.phases,
      runHandles: mergedHandles ?? existing.runHandles,
      agentPath: incomingAgentPath ?? existing.agentPath,
      agentIndex: incomingAgentIndex ?? existing.agentIndex,
      attempt: incomingAttempt ?? existing.attempt,
    };

    agentMap.set(agentId, updatedAgent);
  }

  // Convert map to bounded list (max 100 agents). Insertion order is
  // first-seen order, so keep the newest rows — dropping the tail would hide
  // the latest fan-out behind the earliest one.
  const allAgents = Array.from(agentMap.values());
  const agents = allAgents.length > 100 ? allAgents.slice(allAgents.length - 100) : allAgents;

  const activeAgents = agents.filter((a) => isActiveAgentStatus(a.status));
  const settledAgents = agents.filter((a) => !isActiveAgentStatus(a.status));

  const totalTokens = agents.reduce((acc, a) => acc + (a.usage?.totalTokens ?? 0), 0);

  const workflows = buildWorkflows(agents);
  const workflowMemberIds = new Set<string>();
  const workflowCoordinatorIds = new Set<string>();
  for (const workflow of workflows) {
    if (workflow.coordinator) workflowCoordinatorIds.add(workflow.coordinator.id);
    for (const member of workflow.members) workflowMemberIds.add(member.id);
  }
  const directAgents = agents.filter(
    (agent) => !workflowMemberIds.has(agent.id) && !workflowCoordinatorIds.has(agent.id)
  );

  return {
    agents,
    activeAgents,
    settledAgents,
    totalTokens,
    workflows,
    directAgents,
  };
}

function buildWorkflows(agents: RuntimeAgent[]): RuntimeWorkflow[] {
  const byWorkflowId = new Map<string, { coordinator: RuntimeAgent | null; members: RuntimeAgent[] }>();

  for (const agent of agents) {
    if (agent.kind === 'workflow') {
      const id = agent.workflowId ?? agent.id;
      const bucket = byWorkflowId.get(id) ?? { coordinator: null, members: [] };
      bucket.coordinator = agent;
      byWorkflowId.set(id, bucket);
      continue;
    }
    if (agent.kind === 'workflow_agent' && agent.workflowId != null) {
      const bucket = byWorkflowId.get(agent.workflowId) ?? { coordinator: null, members: [] };
      bucket.members.push(agent);
      byWorkflowId.set(agent.workflowId, bucket);
      continue;
    }
    // Legacy/defensive: a member carrying workflowName + agentIndex but no
    // workflowId still groups under its parentToolCallId batch.
    if (agent.workflowName != null && agent.parentToolCallId != null && agent.agentIndex != null) {
      const id = agent.parentToolCallId;
      const bucket = byWorkflowId.get(id) ?? { coordinator: null, members: [] };
      bucket.members.push(agent);
      byWorkflowId.set(id, bucket);
    }
  }

  const workflows: RuntimeWorkflow[] = [];
  for (const [id, bucket] of byWorkflowId) {
    // A run with neither coordinator nor members is not a run.
    if (!bucket.coordinator && bucket.members.length === 0) continue;
    const members = [...bucket.members].sort((a, b) => {
      const ai = a.agentIndex ?? Number.MAX_SAFE_INTEGER;
      const bi = b.agentIndex ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.id.localeCompare(b.id);
    });
    const coordinator = bucket.coordinator;
    // Coordinator status is authoritative for the run; without one, derive
    // from members (any active ⇒ running, any failed ⇒ failed, else settled).
    const status = coordinator?.status ?? deriveMembersStatus(members);
    const phases =
      coordinator?.phases ??
      members.find((member) => member.phases != null)?.phases ??
      derivePhasesFromMembers(members);
    const name =
      coordinator?.workflowName ?? coordinator?.title ?? members[0]?.workflowName ?? `Workflow ${id}`;
    const parentToolCallId = coordinator?.parentToolCallId ?? members[0]?.parentToolCallId ?? null;
    const totalTokens =
      (coordinator?.usage?.totalTokens ?? 0) +
      members.reduce((acc, member) => acc + (member.usage?.totalTokens ?? 0), 0);
    const startedAt =
      coordinator?.startedAt ??
      members.reduce<string | null>((earliest, member) => {
        if (!member.startedAt) return earliest;
        if (!earliest) return member.startedAt;
        return member.startedAt < earliest ? member.startedAt : earliest;
      }, null);
    const allSettled =
      (coordinator == null || isTerminalAgentStatus(coordinator.status) || coordinator.status === 'idle') &&
      members.every((member) => !isActiveAgentStatus(member.status));
    const completedAt = allSettled
      ? ([coordinator?.completedAt, ...members.map((m) => m.completedAt)]
          .filter((value): value is string => value != null)
          .sort()
          .pop() ?? null)
      : null;
    const updatedAt = [coordinator?.updatedAt, ...members.map((m) => m.updatedAt)]
      .filter((value): value is string => value != null)
      .sort()
      .pop() ?? new Date().toISOString();

    workflows.push({
      id,
      name,
      status,
      phases,
      members,
      coordinator,
      parentToolCallId,
      totalTokens,
      startedAt,
      completedAt,
      updatedAt,
      runHandles: coordinator?.runHandles ?? null,
    });
  }

  // Newest run last (insertion order follows first-seen agent order).
  return workflows;
}

function deriveMembersStatus(members: RuntimeAgent[]): RuntimeTaskStatus {
  if (members.some((member) => isActiveAgentStatus(member.status))) return 'running';
  if (members.some((member) => member.status === 'failed')) return 'failed';
  if (members.some((member) => member.status === 'waiting')) return 'waiting';
  if (members.length === 0) return 'completed';
  if (members.every((member) => member.status === 'completed')) return 'completed';
  return 'completed';
}

function derivePhasesFromMembers(members: RuntimeAgent[]): ReadonlyArray<RuntimePhase> {
  const byIndex = new Map<number, string>();
  for (const member of members) {
    if (member.phaseIndex == null) continue;
    if (!byIndex.has(member.phaseIndex)) {
      byIndex.set(member.phaseIndex, member.phaseTitle ?? `Phase ${member.phaseIndex + 1}`);
    }
  }
  return [...byIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, title]) => ({ index, title }));
}

/** Phase predicates the panel's rail and collapsible sections read. */
export function phaseMemberStatus(
  members: readonly RuntimeAgent[],
  phaseIndex: number
): { live: boolean; done: boolean; failed: boolean; count: number } {
  const inPhase = members.filter((member) => (member.phaseIndex ?? -1) === phaseIndex);
  return {
    live: inPhase.some((member) => isActiveAgentStatus(member.status)),
    done: inPhase.length > 0 && inPhase.every((member) => !isActiveAgentStatus(member.status)),
    failed: inPhase.some((member) => member.status === 'failed'),
    count: inPhase.length,
  };
}

export function groupMembersByPhase(
  members: readonly RuntimeAgent[]
): Array<{ phase: RuntimePhase | null; members: RuntimeAgent[] }> {
  const byPhase = new Map<number, RuntimeAgent[]>();
  const unphased: RuntimeAgent[] = [];
  for (const member of members) {
    if (member.phaseIndex == null) {
      unphased.push(member);
      continue;
    }
    const list = byPhase.get(member.phaseIndex) ?? [];
    list.push(member);
    byPhase.set(member.phaseIndex, list);
  }
  const groups: Array<{ phase: RuntimePhase | null; members: RuntimeAgent[] }> = [];
  const sortedPhaseIndexes = [...byPhase.keys()].sort((a, b) => a - b);
  for (const phaseIndex of sortedPhaseIndexes) {
    const phaseMembers = byPhase.get(phaseIndex) ?? [];
    const title =
      phaseMembers.find((member) => member.phaseTitle != null)?.phaseTitle ?? `Phase ${phaseIndex + 1}`;
    groups.push({ phase: { index: phaseIndex, title }, members: phaseMembers });
  }
  if (unphased.length > 0) groups.push({ phase: null, members: unphased });
  return groups;
}

/**
 * The agents a single spawn batch owns, in roster order.
 *
 * Membership is pinned by the spawn tool call: agent ids are minted as
 * `${parentToolCallId}:${index}` (`subagentTasks.agentIdFor`), and every task
 * payload repeats the linkage, so a batch can be named without the transcript
 * having to keep its own list. Rows persisted before the linkage existed match
 * on the id prefix instead.
 *
 * Workflow runs additionally pin by `workflowId`: a run's members carry the
 * coordinator's id on every row, so a parallel batch that shares one spawn
 * call still resolves to one CTA anchoring at the first row.
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
      (agent.workflowId != null && owned.has(agent.workflowId)) ||
      toolCallIds.some((id) => agent.id.startsWith(`${id}:`))
  );
}

/** Workflows a spawn batch owns (by coordinator linkage or member linkage). */
export function selectBatchWorkflows(
  workflows: readonly RuntimeWorkflow[],
  toolCallIds: readonly string[]
): RuntimeWorkflow[] {
  if (toolCallIds.length === 0) return [];
  const owned = new Set(toolCallIds);
  return workflows.filter(
    (workflow) =>
      (workflow.parentToolCallId != null && owned.has(workflow.parentToolCallId)) ||
      owned.has(workflow.id) ||
      (workflow.coordinator != null && toolCallIds.some((id) => workflow.coordinator!.id.startsWith(`${id}:`)))
  );
}

/** Batch counters the Spawn CTA reads. `elapsedMs` is the longest live run. */
export function summarizeBatch(agents: readonly RuntimeAgent[], nowMs: number) {
  let active = 0;
  let idle = 0;
  let totalTokens = 0;
  let elapsedMs = 0;

  for (const agent of agents) {
    if (isActiveAgentStatus(agent.status)) active += 1;
    // Idle is neither live nor done: counted separately so the UI can name it
    // instead of folding it into `settled` and printing a completion mark
    // (t3code #9616). `settled` keeps its non-live meaning for existing readers.
    else if (agent.status === 'idle') idle += 1;
    totalTokens += agent.usage?.totalTokens ?? 0;
    const started = agent.startedAt ? Date.parse(agent.startedAt) : NaN;
    if (!Number.isNaN(started)) {
      const end = agent.completedAt ? Date.parse(agent.completedAt) : nowMs;
      const duration = Math.max(0, (Number.isNaN(end) ? nowMs : end) - started);
      if (duration > elapsedMs) elapsedMs = duration;
    }
  }

  return {
    total: agents.length,
    active,
    idle,
    settled: agents.length - active,
    totalTokens,
    elapsedMs,
  };
}

/**
 * Workflow run summary. Coordinator status is authoritative: when a
 * coordinator row exists its status names the run even while member ticks
 * lag behind it.
 */
export function summarizeWorkflow(workflow: RuntimeWorkflow, nowMs: number) {
  const memberSummary = summarizeBatch(workflow.members, nowMs);
  const coordinator = workflow.coordinator;
  const status = workflow.status;
  const active = isActiveAgentStatus(status)
    ? Math.max(1, memberSummary.active + (coordinator && isActiveAgentStatus(coordinator.status) ? 0 : 0))
    : 0;
  // Elapsed covers coordinator + longest member.
  let elapsedMs = memberSummary.elapsedMs;
  if (coordinator?.startedAt) {
    const started = Date.parse(coordinator.startedAt);
    if (!Number.isNaN(started)) {
      const end = coordinator.completedAt ? Date.parse(coordinator.completedAt) : nowMs;
      const duration = Math.max(0, (Number.isNaN(end) ? nowMs : end) - started);
      if (duration > elapsedMs) elapsedMs = duration;
    }
  }
  return {
    total: workflow.members.length,
    active,
    idle: memberSummary.idle,
    settled: workflow.members.length - memberSummary.active,
    totalTokens: workflow.totalTokens,
    elapsedMs,
    status,
    coordinatorStatus: coordinator?.status ?? null,
  };
}
