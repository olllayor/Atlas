import { randomUUID } from 'node:crypto';

import type { ModelMessage } from 'ai';
import type { BrowserWindow } from 'electron';

import type {
  ChatMessagePart,
  ToolApprovalResponseRequest,
  ChatStartRequest,
  ChatStartResponse,
  ChatInputPart,
  OpenVisualWindowRequest,
  StreamEvent
} from '../../../shared/contracts';
import {
  applyStreamEventToParts,
  finalizeMessageParts,
  getReasoningContentFromParts,
  getTextContentFromParts,
} from '../../../shared/messageParts';
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
  controller: AbortController;
  window: BrowserWindow;
  onWindowClosed: () => void;
  request: ChatStartRequest;
  assistantMessageId: string;
  parts: ChatMessagePart[];
  responseMessages: ModelMessage[];
  awaitingApproval: boolean;
  tracker: ToolExecutionTracker | null;
};

type BufferedRequestEvents = {
  timer: ReturnType<typeof setTimeout> | null;
  events: Map<string, StreamEvent>;
};

const STREAM_BATCH_INTERVAL_MS = 33;

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

    this.activeRequests.set(requestId, {
      controller,
      window,
      onWindowClosed,
      request,
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

  async respondToolApproval(request: ToolApprovalResponseRequest) {
    const active = this.activeRequests.get(request.requestId);
    if (!active) {
      throw new Error('Approval target is no longer active.');
    }

    const resolved = this.approvalController.respond(request.requestId, {
      approvalId: request.approvalId,
      approved: request.approved,
      reason: request.reason,
    });

    if (!resolved) {
      throw new Error('Approval request was not found.');
    }

    this.sendEvent(active.window, {
      type: 'tool-approval-responded',
      requestId: request.requestId,
      approvalId: request.approvalId,
      toolCallId: resolved.toolCallId,
      approved: request.approved,
      reason: request.reason,
    });

    if (!request.approved) {
      this.sendEvent(active.window, {
        type: 'tool-output-denied',
        requestId: request.requestId,
        toolCallId: resolved.toolCallId,
        toolName: resolved.toolName,
        reason:
          request.reason?.trim() ||
          `${formatToolNameForDeniedCopy(resolved.toolName)} was not run because permission was denied.`,
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
          this.sendEvent(active.window, event);
        },
      });

      active.parts = result.parts;
      if (result.responseMessages?.length) {
        active.responseMessages.push(...result.responseMessages);
      }

      if (result.status === 'awaiting_approval') {
        active.awaitingApproval = true;
        this.approvalController.setPendingApprovals(requestId, result.pendingApprovals);
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
      this.conversationsRepo.updateMessage({
        messageId: active.assistantMessageId,
        status: 'error',
        errorCode: normalized.code,
        parts: finalizeMessageParts(active.parts),
      });
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

  private sendEvent(window: BrowserWindow, event: StreamEvent) {
    this.recordRequestEvent(event);

    if (event.type === 'chunk' || event.type === 'reasoning' || event.type === 'tool-input-delta') {
      this.queueBufferedEvent(event.requestId, event);
      return;
    }

    this.flushBufferedEvents(event.requestId);
    this.sendToWindow(window, event);
  }

  private recordRequestEvent(event: StreamEvent) {
    const active = this.activeRequests.get(event.requestId);
    if (!active) {
      return;
    }

    if (
      event.type === 'chunk' ||
      event.type === 'reasoning' ||
      event.type === 'tool-input-start' ||
      event.type === 'tool-input-delta' ||
      event.type === 'tool-input-available' ||
      event.type === 'tool-approval-requested' ||
      event.type === 'tool-approval-responded' ||
      event.type === 'tool-output-available' ||
      event.type === 'tool-output-error' ||
      event.type === 'tool-output-denied' ||
      event.type === 'visual-start' ||
      event.type === 'visual-complete'
    ) {
      active.parts = applyStreamEventToParts(active.parts, event);
      active.tracker?.handleEvent(event);
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
      if (!this.sendToWindow(active.window, event)) {
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
      return `${event.type}:${event.toolCallId}`;
    }

    return `${event.type}:${event.id}`;
  }

  private mergeBufferedEvents(
    existing: StreamEvent | undefined,
    next: Extract<StreamEvent, { type: 'chunk' | 'reasoning' | 'tool-input-delta' }>
  ): StreamEvent {
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
