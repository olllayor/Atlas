import type { StreamEvent } from '../../../shared/contracts';
import { formatToolError } from './ToolErrorFormatter';
import { normalizeToolInputPreview, normalizeToolOutputPreview } from './ToolResultNormalizer';
import type { ToolStateStore } from './ToolStateStore';

type ToolExecutionTrackerContext = {
  conversationId: string;
  messageId: string;
  requestId: string;
};

function titleCaseToolName(name: string | undefined) {
  if (!name) {
    return 'Tool';
  }

  return name
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildDeniedMessage(toolName?: string, reason?: string) {
  if (reason?.trim()) {
    return reason.trim();
  }

  if (toolName && /search/i.test(toolName)) {
    return 'Search was not run because permission was denied.';
  }

  return `${titleCaseToolName(toolName)} was not run because permission was denied.`;
}

export class ToolExecutionTracker {
  constructor(
    private readonly context: ToolExecutionTrackerContext,
    private readonly stateStore: ToolStateStore,
  ) {}

  handleEvent(event: StreamEvent) {
    if (event.requestId !== this.context.requestId) {
      return;
    }

    const now = new Date().toISOString();
    switch (event.type) {
      case 'tool-input-start': {
        this.stateStore.save({
          id: event.toolCallId,
          conversationId: this.context.conversationId,
          messageId: this.context.messageId,
          requestId: this.context.requestId,
          toolName: event.toolName,
          state: 'queued',
          startedAt: now,
        });
        break;
      }
      case 'tool-input-available': {
        this.stateStore.save({
          id: event.toolCallId,
          conversationId: this.context.conversationId,
          messageId: this.context.messageId,
          requestId: this.context.requestId,
          toolName: event.toolName,
          state: 'running',
          inputPreview: normalizeToolInputPreview(event.input),
          inputJson: event.input,
          startedAt: now,
        });
        break;
      }
      case 'tool-output-available': {
        this.stateStore.save({
          id: event.toolCallId,
          conversationId: this.context.conversationId,
          messageId: this.context.messageId,
          requestId: this.context.requestId,
          toolName: event.toolName,
          state: event.preliminary ? 'partial' : 'completed',
          partialOutputPreview: event.preliminary ? normalizeToolOutputPreview(event.output) : undefined,
          finalOutputPreview: event.preliminary ? undefined : normalizeToolOutputPreview(event.output),
          outputJson: event.output,
          finishedAt: event.preliminary ? undefined : now,
        });
        break;
      }
      case 'tool-output-error': {
        const formatted = formatToolError(event.errorText);
        this.stateStore.save({
          id: event.toolCallId,
          conversationId: this.context.conversationId,
          messageId: this.context.messageId,
          requestId: this.context.requestId,
          toolName: event.toolName,
          state: 'error',
          errorCode: formatted.code,
          errorMessage: formatted.summary,
          finalOutputPreview: formatted.technicalDetails ?? null,
          finishedAt: now,
        });
        break;
      }
      case 'tool-output-denied': {
        this.stateStore.save({
          id: event.toolCallId,
          conversationId: this.context.conversationId,
          messageId: this.context.messageId,
          requestId: this.context.requestId,
          toolName: event.toolName ?? 'tool',
          state: 'denied',
          finalOutputPreview: buildDeniedMessage(event.toolName, event.reason),
          deniedAt: now,
          finishedAt: now,
          requiresApproval: true,
        });
        break;
      }
      case 'tool-approval-requested': {
        this.stateStore.save({
          id: event.toolCallId,
          conversationId: this.context.conversationId,
          messageId: this.context.messageId,
          requestId: this.context.requestId,
          toolName: event.toolName ?? 'tool',
          state: 'approval_requested',
          requiresApproval: true,
          approvalId: event.approvalId,
          approvalReason: event.reason ?? null,
        });
        break;
      }
      case 'tool-approval-responded': {
        this.stateStore.save({
          id: event.toolCallId,
          conversationId: this.context.conversationId,
          messageId: this.context.messageId,
          requestId: this.context.requestId,
          toolName: 'tool',
          state: event.approved ? 'approved' : 'denied',
          requiresApproval: true,
          approvalId: event.approvalId,
          approvalReason: event.reason ?? null,
          approvedAt: event.approved ? now : undefined,
          deniedAt: event.approved ? undefined : now,
          finishedAt: event.approved ? undefined : now,
          finalOutputPreview: event.approved ? undefined : buildDeniedMessage(undefined, event.reason),
        });
        break;
      }
      default:
        break;
    }
  }

  markRequestError(errorCode: string, errorMessage: string) {
    this.stateStore.markRequestError(this.context.requestId, errorCode, errorMessage);
  }
}
