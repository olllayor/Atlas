import { randomUUID } from 'node:crypto';

import type { BrowserWindow } from 'electron';

import type {
  ChatMessagePart,
  ChatStartRequest,
  ChatStartResponse,
  StreamEvent
} from '../../../shared/contracts';
import {
  applyStreamEventToParts,
  buildFallbackMessageParts,
  finalizeMessageParts,
  getReasoningContentFromParts,
  getTextContentFromParts
} from '../../../shared/messageParts';
import { shouldPersistResponseMessages } from './persistResponseMessages';
import type { ConversationsRepo } from '../../db/repositories/conversationsRepo';
import type { ModelsRepo } from '../../db/repositories/modelsRepo';
import type { KeychainStore } from '../../secrets/keychain';
import { TOOL_USE_SYSTEM_PROMPT, createBuiltInTools } from '../tools/builtInTools';
import { MissingCredentialError, normalizeError, sleep } from './ErrorNormalizer';
import type { ProviderAdapter, ProviderStreamResult } from './ProviderAdapter';
import type { ProviderRegistry } from './providerRegistry';
import { getProviderOrThrow } from './providerRegistry';

type ActiveRequest = {
  controller: AbortController;
  window: BrowserWindow;
  onWindowClosed: () => void;
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
    private readonly providers: ProviderRegistry
  ) {}

  async start(window: BrowserWindow, request: ChatStartRequest): Promise<ChatStartResponse> {
    const lastMessage = request.messages.at(-1);

    if (!lastMessage || lastMessage.role !== 'user' || !lastMessage.content.trim()) {
      throw new Error('Chat requests must end with a user message.');
    }

    const requestId = randomUUID();
    const controller = new AbortController();
    const onWindowClosed = () => {
      controller.abort();
      this.clearBufferedEvents(requestId);
      this.activeRequests.delete(requestId);
    };
    window.once('closed', onWindowClosed);
    this.activeRequests.set(requestId, { controller, window, onWindowClosed });

    this.conversationsRepo.setDefaults(request.conversationId, request.providerId, request.modelId);
    this.conversationsRepo.addMessage({
      conversationId: request.conversationId,
      role: 'user',
      content: lastMessage.content,
      status: 'complete',
      providerId: request.providerId,
      modelId: request.modelId
    });

    setImmediate(() => {
      void this.runRequest(requestId, request);
    });

    return { requestId };
  }

  abort(requestId: string) {
    const active = this.activeRequests.get(requestId);
    active?.controller.abort();
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

        let parts: ChatMessagePart[] = [];

        const result = await provider.streamChat({
          apiKey,
          modelId: request.modelId,
          messages: this.conversationsRepo.getModelHistory(request.conversationId),
          system: request.enableTools ? TOOL_USE_SYSTEM_PROMPT : undefined,
          tools: request.enableTools ? createBuiltInTools(this.modelsRepo) : undefined,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          signal,
          onChunk: (event) => {
            streamedAnyResponse = true;
            parts = applyStreamEventToParts(parts, {
              type: 'chunk',
              requestId,
              id: event.id,
              delta: event.delta
            });
            this.sendEvent(active.window, {
              type: 'chunk',
              requestId,
              id: event.id,
              delta: event.delta
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
