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

  private buildSystemPrompt(enableTools: boolean | undefined) {
    return enableTools ? `${TOOL_USE_SYSTEM_PROMPT}\n\n${VISUAL_PROMPT}` : VISUAL_PROMPT;
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

    while (true) {
      const turnState: TurnState = {
        parts: [],
        lastTextPartId: 'assistant-text',
        visualParser: new VisualStreamParser(),
      };

      try {
        const result = await provider.streamChat({
          apiKey,
          modelId: request.modelId,
          messages: this.selectModelHistory(request.conversationId),
          system: this.buildSystemPrompt(request.enableTools),
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
        const canRetry = attempt === 0 && normalized.retryable && !streamedAnyResponse && !signal.aborted;

        if (!canRetry) {
          throw error;
        }

        attempt += 1;
        await sleep(450 + Math.floor(Math.random() * 350));
      }
    }
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
