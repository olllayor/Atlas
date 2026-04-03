import { randomUUID } from 'node:crypto';

import { BrowserWindow } from 'electron/main';

import type {
  ChatMessagePart,
  ChatStartRequest,
  ChatStartResponse,
  ChatInputPart,
  OpenVisualWindowRequest,
  StreamEvent
} from '../../../shared/contracts';
import {
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_SIZE_BYTES,
  getAttachmentCapabilityError,
  getContentPreviewText,
  sumAttachmentSize,
} from '../../../shared/attachments';
import {
  applyStreamEventToParts,
  buildFallbackMessageParts,
  finalizeMessageParts,
  getReasoningContentFromParts,
  getTextContentFromParts
} from '../../../shared/messageParts';
import { buildStandaloneVisualWindowHtml, buildVisualSrcDoc } from '../../../shared/visualDocument';
import { VisualStreamParser } from '../../../shared/visualParser';
import type { AttachmentStore } from '../../attachments/AttachmentStore';
import { shouldPersistResponseMessages } from './persistResponseMessages';
import type { ConversationsRepo } from '../../db/repositories/conversationsRepo';
import type { ModelsRepo } from '../../db/repositories/modelsRepo';
import type { KeychainStore } from '../../secrets/keychain';
import { TOOL_USE_SYSTEM_PROMPT, createBuiltInTools } from '../tools/builtInTools';
import { VISUAL_PROMPT } from './VISUAL_PROMPT';
import { MissingCredentialError, normalizeError, sleep } from './ErrorNormalizer';
import type { ProviderAdapter, ProviderStreamResult } from './ProviderAdapter';
import type { ProviderRegistry } from './providerRegistry';
import { getProviderOrThrow } from './providerRegistry';

type ActiveRequest = {
  controller: AbortController;
  window: BrowserWindow;
  onWindowClosed: () => void;
  visualParser: VisualStreamParser;
};

type BufferedRequestEvents = {
  timer: ReturnType<typeof setTimeout> | null;
  events: Map<string, StreamEvent>;
};

const STREAM_BATCH_INTERVAL_MS = 33;

export class ChatEngine {
  private readonly activeRequests = new Map<string, ActiveRequest>();
  private readonly bufferedEvents = new Map<string, BufferedRequestEvents>();

