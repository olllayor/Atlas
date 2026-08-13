import type {
  ActivityType,
  CanonicalToolType,
  ChatMessagePart,
  ChatToolPart,
  RuntimeEventEnvelope,
  RuntimeTaskStatus,
  RuntimeTaskUsage,
  StreamEvent,
  WorkLogEntry,
  WorkLogEntryStatus,
} from './contracts';
import { applyStreamEventToParts } from './messageParts';

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function inferCanonicalToolType({
  toolName,
  dynamic,
}: {
  toolName?: string | null;
  dynamic?: boolean;
}): CanonicalToolType {
  const normalized = (toolName ?? '').toLowerCase();

  if (dynamic) {
    return 'dynamic_tool_call';
  }

  if (normalized === 'bash' || normalized.includes('shell') || normalized.includes('command')) {
    return 'command_execution';
  }

  if (normalized.includes('write') || normalized.includes('edit') || normalized.includes('apply_patch')) {
    return 'file_change';
  }

  if (normalized.includes('mcp')) {
    return 'mcp_tool_call';
  }

  if (normalized.includes('search')) {
    return 'web_search';
  }

  if (normalized.includes('image') || normalized.includes('visual')) {
    return 'image_view';
  }

  return 'dynamic_tool_call';
}

export function buildApprovalScopeKey(toolType: CanonicalToolType | null | undefined, toolName?: string | null) {
  return `${toolType ?? 'dynamic_tool_call'}:${(toolName ?? 'tool').trim().toLowerCase()}`;
}

export function getWorkLogEntryId(event: RuntimeEventEnvelope) {
  if (event.activityType.startsWith('tool.') && event.toolCallId) {
    return `tool:${event.toolCallId}`;
  }

  if (event.activityType.startsWith('approval.') && event.approvalId) {
    return `approval:${event.approvalId}`;
  }

  /**
   * `task.*` events recur — a subagent reports `task.progress` on every tick
   * of its run, sometimes hundreds of times. Deriving the id from the subject
   * (`taskId`) rather than the event makes every tick for one task collapse
   * onto the same row instead of appending a new one, the same fix `tool:` and
   * `approval:` ids already give tool calls and approvals above. This must
   * come before the `activity:` fallback or the first recurring task event
   * Atlas ever emits floods the work log.
   */
  if (event.activityType.startsWith('task.') && typeof event.payload.taskId === 'string') {
    return `task:${event.payload.taskId}`;
  }

  return `activity:${event.eventId}`;
}

/**
 * Task type names an emitter can attach to `TaskAgentLinkage.taskType`.
 *
 * `MONITOR_TASK_TYPES` are live background processes (a shell, a dev server)
 * that happen to ride the task pipeline for progress reporting but are not
 * agents in their own right. `INERT_TASK_TYPES` are static artifacts (a plan)
 * with no liveness at all. Both classify as `background` in
 * `classifyTaskAgentKind`; they are kept as separate sets because a future
 * liveness indicator (Working vs Monitoring) needs to tell them apart and
 * should not have to re-derive that split from scratch.
 */
export const MONITOR_TASK_TYPES: ReadonlySet<string> = new Set([
  'monitor',
  'shell',
  'local_bash',
  'terminal',
  'site_dev_server',
]);

export const INERT_TASK_TYPES: ReadonlySet<string> = new Set(['plan']);

/**
 * Denylist by design, not an allowlist. Agent-flavoured type names drift as
 * new agent kinds ship; an allowlist silently drops a real subagent the first
 * time a new name appears — t3code shipped exactly that bug. Unknown type ⇒
 * agent, so a new type name fails open into visibility rather than into
 * silence.
 *
 * A task launched from inside an agent (`agentId` set) with no distinguishing
 * type name is agent-internal plumbing and classifies as `background`. A
 * nested task that *does* carry a type name is judged on that name like any
 * other task — including an unrecognized one, which still resolves to
 * `agent`, because a nested agent can outlive the parent that spawned it and
 * must stay in the roster rather than being swept into "internal work".
 */
export function classifyTaskAgentKind(input: {
  taskType?: string;
  agentId?: string;
  agentKind?: 'agent' | 'background';
}): 'agent' | 'background' {
  if (input.agentKind === 'agent' || input.agentKind === 'background') {
    return input.agentKind;
  }

  const type = input.taskType?.trim().toLowerCase();

  if (type && (MONITOR_TASK_TYPES.has(type) || INERT_TASK_TYPES.has(type))) {
    return 'background';
  }

  return 'agent';
}

