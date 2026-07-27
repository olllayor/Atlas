import type { ModelMessage, ToolChoice, ToolSet } from 'ai';

import type { ToolPermissionMode } from '../../../shared/chatParameters';
import type { ChatMessagePart, ChatStartRequest, StreamEvent } from '../../../shared/contracts';
import type { MentionId } from '../../../shared/mentions';
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
import { DEFAULT_TOOL_PERMISSION_MODE } from '../../../shared/chatParameters';
import { TOOL_USE_SYSTEM_PROMPT, createBuiltInTools, describeToolPermissionsForPrompt } from '../tools/builtInTools';
import { SITE_TOOL_SYSTEM_PROMPT } from '../tools/siteTools';
import { formatToolError } from '../tools/ToolErrorFormatter';
import { MissingCredentialError, computeRetryDelayMs, normalizeError, sleep } from './ErrorNormalizer';
import type { ProviderAdapter, ProviderStreamResult } from './ProviderAdapter';
import type { ProviderRegistry } from './providerRegistry';
import { getProviderOrThrow } from './providerRegistry';
import { shouldPersistResponseMessages } from './persistResponseMessages';
import { VISUAL_PROMPT } from './VISUAL_PROMPT';
import type { ContextBuildMode } from './ContextManager';
import { ContextManager } from './ContextManager';

/** What a turn's Sites gate is evaluated against. */
export type SiteToolContext = {
  conversationId: string;
  mentions: MentionId[];
};

export type PendingToolApproval = {
  approvalId: string;
  toolCallId: string;
  toolName?: string;
  reason?: string;
};

export type ExecuteTurnRequest = {
  requestId: string;
  request: ChatStartRequest;
  signal: AbortSignal;
  emitEvent: (event: StreamEvent) => void;
  assistantMessageId?: string;
  messagesOverride?: ModelMessage[];
  initialParts?: ChatMessagePart[];
};

export type ExecuteTurnResult = {
  messageId: string;
  status: 'completed' | 'awaiting_approval';
  parts: ChatMessagePart[];
  responseMessages: ModelMessage[] | null;
  pendingApprovals: PendingToolApproval[];
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  latencyMs?: number;
};

type TurnState = {
  parts: ChatMessagePart[];
  lastTextPartId: string;
  visualParser: VisualStreamParser;
  pendingApprovals: Map<string, PendingToolApproval>;
};

/**
 * Retries only ever fire before the first token reaches the user, so raising
 * the ceiling costs nothing visible and rides out transient 429s and dropped
 * connections that a single attempt used to surface as a hard failure.
 */
const MAX_STREAM_RETRIES = 3;

function extractLatestUserText(request: ChatStartRequest) {
  const latestUserMessage = [...request.messages].reverse().find((message) => message.role === 'user');
  if (!latestUserMessage) {
    return '';
  }

  const partsText = latestUserMessage.parts
    ?.filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();

  return (partsText || latestUserMessage.content || '').trim();
}

function inferToolChoice(request: ChatStartRequest): ToolChoice<ToolSet> | undefined {
  if (!request.enableTools) {
    return undefined;
  }

  const text = extractLatestUserText(request).toLowerCase();
  if (!text) {
    return undefined;
  }

  const explicitlyRequestsShellExecution =
    /(use|run|execute)\b[\s\S]{0,60}\b(shell|bash|terminal)\b/.test(text) ||
    /\bgit status\b/.test(text);

  if (explicitlyRequestsShellExecution) {
    return {
      type: 'tool',
      toolName: 'bash',
    };
  }

  return undefined;
}

function collectPendingApprovalsFromResponseMessages(responseMessages: ModelMessage[] | undefined) {
  if (!responseMessages?.length) {
    return [];
  }

  const approvals: PendingToolApproval[] = [];
  const toolNameByCallId = new Map<string, string>();

  for (const message of responseMessages) {
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (!part || typeof part !== 'object') {
        continue;
      }

      const candidate = part as {
        type?: unknown;
        toolCallId?: unknown;
        toolName?: unknown;
        approvalId?: unknown;
        reason?: unknown;
        toolCall?: { toolCallId?: unknown; toolName?: unknown };
      };

      if (
        candidate.type === 'tool-call' &&
        typeof candidate.toolCallId === 'string' &&
        typeof candidate.toolName === 'string'
      ) {
        toolNameByCallId.set(candidate.toolCallId, candidate.toolName);
        continue;
      }

      if (candidate.type !== 'tool-approval-request' || typeof candidate.approvalId !== 'string') {
        continue;
      }

      const toolCallId =
        typeof candidate.toolCallId === 'string'
          ? candidate.toolCallId
          : typeof candidate.toolCall?.toolCallId === 'string'
            ? candidate.toolCall.toolCallId
            : null;

      if (!toolCallId) {
        continue;
      }

      const toolName =
        typeof candidate.toolName === 'string'
          ? candidate.toolName
          : typeof candidate.toolCall?.toolName === 'string'
            ? candidate.toolCall.toolName
            : toolNameByCallId.get(toolCallId);

      approvals.push({
        approvalId: candidate.approvalId,
        toolCallId,
        toolName,
        reason: typeof candidate.reason === 'string' ? candidate.reason : undefined,
      });
    }
  }

  return approvals;
}

