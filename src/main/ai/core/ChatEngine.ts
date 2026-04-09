import { randomUUID } from 'node:crypto';

import type { ModelMessage } from 'ai';
import type { BrowserWindow } from 'electron';

import type {
  ApprovalDecision,
  ChatMessagePart,
  ChatStartRequest,
  ChatStartResponse,
  ChatInputPart,
  OpenVisualWindowRequest,
  RecoverEventsResponse,
  RuntimeStateSnapshot,
  StreamEvent,
  ToolApprovalResponseRequest,
} from '../../../shared/contracts';
import {
  finalizeMessageParts,
  getReasoningContentFromParts,
  getTextContentFromParts,
} from '../../../shared/messageParts';
import {
  applyRuntimeEventToMessageParts,
  buildApprovalScopeKey,
  inferCanonicalToolType,
} from '../../../shared/runtimeActivity';
import {
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_SIZE_BYTES,
  getAttachmentCapabilityError,
  getContentPreviewText,
  sumAttachmentSize,
} from '../../../shared/attachments';
import { buildStandaloneVisualWindowHtml, buildVisualSrcDoc } from '../../../shared/visualDocument';
import type { AttachmentStore } from '../../attachments/AttachmentStore';
import type { ConversationsRepo } from '../../db/repositories/conversationsRepo';
import type { ModelsRepo } from '../../db/repositories/modelsRepo';
import type { RuntimeStateRepo } from '../../db/repositories/runtimeStateRepo';
import type { KeychainStore } from '../../secrets/keychain';
import { normalizeError } from './ErrorNormalizer';
import { ToolApprovalController } from './ToolApprovalController';
import type { ProviderRegistry } from './providerRegistry';
import type { ExecuteTurnResult } from './ChatSessionRuntime';
import { ChatSessionRuntime } from './ChatSessionRuntime';
import { ToolExecutionTracker } from '../tools/ToolExecutionTracker';
import type { ToolStateStore } from '../tools/ToolStateStore';
import { shouldPersistResponseMessages } from './persistResponseMessages';

type ActiveRequest = {
  requestId: string;
  controller: AbortController;
  window: BrowserWindow;
  onWindowClosed: () => void;
  request: ChatStartRequest;
  turnId: string;
  assistantMessageId: string;
  parts: ChatMessagePart[];
  responseMessages: ModelMessage[];
  awaitingApproval: boolean;
  tracker: ToolExecutionTracker | null;
};

type BufferedRequestEvents = {
  timer: ReturnType<typeof setTimeout> | null;
  events: Map<string, Extract<StreamEvent, { type: 'chunk' | 'reasoning' | 'tool-input-delta' }>>;
};

const STREAM_BATCH_INTERVAL_MS = 33;

const NOOP_RUNTIME_STATE_REPO: Pick<
  RuntimeStateRepo,
  | 'createTurn'
  | 'startProviderSession'
  | 'recordEvent'
  | 'getLatestCheckpoint'
  | 'getLastSequence'
  | 'listActivitiesByConversation'
  | 'listPendingApprovals'
  | 'getLatestProviderSession'
  | 'listEventsAfter'
  | 'completeTurn'
  | 'updateProviderSession'
  | 'createCheckpoint'
> = {
  createTurn: () => undefined,
  startProviderSession: () => 'noop-session',
  recordEvent: (input) => ({
    ...input,
    occurredAt: new Date().toISOString(),
    sequence: 0,
  }),
  getLatestCheckpoint: () => null,
  getLastSequence: () => 0,
  listActivitiesByConversation: () => [],
  listPendingApprovals: () => [],
  getLatestProviderSession: () => null,
  listEventsAfter: (conversationId) => ({ conversationId, events: [], lastSequence: 0 }),
  completeTurn: () => undefined,
  updateProviderSession: () => undefined,
  createCheckpoint: () => randomUUID(),
};