/**
 * A work-log row with no `agentKind` at all predates this feature — it is a
 * plain `tool.*`/`approval.*` row, or a `task.*` row whose stamp aged out of
 * retention along with the rest of its payload. Either way it must render
 * exactly as it did before task/agent support existed, which means staying
 * out of any agent-only surface. `background` is that safe default; it is
 * deliberately not the same default as `classifyTaskAgentKind`'s "unknown ⇒
 * agent", because that rule is about *classifying a task Atlas just saw*, and
 * this one is about *a row Atlas has no classification for at all*.
 */
export function getWorkLogAgentKind(entry: Pick<WorkLogEntry, 'payload'>): 'agent' | 'background' {
  return entry.payload?.agentKind === 'agent' ? 'agent' : 'background';
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * `agentId`/`parentToolCallId` can arrive either as top-level envelope fields
 * or embedded in `payload` (`TaskAgentLinkage` carries `agentId` on every
 * task payload). Both are folded into one pair here so callers only need to
 * check one place.
 *
 * `payload.toolCallId` is read as a `parentToolCallId` source for `task.*`
 * rows only, where `TaskAgentLinkage` defines it as *the spawn tool call that
 * created this task*. On any other row that key means the opposite — the
 * call's own id — and reading it here would mark every ordinary tool row as
 * nested inside an agent. Nothing writes `toolCallId` into a non-task payload
 * today; the gate is what keeps that true by construction.
 */
export function resolveTaskLinkage(event: {
  activityType?: ActivityType;
  agentId?: string | null;
  parentToolCallId?: string | null;
  payload: Record<string, unknown>;
}): { agentId: string | null; parentToolCallId: string | null } {
  const payload = event.payload ?? {};
  const spawnToolCallId = event.activityType?.startsWith('task.') ? pickString(payload.toolCallId) : null;

  return {
    agentId: pickString(event.agentId) ?? pickString(payload.agentId),
    parentToolCallId:
      pickString(event.parentToolCallId) ?? pickString(payload.parentToolCallId) ?? spawnToolCallId,
  };
}

function mergeNumberMax(a: number | undefined, b: number | undefined): number | undefined {
  if (typeof a !== 'number') {
    return typeof b === 'number' ? b : undefined;
  }

  if (typeof b !== 'number') {
    return a;
  }

  return Math.max(a, b);
}

/**
 * Field-wise max-merge of task usage snapshots.
 *
 * A later frame's `undefined` field never overwrites an earlier known value —
 * usage only ever grows within one task, so the larger of two readings for
 * the same field is always the more accurate one. That makes the merge
 * idempotent under duplicate and out-of-order frames: replaying the same tick
 * twice, or receiving ticks out of sequence, converges on the same result
 * either way, which is what makes the work-log fold order-robust.
 */
export function mergeTaskUsage(
  current: RuntimeTaskUsage | undefined,
  incoming: RuntimeTaskUsage | undefined,
): RuntimeTaskUsage | undefined {
  if (!current) {
    return incoming;
  }

  if (!incoming) {
    return current;
  }

  return {
    totalTokens: mergeNumberMax(current.totalTokens, incoming.totalTokens) ?? 0,
    inputTokens: mergeNumberMax(current.inputTokens, incoming.inputTokens),
    cachedInputTokens: mergeNumberMax(current.cachedInputTokens, incoming.cachedInputTokens),
    outputTokens: mergeNumberMax(current.outputTokens, incoming.outputTokens),
    reasoningTokens: mergeNumberMax(current.reasoningTokens, incoming.reasoningTokens),
    toolUses: mergeNumberMax(current.toolUses, incoming.toolUses),
    durationMs: mergeNumberMax(current.durationMs, incoming.durationMs),
  };
}

/**
 * Merge one payload onto another with "never downgrade a known field"
 * semantics: an incoming key overwrites only when it is present and not
 * `null`/`undefined`. A late frame that simply omits a field (the normal
 * shape of a progress tick, which resends only what changed) leaves the
 * earlier value alone instead of blanking it.
 */
function mergePayloadForward(
  previous: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...previous };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined && value !== null) {
      merged[key] = value;
    }
  }

  return merged;
}

/**
 * Folds a `RuntimeTaskStatus` down to the work-log's smaller status
 * vocabulary. `completed` is unambiguous; `failed`/`cancelled`/`interrupted`
 * are all terminal-but-unhappy and collapse to `error` the same way a failed
 * tool call does; everything else (including a status the fold has never seen
 * before) is `running` until something terminal arrives.
 */
