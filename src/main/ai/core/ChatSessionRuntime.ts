import type { ChatMessagePart, ChatStartRequest, StreamEvent } from '../../../shared/contracts';
import {
  applyStreamEventToParts,
  buildFallbackMessageParts,
  finalizeMessageParts,
  getReasoningContentFromParts,
  getTextContentFromParts,
} from '../../../shared/messageParts';
import { VisualStreamParser } from '../../../shared/visualParser';
import type { ConversationsRepo } from '../../db/repositories/conversationsRepo';
import type { ModelsRepo } from '../../db/repositories/modelsRepo';
import type { KeychainStore } from '../../secrets/keychain';
import { TOOL_USE_SYSTEM_PROMPT, createBuiltInTools } from '../tools/builtInTools';
import { MissingCredentialError, normalizeError, sleep } from './ErrorNormalizer';
import type { ProviderAdapter, ProviderStreamResult } from './ProviderAdapter';
import type { ProviderRegistry } from './providerRegistry';
import { getProviderOrThrow } from './providerRegistry';
import { shouldPersistResponseMessages } from './persistResponseMessages';
import { VISUAL_PROMPT } from './VISUAL_PROMPT';
import type { ContextBuildMode } from './ContextManager';
import { ContextManager } from './ContextManager';

export type ExecuteTurnRequest = {
  requestId: string;
  request: ChatStartRequest;
  signal: AbortSignal;
  emitEvent: (event: StreamEvent) => void;
};

export type ExecuteTurnResult = {
  messageId: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  latencyMs?: number;
};

type TurnState = {
  parts: ChatMessagePart[];
  lastTextPartId: string;
  visualParser: VisualStreamParser;
};

export class ChatSessionRuntime {
  constructor(
    private readonly conversationsRepo: ConversationsRepo,
    private readonly modelsRepo: ModelsRepo,
    private readonly keychain: KeychainStore,
    private readonly providers: ProviderRegistry,
    private readonly contextManager: Pick<ContextManager, 'buildModelInput'> = new ContextManager(),
  ) {}