  constructor(
    private readonly conversationsRepo: ConversationsRepo,
    private readonly modelsRepo: ModelsRepo,
    private readonly keychain: KeychainStore,
    private readonly providers: ProviderRegistry,
    private readonly attachmentStore: AttachmentStore
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
    const controller = new AbortController();
    const visualParser = new VisualStreamParser();
    const onWindowClosed = () => {
      controller.abort();
      this.clearBufferedEvents(requestId);
      this.activeRequests.delete(requestId);
    };
    window.once('closed', onWindowClosed);
    this.activeRequests.set(requestId, { controller, window, onWindowClosed, visualParser });

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

  async openVisualWindow(sourceWindow: BrowserWindow, request: OpenVisualWindowRequest) {
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

  private async runRequest(requestId: string, request: ChatStartRequest) {
    const active = this.activeRequests.get(requestId);
    if (!active) {
      return;
    }

    try {
      const apiKey = await this.keychain.getSecret(request.providerId);
      const provider = getProviderOrThrow(this.providers, request.providerId);

      if (!apiKey) {
        throw new MissingCredentialError('No API key is saved for the selected provider.');
      }

      const result = await this.executeWithRetry(requestId, request, provider, apiKey, active.controller.signal);
      const messageId = this.conversationsRepo.addMessage({
        conversationId: request.conversationId,
        role: 'assistant',
        content: getTextContentFromParts(result.parts) || result.content,
        reasoning: getReasoningContentFromParts(result.parts) ?? result.reasoning ?? null,
        parts: result.parts,
        responseMessages: shouldPersistResponseMessages(result.responseMessages ?? null, request.enableTools)
          ? result.responseMessages ?? null
          : null,
        status: 'complete',
        providerId: request.providerId,
        modelId: request.modelId,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        reasoningTokens: result.reasoningTokens ?? null,
        latencyMs: result.latencyMs ?? null
      });

      this.sendEvent(active.window, {
        type: 'meta',
        requestId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        reasoningTokens: result.reasoningTokens,
        latencyMs: result.latencyMs
      });

      this.sendEvent(active.window, {
        type: 'done',
        requestId,
        messageId
      });
    } catch (error) {
      const normalized = normalizeError(error);
      this.sendEvent(active.window, {
        type: 'error',
        requestId,
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable
      });
    } finally {
      active.window.removeListener('closed', active.onWindowClosed);
      this.flushBufferedEvents(requestId);
      this.bufferedEvents.delete(requestId);
      this.activeRequests.delete(requestId);
    }
  }

  private async executeWithRetry(
    requestId: string,
    request: ChatStartRequest,
    provider: ProviderAdapter,
    apiKey: string,
    signal: AbortSignal
  ): Promise<ProviderStreamResult & { parts: ChatMessagePart[] }> {
    let attempt = 0;
    let streamedAnyResponse = false;

    while (true) {
      try {
        const active = this.activeRequests.get(requestId);
        if (!active) {
          throw new Error('The chat request is no longer active.');
        }

        active.visualParser.reset();
        let parts: ChatMessagePart[] = [];
        let lastTextPartId = 'assistant-text';

        const result = await provider.streamChat({
          apiKey,
          modelId: request.modelId,
          messages: this.conversationsRepo.getModelHistory(request.conversationId),
          system: request.enableTools ? `${TOOL_USE_SYSTEM_PROMPT}\n\n${VISUAL_PROMPT}` : VISUAL_PROMPT,
          tools: request.enableTools ? createBuiltInTools(this.modelsRepo) : undefined,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          signal,
          onChunk: (event) => {
            streamedAnyResponse = true;
            lastTextPartId = event.id;
            parts = this.applyParsedChunks({
              activeWindow: active.window,
              parts,
              parsed: active.visualParser.feed(event.delta, requestId),
              requestId,
              textPartId: event.id,
              emitToRenderer: true,
            });
          },
          onReasoningChunk: (event) => {
            streamedAnyResponse = true;
            parts = applyStreamEventToParts(parts, {
              type: 'reasoning',
              requestId,
              id: event.id,
              delta: event.delta
            });
            this.sendEvent(active.window, {
              type: 'reasoning',
              requestId,
              id: event.id,
              delta: event.delta
            });
          },
          onToolInputStart: (event) => {
            streamedAnyResponse = true;
            parts = applyStreamEventToParts(parts, {
              type: 'tool-input-start',
              requestId,
              ...event
            });
            this.sendEvent(active.window, {
              type: 'tool-input-start',
              requestId,
              ...event
            });
          },
          onToolInputDelta: (event) => {
            streamedAnyResponse = true;
            parts = applyStreamEventToParts(parts, {
              type: 'tool-input-delta',
              requestId,
              ...event
            });
            this.sendEvent(active.window, {
              type: 'tool-input-delta',
              requestId,
              ...event
            });
          },
          onToolInputAvailable: (event) => {
            streamedAnyResponse = true;
            parts = applyStreamEventToParts(parts, {
              type: 'tool-input-available',
              requestId,
              ...event
            });
            this.sendEvent(active.window, {
              type: 'tool-input-available',
              requestId,
              ...event
            });
          },
          onToolOutputAvailable: (event) => {
            streamedAnyResponse = true;
            parts = applyStreamEventToParts(parts, {
              type: 'tool-output-available',
              requestId,
              ...event
            });
            this.sendEvent(active.window, {
              type: 'tool-output-available',
              requestId,
              ...event
            });
          },
          onToolOutputError: (event) => {
            streamedAnyResponse = true;
            parts = applyStreamEventToParts(parts, {
              type: 'tool-output-error',
              requestId,
              ...event
            });
            this.sendEvent(active.window, {
              type: 'tool-output-error',
              requestId,
              ...event
            });
          },
          onToolOutputDenied: (event) => {
            streamedAnyResponse = true;
            parts = applyStreamEventToParts(parts, {
              type: 'tool-output-denied',
              requestId,
              ...event
            });
            this.sendEvent(active.window, {
              type: 'tool-output-denied',
              requestId,
              ...event
            });
          }
        });
        parts = this.applyParsedChunks({
          activeWindow: active.window,
          parts,
          parsed: active.visualParser.flush(requestId),
          requestId,
          textPartId: lastTextPartId,
          emitToRenderer: true,
        });

        parts = finalizeMessageParts(parts);

        if (parts.length === 0) {
          parts = buildFallbackMessageParts({
            content: result.content,
            reasoning: result.reasoning,
            role: 'assistant'
          });
        }

        return {
          ...result,
          parts
        };
      } catch (error) {
        const normalized = normalizeError(error);
        const canRetry = attempt === 0 && normalized.retryable && !streamedAnyResponse && !signal.aborted;

        if (!canRetry) {
          throw error;
        }

        attempt += 1;
        await sleep(450 + Math.floor(Math.random() * 350));
      }
    }
  }

  private applyParsedChunks({
    activeWindow,
    parts,
    parsed,
    requestId,
    textPartId,
    emitToRenderer,
  }: {
    activeWindow: BrowserWindow;
    parts: ChatMessagePart[];
    parsed: ReturnType<VisualStreamParser['feed']>;
    requestId: string;
    textPartId: string;
    emitToRenderer: boolean;
  }) {
    let nextParts = parts;

    for (const item of parsed) {
      if (item.type === 'text') {
        const event: StreamEvent = {
          type: 'chunk',
          requestId,
          id: textPartId,
          delta: item.content,
        };
        nextParts = applyStreamEventToParts(nextParts, event);
        if (emitToRenderer) {
          this.sendEvent(activeWindow, event);
        }
        continue;
      }

      if (item.type === 'visual_start') {
        const event: StreamEvent = {
          type: 'visual-start',
          requestId,
          visualId: item.visualId!,
          title: item.title,
        };
        nextParts = applyStreamEventToParts(nextParts, event);
        if (emitToRenderer) {
          this.sendEvent(activeWindow, event);
        }
        continue;
      }

      const event: StreamEvent = {
        type: 'visual-complete',
        requestId,
        visualId: item.visualId!,
        content: item.content,
        title: item.title,
      };
      nextParts = applyStreamEventToParts(nextParts, event);
      if (emitToRenderer) {
        this.sendEvent(activeWindow, event);
      }
    }

    return nextParts;
  }

  private sendEvent(window: BrowserWindow, event: StreamEvent) {
    if (event.type === 'chunk' || event.type === 'reasoning' || event.type === 'tool-input-delta') {
      this.queueBufferedEvent(event.requestId, event);
      return;
    }

    this.flushBufferedEvents(event.requestId);
    this.sendToWindow(window, event);
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
