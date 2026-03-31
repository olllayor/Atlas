import { randomUUID } from 'node:crypto';

import type { BrowserWindow } from 'electron';

import type { ChatStartRequest, ChatStartResponse, StreamEvent } from '../../../shared/contracts';
import type { ConversationsRepo } from '../../db/repositories/conversationsRepo';
import type { KeychainStore } from '../../secrets/keychain';
import { MissingCredentialError, normalizeError, sleep } from './ErrorNormalizer';
import type { ProviderAdapter, ProviderStreamResult } from './ProviderAdapter';
import type { ProviderId } from '../../../shared/contracts';

type ActiveRequest = {
  controller: AbortController;
  window: BrowserWindow;
};

export class ChatEngine {
  private readonly activeRequests = new Map<string, ActiveRequest>();

  constructor(
    private readonly conversationsRepo: ConversationsRepo,
    private readonly keychain: KeychainStore,
    private readonly providers: Map<ProviderId, ProviderAdapter>
  ) {}

  async start(window: BrowserWindow, request: ChatStartRequest): Promise<ChatStartResponse> {
    const lastMessage = request.messages.at(-1);

    if (!lastMessage || lastMessage.role !== 'user' || !lastMessage.content.trim()) {
      throw new Error('Chat requests must end with a user message.');
    }

    const requestId = randomUUID();
    const controller = new AbortController();
    this.activeRequests.set(requestId, { controller, window });

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

      if (!apiKey) {
        throw new MissingCredentialError('No API key is saved for the selected provider.');
      }

      const result = await this.executeWithRetry(requestId, request, apiKey, active.controller.signal);
      const messageId = this.conversationsRepo.addMessage({
        conversationId: request.conversationId,
        role: 'assistant',
        content: result.content,
        status: 'complete',
        providerId: request.providerId,
        modelId: request.modelId,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        latencyMs: result.latencyMs ?? null
      });

      this.sendEvent(active.window, {
        type: 'meta',
        requestId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
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
      this.activeRequests.delete(requestId);
    }
  }

  private async executeWithRetry(
    requestId: string,
    request: ChatStartRequest,
    apiKey: string,
    signal: AbortSignal
  ): Promise<ProviderStreamResult> {
    let attempt = 0;
    let streamedAnyContent = false;

    while (true) {
      try {
        const active = this.activeRequests.get(requestId);
        if (!active) {
          throw new Error('The chat request is no longer active.');
        }

        const provider = this.providers.get(request.providerId);
        if (!provider) {
          throw new Error(`Unknown provider: ${request.providerId}`);
        }

        return await provider.streamChat({
          apiKey,
          modelId: request.modelId,
          messages: request.messages,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          signal,
          onChunk: (delta: string) => {
            streamedAnyContent = true;
            this.sendEvent(active.window, {
              type: 'chunk',
              requestId,
              delta
            });
          }
        });
      } catch (error) {
        const normalized = normalizeError(error);
        const canRetry = attempt === 0 && normalized.retryable && !streamedAnyContent && !signal.aborted;

        if (!canRetry) {
          throw error;
        }

        attempt += 1;
        await sleep(450 + Math.floor(Math.random() * 350));
      }
    }
  }

  private sendEvent(window: BrowserWindow, event: StreamEvent) {
    window.webContents.send('chat:event', event);
  }
}