function mapTaskStatus(status: RuntimeTaskStatus | undefined): { status: WorkLogEntryStatus; isFinal: boolean } {
  switch (status) {
    case 'completed':
      return { status: 'completed', isFinal: true };
    case 'failed':
    case 'cancelled':
    case 'interrupted':
      return { status: 'error', isFinal: true };
    default:
      return { status: 'running', isFinal: false };
  }
}

function resolveToolStatus(payload: Record<string, unknown>): WorkLogEntryStatus {
  const status = typeof payload.status === 'string' ? payload.status : null;
  if (status === 'denied') {
    return 'denied';
  }

  if (status === 'error') {
    return 'error';
  }

  return 'completed';
}

/**
 * `task.*` fold. Kept separate from the tool/approval fold below because the
 * merge semantics are genuinely different: a tool call is a linear
 * started → updated* → completed sequence where the latest payload is simply
 * the current truth, but a task accumulates — usage only grows, a terminal
 * status is sticky, and a late `task.started` (or a `task.completed` that
 * beat its own start row through an aged-out cache) must never regress
 * anything already known.
 */
function deriveTaskWorkLogEntry(previous: WorkLogEntry | null, event: RuntimeEventEnvelope): WorkLogEntry {
  const linkage = resolveTaskLinkage(event);
  const agentId = linkage.agentId ?? previous?.agentId ?? null;
  const parentToolCallId = linkage.parentToolCallId ?? previous?.parentToolCallId ?? null;

  const previousUsage =
    previous?.payload && typeof previous.payload.usage === 'object' && previous.payload.usage !== null
      ? (previous.payload.usage as RuntimeTaskUsage)
      : undefined;
  const incomingUsage =
    typeof event.payload.usage === 'object' && event.payload.usage !== null
      ? (event.payload.usage as RuntimeTaskUsage)
      : undefined;

  const payload = mergePayloadForward(previous?.payload, event.payload);
  const usage = mergeTaskUsage(previousUsage, incomingUsage);
  if (usage) {
    payload.usage = usage;
  }

  const title =
    pickString(event.payload.title) ??
    pickString(event.payload.description) ??
    previous?.title ??
    titleCase(pickString(event.payload.taskType) ?? 'task');

  const summary = pickString(event.payload.summary) ?? pickString(event.payload.description) ?? previous?.summary ?? null;

  let status: WorkLogEntryStatus;
  let isFinal: boolean;
  if (previous?.isFinal) {
    // Once a task has reached a terminal state nothing can un-terminate it —
    // a stray progress tick or a start row that arrives late must only fill
    // metadata (handled by mergePayloadForward above), never resurrect it.
    status = previous.status;
    isFinal = true;
  } else {
    const reportedStatus = pickString(event.payload.status) as RuntimeTaskStatus | null;
    // `task.completed` with no explicit `status` field still means success —
    // "completed" is the event's own name, not just one possible payload value.
    const resolvedStatus = reportedStatus ?? (event.activityType === 'task.completed' ? 'completed' : undefined);
    ({ status, isFinal } = mapTaskStatus(resolvedStatus));
  }

  return {
    id: previous?.id ?? getWorkLogEntryId(event),
    conversationId: event.conversationId,
    turnId: event.turnId,
    requestId: event.requestId,
    messageId: event.messageId ?? previous?.messageId ?? null,
    activityType: event.activityType,
    tone: event.tone,
    toolType: event.toolType ?? previous?.toolType ?? null,
    toolCallId: event.toolCallId ?? previous?.toolCallId ?? null,
    approvalId: event.approvalId ?? previous?.approvalId ?? null,
    title,
    summary,
    status,
    sequence: event.sequence,
    isFinal,
    payload,
    agentId,
    parentToolCallId,
    createdAt: previous?.createdAt ?? event.occurredAt,
    updatedAt: event.occurredAt,
  };
}