  async executeTurn({ requestId, request, signal, emitEvent }: ExecuteTurnRequest): Promise<ExecuteTurnResult> {
    const apiKey = await this.keychain.getSecret(request.providerId);
    const provider = getProviderOrThrow(this.providers, request.providerId);

    if (!apiKey) {
      throw new MissingCredentialError('No API key is saved for the selected provider.');
    }

    const result = await this.executeWithRetry({
      requestId,
      request,
      provider,
      apiKey,
      signal,
      emitEvent,
    });

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
      latencyMs: result.latencyMs ?? null,
    });

    return {
      messageId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      reasoningTokens: result.reasoningTokens,
      latencyMs: result.latencyMs,
    };
  }

  protected selectModelHistory(conversationId: string) {
    return this.conversationsRepo.getModelHistory(conversationId);
  }

  private buildSystemPrompt(enableTools: boolean | undefined, contextAddendum: string | null) {
    const base = enableTools ? `${TOOL_USE_SYSTEM_PROMPT}\n\n${VISUAL_PROMPT}` : VISUAL_PROMPT;
    if (!contextAddendum) {
      return base;
    }

    return `${base}\n\n${contextAddendum}`;
  }

  private buildTools(enableTools: boolean | undefined) {
    return enableTools ? createBuiltInTools(this.modelsRepo) : undefined;
  }

  private async executeWithRetry({
    requestId,
    request,
    provider,
    apiKey,
    signal,
    emitEvent,
  }: {
    requestId: string;
    request: ChatStartRequest;
    provider: ProviderAdapter;
    apiKey: string;
    signal: AbortSignal;
    emitEvent: (event: StreamEvent) => void;
  }): Promise<ProviderStreamResult & { parts: ChatMessagePart[] }> {
    let attempt = 0;
    let streamedAnyResponse = false;
    let compactionMode: ContextBuildMode = 'standard';

    while (true) {
      const turnState: TurnState = {
        parts: [],
        lastTextPartId: 'assistant-text',
        visualParser: new VisualStreamParser(),
      };
      const modelInput = this.contextManager.buildModelInput({
        conversationId: request.conversationId,
        history: this.selectModelHistory(request.conversationId),
        mode: compactionMode,
      });

      try {
        const result = await provider.streamChat({
          apiKey,
          modelId: request.modelId,
          messages: modelInput.recentMessages,
          system: this.buildSystemPrompt(request.enableTools, modelInput.systemContextAddendum),
          tools: this.buildTools(request.enableTools),
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          signal,
          onChunk: (event) => {
            streamedAnyResponse = true;
            turnState.lastTextPartId = event.id;
            this.applyParsedChunks(turnState, turnState.visualParser.feed(event.delta, requestId), requestId, emitEvent);
          },
          onReasoningChunk: (event) => {
            streamedAnyResponse = true;
            this.applyEvent(
              turnState,
              {
                type: 'reasoning',
                requestId,
                id: event.id,
                delta: event.delta,
              },
              emitEvent,
            );
          },
          onToolInputStart: (event) => {
            streamedAnyResponse = true;
            this.applyEvent(turnState, { type: 'tool-input-start', requestId, ...event }, emitEvent);
          },
          onToolInputDelta: (event) => {
            streamedAnyResponse = true;
            this.applyEvent(turnState, { type: 'tool-input-delta', requestId, ...event }, emitEvent);
          },
          onToolInputAvailable: (event) => {
            streamedAnyResponse = true;
            this.applyEvent(turnState, { type: 'tool-input-available', requestId, ...event }, emitEvent);
          },
          onToolOutputAvailable: (event) => {
            streamedAnyResponse = true;
            this.applyEvent(turnState, { type: 'tool-output-available', requestId, ...event }, emitEvent);
          },
          onToolOutputError: (event) => {
            streamedAnyResponse = true;
            this.applyEvent(turnState, { type: 'tool-output-error', requestId, ...event }, emitEvent);
          },
          onToolOutputDenied: (event) => {
            streamedAnyResponse = true;
            this.applyEvent(turnState, { type: 'tool-output-denied', requestId, ...event }, emitEvent);
          },
        });

        this.applyParsedChunks(turnState, turnState.visualParser.flush(requestId), requestId, emitEvent);

        let parts: ChatMessagePart[] = finalizeMessageParts(turnState.parts);
        if (parts.length === 0) {
          parts = buildFallbackMessageParts({
            content: result.content,
            reasoning: result.reasoning,
            role: 'assistant',
          });
        }

        return {
          ...result,
          parts,
        };
      } catch (error) {
        const normalized = normalizeError(error);
        const shouldRetryWithCompaction =
          compactionMode === 'standard' &&
          !streamedAnyResponse &&
          !signal.aborted &&
          this.isPromptTooLongError(error, normalized.message);

        if (shouldRetryWithCompaction) {
          compactionMode = 'aggressive';
          continue;
        }

        const canRetry = attempt === 0 && normalized.retryable && !streamedAnyResponse && !signal.aborted;

        if (!canRetry) {
          throw error;
        }

        attempt += 1;
        await sleep(450 + Math.floor(Math.random() * 350));
      }
    }
  }

  private isPromptTooLongError(error: unknown, normalizedMessage: string) {
    const status = this.readErrorStatus(error);
    if (status != null && status !== 400 && status !== 413 && status !== 422) {
      return false;
    }

    const message = `${normalizedMessage} ${this.readErrorMessage(error)}`.toLowerCase();
    if (!message) {
      return false;
    }

    return (
      message.includes('maximum context length') ||
      message.includes('max context length') ||
      message.includes('context length exceeded') ||
      message.includes('context window') ||
      message.includes('prompt is too long') ||
      message.includes('input is too long') ||
      message.includes('request is too large') ||
      message.includes('too many tokens') ||
      message.includes('token limit exceeded') ||
      message.includes('prompt tokens') ||
      message.includes('context overflow')
    );
  }

  private readErrorStatus(error: unknown) {
    if (error == null || typeof error !== 'object') {
      return null;
    }

    const candidate = (error as { status?: unknown; statusCode?: unknown }).statusCode
      ?? (error as { status?: unknown; statusCode?: unknown }).status;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }

    return null;
  }

  private readErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    if (error == null || typeof error !== 'object') {
      return '';
    }

    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : '';
  }

  private applyEvent(turnState: TurnState, event: StreamEvent, emitEvent: (event: StreamEvent) => void) {
    turnState.parts = applyStreamEventToParts(turnState.parts, event);
    emitEvent(event);
  }

  private applyParsedChunks(
    turnState: TurnState,
    parsed: ReturnType<VisualStreamParser['feed']>,
    requestId: string,
    emitEvent: (event: StreamEvent) => void,
  ) {
    for (const item of parsed) {
      if (item.type === 'text') {
        this.applyEvent(
          turnState,
          {
            type: 'chunk',
            requestId,
            id: turnState.lastTextPartId,
            delta: item.content,
          },
          emitEvent,
        );
        continue;
      }

      if (item.type === 'visual_start') {
        this.applyEvent(
          turnState,
          {
            type: 'visual-start',
            requestId,
            visualId: item.visualId!,
            title: item.title,
          },
          emitEvent,
        );
        continue;
      }

      this.applyEvent(
        turnState,
        {
          type: 'visual-complete',
          requestId,
          visualId: item.visualId!,
          content: item.content,
          title: item.title,
        },
        emitEvent,
      );
    }
  }
}