export class ChatSessionRuntime {
  constructor(
    private readonly conversationsRepo: ConversationsRepo,
    private readonly modelsRepo: ModelsRepo,
    private readonly keychain: KeychainStore,
    private readonly providers: ProviderRegistry,
    private readonly contextManager: Pick<ContextManager, 'buildModelInput'> = new ContextManager(),
    /**
     * Supplies the Sites toolset for a turn, or null when the user has not
     * opted in. Kept as a provider so tools close over the live service and
     * the gate is evaluated per turn rather than per process.
     */
    private readonly siteToolsProvider: ((context: SiteToolContext) => Record<string, unknown> | null) | null =
      null,
  ) {}

  async executeTurn({
    requestId,
    request,
    signal,
    emitEvent,
    assistantMessageId,
    messagesOverride,
    initialParts,
  }: ExecuteTurnRequest): Promise<ExecuteTurnResult> {
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
      messagesOverride,
      initialParts,
    });

    const status: ExecuteTurnResult['status'] = result.pendingApprovals.length > 0 ? 'awaiting_approval' : 'completed';
    const persistedResponseMessages =
      status === 'completed' && shouldPersistResponseMessages(result.responseMessages ?? null, request.enableTools)
        ? result.responseMessages ?? null
        : null;

    const content = getTextContentFromParts(result.parts) || result.content;
    const reasoning = getReasoningContentFromParts(result.parts) ?? result.reasoning ?? null;

    const messageId = assistantMessageId ??
      this.conversationsRepo.addMessage({
        conversationId: request.conversationId,
        role: 'assistant',
        content,
        reasoning,
        parts: result.parts,
        responseMessages: persistedResponseMessages,
        status: status === 'completed' ? 'complete' : 'streaming',
        providerId: request.providerId,
        modelId: request.modelId,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        reasoningTokens: result.reasoningTokens ?? null,
        latencyMs: result.latencyMs ?? null,
      });

    if (assistantMessageId) {
      this.conversationsRepo.updateMessage({
        messageId: assistantMessageId,
        content,
        reasoning,
        parts: result.parts,
        responseMessages: persistedResponseMessages,
        status: status === 'completed' ? 'complete' : 'streaming',
        providerId: request.providerId,
        modelId: request.modelId,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        reasoningTokens: result.reasoningTokens ?? null,
        latencyMs: result.latencyMs ?? null,
        errorCode: null,
      });
    }

    return {
      messageId,
      status,
      parts: result.parts,
      responseMessages: result.responseMessages ?? null,
      pendingApprovals: result.pendingApprovals,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      reasoningTokens: result.reasoningTokens,
      latencyMs: result.latencyMs,
    };
  }

  protected selectModelHistory(conversationId: string) {
    return this.conversationsRepo.getModelHistory(conversationId);
  }

  private buildSystemPrompt(
    enableTools: boolean | undefined,
    contextAddendum: string | null,
    siteToolsActive: boolean,
    toolPermissionMode: ToolPermissionMode = DEFAULT_TOOL_PERMISSION_MODE,
  ) {
    // The Sites instructions only ship when the Sites tools do, so a turn that
    // did not opt in is not nudged toward building one.
    const basePrompt = siteToolsActive
      ? `${TOOL_USE_SYSTEM_PROMPT}\n\n${SITE_TOOL_SYSTEM_PROMPT}`
      : TOOL_USE_SYSTEM_PROMPT;
    // Tell the model what it may actually do, so it does not plan around a tool
    // that was withheld from its tool set.
    const toolPrompt = `${basePrompt}\n\n${describeToolPermissionsForPrompt(toolPermissionMode)}`;
    const base = enableTools ? `${toolPrompt}\n\n${VISUAL_PROMPT}` : VISUAL_PROMPT;
    if (!contextAddendum) {
      return base;
    }

    return `${base}\n\n${contextAddendum}`;
  }

  private resolveSiteTools(request: ChatStartRequest) {
    if (!request.enableTools || !this.siteToolsProvider) {
      return null;
    }

    return this.siteToolsProvider({
      conversationId: request.conversationId,
      mentions: request.mentions ?? [],
    });
  }

  private async executeWithRetry({
    requestId,
    request,
    provider,
    apiKey,
    signal,
    emitEvent,
    messagesOverride,
    initialParts,
  }: {
    requestId: string;
    request: ChatStartRequest;
    provider: ProviderAdapter;
    apiKey: string;
    signal: AbortSignal;
    emitEvent: (event: StreamEvent) => void;
    messagesOverride?: ModelMessage[];
    initialParts?: ChatMessagePart[];
  }): Promise<ProviderStreamResult & { parts: ChatMessagePart[]; pendingApprovals: PendingToolApproval[] }> {
    let attempt = 0;
    let streamedAnyResponse = false;
    let compactionMode: ContextBuildMode = 'standard';

    // Resolve once per turn: retries must not change which tools are offered.
    const siteTools = this.resolveSiteTools(request);
    const toolPermissionMode = request.toolPermissionMode ?? DEFAULT_TOOL_PERMISSION_MODE;
    const tools = request.enableTools
      ? createBuiltInTools(this.modelsRepo, siteTools, toolPermissionMode)
      : undefined;
    // Catalog-derived limits so the adapter can size the request to this model
    // rather than to a provider-wide constant.
    const modelHints = this.modelsRepo.getRuntimeHints(request.modelId);

    while (true) {
      const turnState: TurnState = {
        parts: [...(initialParts ?? [])],
        lastTextPartId: 'assistant-text',
        visualParser: new VisualStreamParser(),
        pendingApprovals: new Map<string, PendingToolApproval>(),
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
          system: this.buildSystemPrompt(
            request.enableTools,
            modelInput.systemContextAddendum,
            siteTools != null,
            toolPermissionMode,
          ),
          tools,
          toolChoice: inferToolChoice(request),
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          modelHints,
          reasoningEffort: request.reasoningEffort,
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
            const formatted = formatToolError(event.errorText);
            const formattedErrorText = formatted.technicalDetails
              ? `${formatted.summary}\n${formatted.technicalDetails}${formatted.nextStep ? `\n${formatted.nextStep}` : ''}`
              : `${formatted.summary}${formatted.nextStep ? `\n${formatted.nextStep}` : ''}`;
            this.applyEvent(
              turnState,
              { type: 'tool-output-error', requestId, ...event, errorText: formattedErrorText },
              emitEvent
            );
          },
          onToolOutputDenied: (event) => {
            streamedAnyResponse = true;
            this.applyEvent(turnState, { type: 'tool-output-denied', requestId, ...event }, emitEvent);
          },
          onToolApprovalRequested: (event) => {
            streamedAnyResponse = true;
            turnState.pendingApprovals.set(event.approvalId, {
              approvalId: event.approvalId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              reason: event.reason,
            });
            this.applyEvent(turnState, { type: 'tool-approval-requested', requestId, ...event }, emitEvent);
          },
        });

        this.applyParsedChunks(turnState, turnState.visualParser.flush(requestId), requestId, emitEvent);

        // Fallback: some providers may only surface approval requests in responseMessages.
        for (const approval of collectPendingApprovalsFromResponseMessages(result.responseMessages)) {
          if (turnState.pendingApprovals.has(approval.approvalId)) {
            continue;
          }

          turnState.pendingApprovals.set(approval.approvalId, approval);
          this.applyEvent(
            turnState,
            {
              type: 'tool-approval-requested',
              requestId,
              approvalId: approval.approvalId,
              toolCallId: approval.toolCallId,
              toolName: approval.toolName,
              reason: approval.reason,
            },
            emitEvent,
          );
        }

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
          pendingApprovals: [...turnState.pendingApprovals.values()],
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

        const canRetry =
          attempt < MAX_STREAM_RETRIES && normalized.retryable && !streamedAnyResponse && !signal.aborted;

        if (!canRetry) {
          throw error;
        }

        // Honour the provider's own Retry-After when it sent one, otherwise
        // back off exponentially instead of hammering with a fixed short delay.
        const delayMs = computeRetryDelayMs(attempt, normalized.retryAfterMs);
        attempt += 1;
        await sleep(delayMs);

        if (signal.aborted) {
          throw error;
        }
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