export function deriveWorkLogEntry(previous: WorkLogEntry | null, event: RuntimeEventEnvelope): WorkLogEntry | null {
  if (event.activityType.startsWith('task.')) {
    return deriveTaskWorkLogEntry(previous, event);
  }

  const title =
    typeof event.payload.title === 'string' && event.payload.title.trim()
      ? event.payload.title.trim()
      : event.toolCallId
        ? titleCase(String(event.payload.toolName ?? event.toolCallId))
        : titleCase(event.activityType);

  const summary =
    typeof event.payload.summary === 'string'
      ? event.payload.summary
      : typeof event.payload.reason === 'string'
        ? event.payload.reason
        : typeof event.payload.delta === 'string'
          ? event.payload.delta
          : typeof event.payload.errorText === 'string'
            ? event.payload.errorText
            : null;

  switch (event.activityType) {
    case 'tool.started':
    case 'tool.updated':
    case 'tool.completed':
    case 'approval.requested':
    case 'approval.resolved':
    case 'runtime.error':
    case 'runtime.warning':
      break;
    default:
      return null;
  }

  let status: WorkLogEntryStatus = previous?.status ?? 'running';
  let isFinal = previous?.isFinal ?? false;

  if (event.activityType === 'approval.requested') {
    status = 'pending_approval';
    isFinal = false;
  } else if (event.activityType === 'approval.resolved') {
    const decision = typeof event.payload.decision === 'string' ? event.payload.decision : null;
    status = decision === 'decline' ? 'denied' : 'resolved';
    isFinal = decision === 'decline' || decision === 'cancel';
  } else if (event.activityType === 'tool.completed') {
    status = resolveToolStatus(event.payload);
    isFinal = true;
  } else if (event.activityType === 'runtime.error') {
    status = 'error';
    isFinal = true;
  } else {
    status = 'running';
    isFinal = false;
  }

  const linkage = resolveTaskLinkage(event);

  return {
    id: previous?.id ?? getWorkLogEntryId(event),
    conversationId: event.conversationId,
    turnId: event.turnId,
    requestId: event.requestId,
    messageId: event.messageId ?? null,
    activityType: event.activityType,
    tone: event.tone,
    toolType: event.toolType ?? null,
    toolCallId: event.toolCallId ?? null,
    approvalId: event.approvalId ?? null,
    title,
    summary,
    status,
    sequence: event.sequence,
    isFinal,
    payload: event.payload,
    agentId: linkage.agentId ?? previous?.agentId ?? null,
    parentToolCallId: linkage.parentToolCallId ?? previous?.parentToolCallId ?? null,
    createdAt: previous?.createdAt ?? event.occurredAt,
    updatedAt: event.occurredAt,
  };
}

function statusToChatToolState(entry: WorkLogEntry): ChatToolPart['state'] {
  switch (entry.status) {
    case 'pending_approval':
      return 'approval-requested';
    case 'resolved':
      return 'approval-responded';
    case 'completed':
      return 'output-available';
    case 'denied':
      return 'output-denied';
    case 'error':
      return 'output-error';
    default:
      return 'input-available';
  }
}

export function workLogEntryToChatToolPart(entry: WorkLogEntry): ChatToolPart {
  return {
    id: entry.id,
    type: 'tool',
    toolCallId: entry.toolCallId ?? entry.id,
    requestId: entry.requestId,
    toolName: entry.title,
    state: statusToChatToolState(entry),
    input: entry.payload?.input,
    output: entry.payload?.output ?? entry.summary ?? undefined,
    errorText: typeof entry.payload?.errorText === 'string' ? entry.payload.errorText : undefined,
    title: entry.title,
    preliminary: !entry.isFinal,
    toolType: entry.toolType,
    startedAt: entry.createdAt,
    completedAt: entry.isFinal ? entry.updatedAt : undefined,
    approval: entry.approvalId
      ? {
          id: entry.approvalId,
          approved:
            entry.status === 'resolved' || entry.status === 'completed'
              ? true
              : entry.status === 'denied'
                ? false
                : undefined,
          reason: typeof entry.payload?.reason === 'string' ? entry.payload.reason : undefined,
        }
      : undefined,
  };
}