function formatToolNameForDeniedCopy(toolName?: string) {
  if (!toolName) {
    return 'Tool';
  }

  if (/search/i.test(toolName)) {
    return 'Search';
  }

  const normalized = toolName.replace(/[_-]+/g, ' ').trim();
  if (!normalized) {
    return 'Tool';
  }

  return normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export class ChatEngine {
  private readonly activeRequests = new Map<string, ActiveRequest>();
  private readonly bufferedEvents = new Map<string, BufferedRequestEvents>();

  constructor(
    private readonly conversationsRepo: ConversationsRepo,
    private readonly modelsRepo: ModelsRepo,
    keychain: KeychainStore,
    providers: ProviderRegistry,
    private readonly attachmentStore: AttachmentStore,
    private readonly runtime: Pick<ChatSessionRuntime, 'executeTurn'> = new ChatSessionRuntime(
      conversationsRepo,
      modelsRepo,
      keychain,
      providers
    ),
    private readonly runtimeStateRepo: Pick<
      RuntimeStateRepo,
      | 'createTurn'
      | 'startProviderSession'
      | 'recordEvent'
      | 'getLatestCheckpoint'
      | 'getLastSequence'
      | 'listActivitiesByConversation'
      | 'listPendingApprovals'
      | 'getLatestProviderSession'
      | 'listEventsAfter'
      | 'completeTurn'
      | 'updateProviderSession'
      | 'createCheckpoint'
    > = NOOP_RUNTIME_STATE_REPO,
    private readonly toolStateStore?: ToolStateStore,
    private readonly approvalController = new ToolApprovalController(),
  ) {}

  async start(window: BrowserWindow, request: ChatStartRequest): Promise<ChatStartResponse> {
    const lastMessage = request.messages.at(-1);
    const inputParts =
      lastMessage?.parts?.length
        ? lastMessage.parts
        : lastMessage?.content.trim()
          ? [{ type: 'text' as const, text: lastMessage.content }]
          : [];
    const previewContent = lastMessage ? getContentPreviewText(lastMessage.content, inputParts) : '';
    const fileParts = inputParts.filter((part): part is Extract<ChatInputPart, { type: 'file' }> => part.type === 'file');

    if (!lastMessage || lastMessage.role !== 'user' || (!previewContent && inputParts.length === 0)) {
      throw new Error('Chat requests must end with a user message.');
    }

    if (fileParts.length > MAX_ATTACHMENT_COUNT) {
      throw new Error('Too many attachments were provided.');
    }

    if (sumAttachmentSize(fileParts) > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
      throw new Error('Attachments are too large to send together.');
    }

    const selectedModel = this.modelsRepo.getById(request.modelId);
    const capabilityError = getAttachmentCapabilityError(selectedModel, fileParts);
    if (capabilityError) {
      throw new Error(capabilityError);
    }

    const requestId = randomUUID();
    const assistantMessageId = randomUUID();
    const turnId = randomUUID();
    const controller = new AbortController();
    const onWindowClosed = () => {
      controller.abort();
      this.cleanupRequest(requestId);
    };
    window.once('closed', onWindowClosed);

    const persistedParts = this.persistInputParts(request.conversationId, requestId, inputParts);
    this.conversationsRepo.setDefaults(request.conversationId, request.providerId, request.modelId);
    this.conversationsRepo.addMessage({
      conversationId: request.conversationId,
      role: 'user',
      content: previewContent,
      parts: persistedParts,
      status: 'complete',
      providerId: request.providerId,
      modelId: request.modelId
    });
    this.conversationsRepo.addMessage({
      id: assistantMessageId,
      conversationId: request.conversationId,
      role: 'assistant',
      content: '',
      parts: [],
      status: 'streaming',
      providerId: request.providerId,
      modelId: request.modelId,
    });

    this.runtimeStateRepo.createTurn({
      id: turnId,
      conversationId: request.conversationId,
      requestId,
      assistantMessageId,
      providerId: request.providerId,
      modelId: request.modelId,
    });
    this.runtimeStateRepo.startProviderSession({
      conversationId: request.conversationId,
      turnId,
      requestId,
      providerId: request.providerId,
      modelId: request.modelId,
    });
    this.runtimeStateRepo.recordEvent({
      eventId: randomUUID(),
      conversationId: request.conversationId,
      turnId,
      requestId,
      activityType: 'turn.started',
      tone: 'info',
      provider: request.providerId,
      providerEventType: 'turn.started',
      messageId: assistantMessageId,
      payload: {
        providerId: request.providerId,
        modelId: request.modelId,
      },
    });

    this.activeRequests.set(requestId, {
      requestId,
      controller,
      window,
      onWindowClosed,
      request,
      turnId,
      assistantMessageId,
      parts: [],
      responseMessages: [],
      awaitingApproval: false,
      tracker: this.toolStateStore
        ? new ToolExecutionTracker(
            {
              conversationId: request.conversationId,
              messageId: assistantMessageId,
              requestId,
            },
            this.toolStateStore,
          )
        : null,
    });

    setImmediate(() => {
      void this.runRequest(requestId, request);
    });

    return { requestId };
  }

  private persistInputParts(conversationId: string, requestId: string, parts: ChatInputPart[]): ChatMessagePart[] {
    const persistedParts: ChatMessagePart[] = [];
    let textIndex = 0;
    let fileIndex = 0;

    for (const part of parts) {
      if (part.type === 'text') {
        if (!part.text.trim()) {
          continue;
        }

        persistedParts.push({
          id: `${requestId}-text-${textIndex}`,
          type: 'text',
          text: part.text,
          state: 'done',
        });
        textIndex += 1;
        continue;
      }

      const storedAttachment = this.attachmentStore.persistAttachment(conversationId, part);
      persistedParts.push({
        ...storedAttachment,
        id: `${requestId}-file-${fileIndex}`,
      });
      fileIndex += 1;
    }

    return persistedParts;
  }

  abort(requestId: string) {
    const active = this.activeRequests.get(requestId);
    active?.controller.abort();
  }

  getRuntimeState({ conversationId }: { conversationId: string }): RuntimeStateSnapshot {
    const detail = this.conversationsRepo.get(conversationId);
    const latestCheckpoint = this.runtimeStateRepo.getLatestCheckpoint(conversationId);

    return {
      conversationId,
      conversation: detail.conversation,
      lastSequence: this.runtimeStateRepo.getLastSequence(conversationId),
      checkpointSequence: latestCheckpoint?.sequence ?? 0,
      messages: detail.messages,
      activities: this.runtimeStateRepo.listActivitiesByConversation(conversationId),
      pendingApprovals: this.runtimeStateRepo.listPendingApprovals(conversationId),
      providerSession: this.runtimeStateRepo.getLatestProviderSession(conversationId),
      latestCheckpoint,
    };
  }

  recoverEvents({ conversationId, afterSequence }: { conversationId: string; afterSequence: number }): RecoverEventsResponse {
    return this.runtimeStateRepo.listEventsAfter(conversationId, afterSequence);
  }

  async respondToolApproval(request: ToolApprovalResponseRequest) {
    const active = this.activeRequests.get(request.requestId);
    if (!active) {
      throw new Error('Approval target is no longer active.');
    }

    const resolved = this.approvalController.respond(request.requestId, {
      approvalId: request.approvalId,
      decision: request.decision,
      reason: request.reason,
    });

    if (!resolved) {
      throw new Error('Approval request was not found.');
    }

    const sessionScopeKey = resolved.sessionScopeKey ?? null;
    this.recordRuntimeEnvelope(active, {
      eventId: randomUUID(),
      conversationId: active.request.conversationId,
      turnId: active.turnId,
      requestId: request.requestId,
      activityType: 'approval.resolved',
      tone: 'approval',
      provider: active.request.providerId,
      providerEventType: 'tool-approval-responded',
      messageId: active.assistantMessageId,
      toolCallId: resolved.toolCallId,
      approvalId: request.approvalId,
      toolType: resolved.toolType ? (resolved.toolType as never) : undefined,
      payload: {
        toolName: resolved.toolName,
        decision: request.decision,
        reason: request.reason,
        sessionScopeKey,
      },
    });

    if (request.decision === 'decline' || request.decision === 'cancel') {
      this.recordRuntimeEnvelope(active, {
        eventId: randomUUID(),
        conversationId: active.request.conversationId,
        turnId: active.turnId,
        requestId: request.requestId,
        activityType: 'tool.completed',
        tone: 'tool',
        provider: active.request.providerId,
        providerEventType: 'tool-output-denied',
        messageId: active.assistantMessageId,
        toolCallId: resolved.toolCallId,
        toolType: resolved.toolType ? (resolved.toolType as never) : undefined,
        payload: {
          toolName: resolved.toolName,
          status: 'denied',
          reason:
            request.reason?.trim() ||
            `${formatToolNameForDeniedCopy(resolved.toolName)} was not run because permission was denied.`,
        },
      });

      const finalizedParts = finalizeMessageParts(active.parts);
      this.conversationsRepo.updateMessage({
        messageId: active.assistantMessageId,
        content: getTextContentFromParts(finalizedParts),
        reasoning: getReasoningContentFromParts(finalizedParts),
        parts: finalizedParts,
        responseMessages: shouldPersistResponseMessages(active.responseMessages, active.request.enableTools)
          ? active.responseMessages
          : null,
        status: 'complete',
        providerId: active.request.providerId,
        modelId: active.request.modelId,
      });

      this.sendCompletionEvents(active.window, request.requestId, {
        messageId: active.assistantMessageId,
        status: 'completed',
        parts: finalizedParts,
        responseMessages: active.responseMessages,
        pendingApprovals: [],
      });
      this.cleanupRequest(request.requestId, active);
      return;
    }

    const history = this.conversationsRepo.getModelHistory(active.request.conversationId);
    const approvalMessage: ModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-approval-response',
          approvalId: request.approvalId,
          approved: true,
          ...(request.reason?.trim() ? { reason: request.reason.trim() } : {}),
        },
      ],
    } as ModelMessage;

    active.awaitingApproval = false;
    void this.runRequest(request.requestId, active.request, [...history, ...active.responseMessages, approvalMessage]);
  }

  async openVisualWindow(sourceWindow: BrowserWindow, request: OpenVisualWindowRequest) {
    const { BrowserWindow } = await import('electron');
    const srcdoc = buildVisualSrcDoc({
      visualId: request.visualId,
      content: request.content,
      theme: request.theme,
    });
    const html = buildStandaloneVisualWindowHtml({
      title: request.title,
      srcdoc,
      theme: request.theme,
    });
    const window = new BrowserWindow({
      width: 980,
      height: 720,
      minWidth: 720,
      minHeight: 520,
      autoHideMenuBar: true,
      backgroundColor: request.theme.background,
      title: request.title?.trim() || 'Inline Visual',
      parent: sourceWindow,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      }
    });

    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    window.show();
  }

  private async runRequest(requestId: string, request: ChatStartRequest, messagesOverride?: ModelMessage[]) {
    const active = this.activeRequests.get(requestId);
    if (!active) {
      return;
    }

    try {
      const result = await this.runtime.executeTurn({
        requestId,
        request,
        signal: active.controller.signal,
        assistantMessageId: active.assistantMessageId,
        messagesOverride,
        initialParts: active.parts,
        emitEvent: (event) => {
          this.handleRuntimeStreamEvent(active, event);
        },
      });

      active.parts = result.parts ?? active.parts;
      if (result.responseMessages?.length) {
        active.responseMessages.push(...result.responseMessages);
      }

      if (result.status === 'awaiting_approval') {
        active.awaitingApproval = true;
        const pendingApprovals = result.pendingApprovals.map((approval) => {
          const toolType = inferCanonicalToolType({ toolName: approval.toolName });
          return {
            ...approval,
            conversationId: request.conversationId,
            toolType,
            sessionScopeKey: buildApprovalScopeKey(toolType, approval.toolName),
          };
        });
        this.approvalController.setPendingApprovals(requestId, pendingApprovals);
        this.runtimeStateRepo.completeTurn(active.turnId, this.runtimeStateRepo.getLastSequence(request.conversationId), 'awaiting_approval');
        const autoApproved = pendingApprovals.find(
          (approval) =>
            approval.sessionScopeKey &&
            this.approvalController.hasConversationScopeGrant(request.conversationId, approval.sessionScopeKey),
        );
        if (autoApproved) {
          void this.respondToolApproval({
            requestId,
            approvalId: autoApproved.approvalId,
            decision: 'accept',
          });
        }
        return;
      }

      if (shouldPersistResponseMessages(active.responseMessages, request.enableTools)) {
        this.conversationsRepo.updateMessage({
          messageId: active.assistantMessageId,
          responseMessages: active.responseMessages,
        });
      }

      this.sendCompletionEvents(active.window, requestId, result);
      this.cleanupRequest(requestId, active);
    } catch (error) {
      const normalized = normalizeError(error);
      active.tracker?.markRequestError(normalized.code, normalized.message);
      this.flushBufferedEvents(requestId);
      this.recordRuntimeEnvelope(active, {
        eventId: randomUUID(),
        conversationId: active.request.conversationId,
        turnId: active.turnId,
        requestId,
        activityType: 'runtime.error',
        tone: 'error',
        provider: active.request.providerId,
        providerEventType: 'error',
        messageId: active.assistantMessageId,
        payload: {
          code: normalized.code,
          message: normalized.message,
          retryable: normalized.retryable,
        },
      });
      this.conversationsRepo.updateMessage({
        messageId: active.assistantMessageId,
        status: 'error',
        errorCode: normalized.code,
        parts: finalizeMessageParts(active.parts),
      });
      this.runtimeStateRepo.completeTurn(active.turnId, this.runtimeStateRepo.getLastSequence(active.request.conversationId), 'aborted');
      this.runtimeStateRepo.updateProviderSession(requestId, { status: 'aborted' });
      this.sendEvent(active.window, {
        type: 'error',
        requestId,
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable
      });
      this.cleanupRequest(requestId, active);
    }
  }

  private sendCompletionEvents(window: BrowserWindow, requestId: string, result: ExecuteTurnResult) {
    const active = this.activeRequests.get(requestId);
    const finalParts = result.parts ?? active?.parts ?? [];
    if (active) {
      this.flushBufferedEvents(requestId);
      this.recordRuntimeEnvelope(active, {
        eventId: randomUUID(),
        conversationId: active.request.conversationId,
        turnId: active.turnId,
        requestId,
        activityType: 'message.completed',
        tone: 'info',
        provider: active.request.providerId,
        providerEventType: 'message.completed',
        messageId: active.assistantMessageId,
        payload: {
          content: getTextContentFromParts(finalParts),
          reasoning: getReasoningContentFromParts(finalParts),
        },
      });
      this.recordRuntimeEnvelope(active, {
        eventId: randomUUID(),
        conversationId: active.request.conversationId,
        turnId: active.turnId,
        requestId,
        activityType: 'turn.completed',
        tone: 'info',
        provider: active.request.providerId,
        providerEventType: 'turn.completed',
        messageId: active.assistantMessageId,
        payload: {
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          reasoningTokens: result.reasoningTokens ?? null,
          latencyMs: result.latencyMs ?? null,
        },
      });

      const lastSequence = this.runtimeStateRepo.getLastSequence(active.request.conversationId);
      this.runtimeStateRepo.completeTurn(active.turnId, lastSequence, 'completed');
      this.runtimeStateRepo.updateProviderSession(requestId, { status: 'completed', lastSequence });
      this.runtimeStateRepo.createCheckpoint({
        conversationId: active.request.conversationId,
        turnId: active.turnId,
        sequence: lastSequence,
        pendingApprovals: this.runtimeStateRepo.listPendingApprovals(active.request.conversationId),
      });
    }

    this.sendEvent(window, {
      type: 'meta',
      requestId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      reasoningTokens: result.reasoningTokens,
      latencyMs: result.latencyMs
    });

    this.sendEvent(window, {
      type: 'done',
      requestId,
      messageId: result.messageId
    });
  }

  private cleanupRequest(requestId: string, active?: ActiveRequest) {
    const target = active ?? this.activeRequests.get(requestId);
    if (!target) {
      return;
    }

    target.window.removeListener('closed', target.onWindowClosed);
    this.flushBufferedEvents(requestId);
    this.bufferedEvents.delete(requestId);
    this.activeRequests.delete(requestId);
    this.approvalController.clearRequest(requestId);
  }

  private handleRuntimeStreamEvent(active: ActiveRequest, event: StreamEvent) {
    active.tracker?.handleEvent(event);

    if (event.type === 'meta' || event.type === 'done' || event.type === 'error' || event.type === 'runtime-sync') {
      return;
    }

    if (event.type === 'chunk' || event.type === 'reasoning' || event.type === 'tool-input-delta') {
      this.queueBufferedEvent(event.requestId, event);
      return;
    }

    this.flushBufferedEvents(event.requestId);
    this.recordStreamEvent(active, event);
  }

  private recordStreamEvent(active: ActiveRequest, event: Exclude<StreamEvent, { type: 'runtime-sync' | 'done' | 'meta' | 'error' }>) {
    for (const envelope of this.normalizeStreamEvent(active, event)) {
      this.recordRuntimeEnvelope(active, envelope);
    }
  }

  private queueBufferedEvent(
    requestId: string,
    event: Extract<StreamEvent, { type: 'chunk' | 'reasoning' | 'tool-input-delta' }>
  ) {
    let buffered = this.bufferedEvents.get(requestId);
    if (!buffered) {
      buffered = {
        timer: null,
        events: new Map()
      };
      this.bufferedEvents.set(requestId, buffered);
    }

    const key = this.getBufferedEventKey(event);
    const existing = buffered.events.get(key);
    buffered.events.set(key, this.mergeBufferedEvents(existing, event));

    if (buffered.timer) {
      return;
    }

    buffered.timer = setTimeout(() => {
      this.flushBufferedEvents(requestId);
    }, STREAM_BATCH_INTERVAL_MS);
  }

  private flushBufferedEvents(requestId: string) {
    const buffered = this.bufferedEvents.get(requestId);
    if (!buffered || buffered.events.size === 0) {
      if (buffered?.timer) {
        clearTimeout(buffered.timer);
        buffered.timer = null;
      }
      return;
    }

    if (buffered.timer) {
      clearTimeout(buffered.timer);
      buffered.timer = null;
    }

    const active = this.activeRequests.get(requestId);
    if (!active) {
      this.clearBufferedEvents(requestId);
      return;
    }

    if (active.window.isDestroyed() || active.window.webContents.isDestroyed()) {
      active.controller.abort();
      active.window.removeListener('closed', active.onWindowClosed);
      this.clearBufferedEvents(requestId);
      this.activeRequests.delete(requestId);
      return;
    }

    for (const event of buffered.events.values()) {
      try {
        this.recordStreamEvent(active, event);
      } catch {
        active.controller.abort();
        active.window.removeListener('closed', active.onWindowClosed);
        this.clearBufferedEvents(requestId);
        this.activeRequests.delete(requestId);
        return;
      }
    }

    buffered.events.clear();
  }

  private clearBufferedEvents(requestId: string) {
    const buffered = this.bufferedEvents.get(requestId);
    if (!buffered) {
      return;
    }

    if (buffered.timer) {
      clearTimeout(buffered.timer);
      buffered.timer = null;
    }

    buffered.events.clear();
  }

  private sendEvent(window: BrowserWindow, event: StreamEvent) {
    this.sendToWindow(window, event);
  }

  private normalizeStreamEvent(
    active: ActiveRequest,
    event: Exclude<StreamEvent, { type: 'runtime-sync' | 'done' | 'meta' | 'error' }>
  ) {
    const base = {
      conversationId: active.request.conversationId,
      turnId: active.turnId,
      requestId: active.requestId ?? event.requestId,
      provider: active.request.providerId,
      messageId: active.assistantMessageId,
    };

    switch (event.type) {
      case 'chunk':
        return [{
          eventId: randomUUID(),
          ...base,
          activityType: 'message.delta' as const,
          tone: 'info' as const,
          providerEventType: event.type,
          payload: { delta: event.delta, partId: event.id },
        }];
      case 'reasoning':
        return [{
          eventId: randomUUID(),
          ...base,
          activityType: 'reasoning.delta' as const,
          tone: 'info' as const,
          providerEventType: event.type,
          payload: { delta: event.delta, partId: event.id },
        }];
      case 'tool-input-start':
        return [{
          eventId: randomUUID(),
          ...base,
          activityType: 'tool.started' as const,
          tone: 'tool' as const,
          toolCallId: event.toolCallId,
          toolType: inferCanonicalToolType({ toolName: event.toolName, dynamic: event.dynamic }),
          providerEventType: event.type,
          payload: {
            toolName: event.toolName,
            dynamic: event.dynamic,
            providerExecuted: event.providerExecuted,
            title: event.title,
          },
        }];
      case 'tool-input-delta':
        return [{
          eventId: randomUUID(),
          ...base,
          activityType: 'tool.updated' as const,
          tone: 'tool' as const,
          toolCallId: event.toolCallId,
          providerEventType: event.type,
          payload: {
            delta: event.delta,
            summary: event.delta,
          },
        }];
      case 'tool-input-available':
        return [{
          eventId: randomUUID(),
          ...base,
          activityType: 'tool.updated' as const,
          tone: 'tool' as const,
          toolCallId: event.toolCallId,
          toolType: inferCanonicalToolType({ toolName: event.toolName, dynamic: event.dynamic }),
          providerEventType: event.type,
          payload: {
            toolName: event.toolName,
            input: event.input,
            dynamic: event.dynamic,
            providerExecuted: event.providerExecuted,
            title: event.title,
          },
        }];
      case 'tool-output-available':
        return [{
          eventId: randomUUID(),
          ...base,
          activityType: event.preliminary ? 'tool.updated' : 'tool.completed',
          tone: 'tool' as const,
          toolCallId: event.toolCallId,
          toolType: inferCanonicalToolType({ toolName: event.toolName, dynamic: event.dynamic }),
          providerEventType: event.type,
          payload: {
            toolName: event.toolName,
            input: event.input,
            output: event.output,
            dynamic: event.dynamic,
            providerExecuted: event.providerExecuted,
            title: event.title,
            status: event.preliminary ? 'running' : 'completed',
            summary: typeof event.output === 'string' ? event.output : undefined,
          },
        }];
      case 'tool-output-error':
        return [{
          eventId: randomUUID(),
          ...base,
          activityType: 'tool.completed' as const,
          tone: 'tool' as const,
          toolCallId: event.toolCallId,
          toolType: inferCanonicalToolType({ toolName: event.toolName, dynamic: event.dynamic }),
          providerEventType: event.type,
          payload: {
            toolName: event.toolName,
            input: event.input,
            errorText: event.errorText,
            dynamic: event.dynamic,
            providerExecuted: event.providerExecuted,
            title: event.title,
            status: 'error',
            summary: event.errorText,
          },
        }];
      case 'tool-output-denied':
        return [{
          eventId: randomUUID(),
          ...base,
          activityType: 'tool.completed' as const,
          tone: 'tool' as const,
          toolCallId: event.toolCallId,
          toolType: inferCanonicalToolType({ toolName: event.toolName }),
          providerEventType: event.type,
          payload: {
            toolName: event.toolName,
            reason: event.reason,
            status: 'denied',
            summary: event.reason,
          },
        }];
      case 'tool-approval-requested': {
        const toolType = inferCanonicalToolType({ toolName: event.toolName });
        return [{
          eventId: randomUUID(),
          ...base,
          activityType: 'approval.requested' as const,
          tone: 'approval' as const,
          toolCallId: event.toolCallId,
          approvalId: event.approvalId,
          toolType,
          providerEventType: event.type,
          payload: {
            toolName: event.toolName,
            reason: event.reason,
            sessionScopeKey: buildApprovalScopeKey(toolType, event.toolName),
          },
        }];
      }
      case 'tool-approval-responded':
        return [{
          eventId: randomUUID(),
          ...base,
          activityType: 'approval.resolved' as const,
          tone: 'approval' as const,
          toolCallId: event.toolCallId,
          approvalId: event.approvalId,
          providerEventType: event.type,
          payload: {
            decision: event.approved ? 'accept' : 'decline',
            reason: event.reason,
          },
        }];
      case 'visual-start':
        return [{
          eventId: randomUUID(),
          ...base,
          activityType: 'message.delta' as const,
          tone: 'info' as const,
          providerEventType: event.type,
          payload: {
            kind: 'visual-start',
            visualId: event.visualId,
            title: event.title,
          },
        }];
      case 'visual-complete':
        return [{
          eventId: randomUUID(),
          ...base,
          activityType: 'message.completed' as const,
          tone: 'info' as const,
          providerEventType: event.type,
          payload: {
            kind: 'visual-complete',
            visualId: event.visualId,
            content: event.content,
            title: event.title,
          },
        }];
    }
  }

  private recordRuntimeEnvelope(
    active: ActiveRequest,
    input: {
      eventId: string;
      conversationId: string;
      turnId: string;
      requestId: string;
      activityType: any;
      tone: any;
      provider: any;
      providerEventType?: string;
      payload: Record<string, unknown>;
      messageId?: string;
      toolCallId?: string;
      approvalId?: string;
      toolType?: any;
    },
  ) {
    const envelope = this.runtimeStateRepo.recordEvent({
      ...input,
      messageId: input.messageId ?? active.assistantMessageId,
    });

    active.parts = applyRuntimeEventToMessageParts(active.parts, envelope);
    this.conversationsRepo.updateMessage({
      messageId: active.assistantMessageId,
      content: getTextContentFromParts(active.parts),
      reasoning: getReasoningContentFromParts(active.parts),
      parts: active.parts,
      providerId: active.request.providerId,
      modelId: active.request.modelId,
    });

    this.sendToWindow(active.window, {
      type: 'runtime-sync',
      conversationId: active.request.conversationId,
      requestId: active.requestId ?? active.assistantMessageId,
      eventId: envelope.eventId,
      sequence: envelope.sequence,
    });
  }

  private sendToWindow(window: BrowserWindow, event: StreamEvent) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      return false;
    }

    try {
      window.webContents.send('chat:event', event);
      return true;
    } catch {
      return false;
    }
  }

  private getBufferedEventKey(event: Extract<StreamEvent, { type: 'chunk' | 'reasoning' | 'tool-input-delta' }>) {
    if (event.type === 'tool-input-delta') {
      return `message:${event.requestId}:tool:${event.toolCallId}`;
    }

    return `message:${event.requestId}:${event.type}:${event.id}`;
  }

  private mergeBufferedEvents(
    existing: Extract<StreamEvent, { type: 'chunk' | 'reasoning' | 'tool-input-delta' }> | undefined,
    next: Extract<StreamEvent, { type: 'chunk' | 'reasoning' | 'tool-input-delta' }>
  ): Extract<StreamEvent, { type: 'chunk' | 'reasoning' | 'tool-input-delta' }> {
    if (!existing) {
      return next;
    }

    if (existing.type === 'chunk' && next.type === 'chunk') {
      return {
        ...existing,
        delta: `${existing.delta}${next.delta}`
      };
    }

    if (existing.type === 'reasoning' && next.type === 'reasoning') {
      return {
        ...existing,
        delta: `${existing.delta}${next.delta}`
      };
    }

    if (existing.type === 'tool-input-delta' && next.type === 'tool-input-delta') {
      return {
        ...existing,
        delta: `${existing.delta}${next.delta}`
      };
    }

    return next;
  }
}
