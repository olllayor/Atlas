import type {
  CanonicalToolType,
  ChatMessagePart,
  ChatToolPart,
  RuntimeEventEnvelope,
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

  return `activity:${event.eventId}`;
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

export function deriveWorkLogEntry(previous: WorkLogEntry | null, event: RuntimeEventEnvelope): WorkLogEntry | null {
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
                requestId: event.requestId,
                toolCallId: event.toolCallId ?? event.eventId,
                toolName: typeof payload.toolName === 'string' ? payload.toolName : undefined,
                reason: typeof payload.reason === 'string' ? payload.reason : undefined,
              }
            : {
                type: 'tool-output-available',
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