export function applyRuntimeEventToMessageParts(parts: ChatMessagePart[], event: RuntimeEventEnvelope) {
  const payload = event.payload;
  let legacy: StreamEvent | null = null;

  /**
   * Envelope-level facts the legacy `StreamEvent` shape has no room for.
   * Spread onto every tool event below so the renderer can pick a verb,
   * an accent and a duration instead of re-deriving them from the tool
   * name string.
   */
  const toolMeta = {
    toolType: event.toolType ?? inferCanonicalToolType({
      toolName: typeof payload.toolName === 'string' ? payload.toolName : null,
      dynamic: Boolean(payload.dynamic),
    }),
    occurredAt: event.occurredAt,
  };

  switch (event.activityType) {
    case 'message.delta':
      legacy =
        payload.kind === 'visual-start'
          ? {
              type: 'visual-start',
              requestId: event.requestId,
              visualId: String(payload.visualId ?? event.eventId),
              title: typeof payload.title === 'string' ? payload.title : undefined,
            }
          : {
              type: 'chunk',
              requestId: event.requestId,
              id: String(payload.partId ?? 'assistant-text'),
              delta: String(payload.delta ?? ''),
            };
      break;
    case 'reasoning.delta':
      legacy = {
        type: 'reasoning',
        requestId: event.requestId,
        id: String(payload.partId ?? 'assistant-reasoning'),
        delta: String(payload.delta ?? ''),
      };
      break;
    case 'tool.started':
      legacy = {
        type: 'tool-input-start',
        ...toolMeta,
        requestId: event.requestId,
        toolCallId: event.toolCallId ?? event.eventId,
        toolName: String(payload.toolName ?? 'tool'),
        dynamic: Boolean(payload.dynamic),
        providerExecuted: Boolean(payload.providerExecuted),
        title: typeof payload.title === 'string' ? payload.title : undefined,
      };
      break;
    case 'tool.updated':
      legacy = {
        type: 'tool-input-available',
        ...toolMeta,
        requestId: event.requestId,
        toolCallId: event.toolCallId ?? event.eventId,
        toolName: String(payload.toolName ?? 'tool'),
        input: payload.input,
        dynamic: Boolean(payload.dynamic),
        providerExecuted: Boolean(payload.providerExecuted),
        title: typeof payload.title === 'string' ? payload.title : undefined,
      };
      break;
    case 'tool.completed':
      legacy =
        payload.status === 'error'
          ? {
              type: 'tool-output-error',
              ...toolMeta,
              requestId: event.requestId,
              toolCallId: event.toolCallId ?? event.eventId,
              toolName: String(payload.toolName ?? 'tool'),
              input: payload.input,
              errorText: String(payload.errorText ?? payload.summary ?? 'Tool execution failed'),
              dynamic: Boolean(payload.dynamic),
              providerExecuted: Boolean(payload.providerExecuted),
              title: typeof payload.title === 'string' ? payload.title : undefined,
            }
          : payload.status === 'denied'
            ? {
                type: 'tool-output-denied',
                ...toolMeta,
                requestId: event.requestId,
                toolCallId: event.toolCallId ?? event.eventId,
                toolName: typeof payload.toolName === 'string' ? payload.toolName : undefined,
                reason: typeof payload.reason === 'string' ? payload.reason : undefined,
              }
            : {
                type: 'tool-output-available',
                ...toolMeta,
                requestId: event.requestId,
                toolCallId: event.toolCallId ?? event.eventId,
                toolName: String(payload.toolName ?? 'tool'),
                input: payload.input,
                output: payload.output,
                dynamic: Boolean(payload.dynamic),
                providerExecuted: Boolean(payload.providerExecuted),
                preliminary: false,
                title: typeof payload.title === 'string' ? payload.title : undefined,
              };
      break;
    case 'message.completed':
      if (payload.kind === 'visual-complete') {
        legacy = {
          type: 'visual-complete',
          requestId: event.requestId,
          visualId: String(payload.visualId ?? event.eventId),
          content: String(payload.content ?? ''),
          title: typeof payload.title === 'string' ? payload.title : undefined,
        };
      } else {
        return parts;
      }
      break;
    case 'approval.requested':
      legacy = {
        type: 'tool-approval-requested',
        ...toolMeta,
        requestId: event.requestId,
        approvalId: event.approvalId ?? event.eventId,
        toolCallId: event.toolCallId ?? event.eventId,
        toolName: typeof payload.toolName === 'string' ? payload.toolName : undefined,
        reason: typeof payload.reason === 'string' ? payload.reason : undefined,
      };
      break;
    case 'approval.resolved':
      legacy = {
        type: 'tool-approval-responded',
        ...toolMeta,
        requestId: event.requestId,
        approvalId: event.approvalId ?? event.eventId,
        toolCallId: event.toolCallId ?? event.eventId,
        approved: payload.decision === 'accept' || payload.decision === 'accept_for_session',
        reason: typeof payload.reason === 'string' ? payload.reason : undefined,
      };
      break;
    default:
      return parts;
  }

  return applyStreamEventToParts(parts, legacy);
}
