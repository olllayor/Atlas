import type { ModelMessage, ToolChoice, ToolSet } from 'ai';

import type { ToolPermissionMode } from '../../../shared/chatParameters';
import type {
  ChatMessagePart,
  ChatStartRequest,
  ContextUsageSnapshot,
  GetContextUsageRequest,
  StreamEvent,
} from '../../../shared/contracts';
import type { MentionId } from '../../../shared/mentions';
import {
  applyStreamEventToParts,
  buildFallbackMessageParts,
  finalizeMessageParts,
  getReasoningContentFromParts,
  getTextContentFromParts,
} from '../../../shared/messageParts';
import { estimateImageTokens, estimateTextTokens } from '../../../shared/tokenEstimate';
import { VisualStreamParser } from '../../../shared/visualParser';
import type { ConversationsRepo } from '../../db/repositories/conversationsRepo';
import type { ModelsRepo } from '../../db/repositories/modelsRepo';
import type { KeychainStore } from '../../secrets/keychain';
import { DEFAULT_TOOL_PERMISSION_MODE } from '../../../shared/chatParameters';
import {
  TOOL_USE_SYSTEM_PROMPT,
  createBuiltInTools,
  describeToolPermissionsForPrompt,
  describeWorkspaceModeForPrompt
} from '../tools/builtInTools';
import type { ToolWorkspace } from '../tools/toolWorkspace';
import { DEFAULT_TOOL_WORKSPACE } from '../tools/toolWorkspace';
import { SITE_TOOL_SYSTEM_PROMPT } from '../tools/siteTools';
import { formatToolError } from '../tools/ToolErrorFormatter';
import { logger, startTimer } from '../../observability/logger';
import { MissingCredentialError, computeRetryDelayMs, normalizeError, sleep } from './ErrorNormalizer';
import type { ProviderAdapter, ProviderStreamResult } from './ProviderAdapter';
import type { ProviderRegistry } from './providerRegistry';
import { getProviderOrThrow } from './providerRegistry';
import { DEFAULT_STREAM_CORE_CONFIG, resolveMaxOutputTokens } from '../providers/streamCore';
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

/**
 * Per-tool allowance for the JSON schema the SDK derives from each tool's zod
 * definition. The schema is not materialised until request time, so its exact
 * size is unavailable here; a flat allowance keeps the fixed floor honest
 * instead of reporting tools as free, which is what counting nothing did.
 */
const TOOL_SCHEMA_ALLOWANCE_TOKENS = 80;

function estimateToolDefinitionTokens(tools: Record<string, unknown>): number {
  let total = 0;

  for (const [name, definition] of Object.entries(tools)) {
    total += estimateTextTokens(name) + TOOL_SCHEMA_ALLOWANCE_TOKENS;
    const description = (definition as { description?: unknown } | null)?.description;
    if (typeof description === 'string') {
      total += estimateTextTokens(description);
    }
  }

  return total;
}

function estimatePendingTokens(request: GetContextUsageRequest): number {
  let total = request.pendingText ? estimateTextTokens(request.pendingText) : 0;

  for (const attachment of request.pendingAttachments ?? []) {
    if (attachment.mediaType?.startsWith('image/')) {
      total += estimateImageTokens({
        width: attachment.previewWidth,
        height: attachment.previewHeight,
      });
      continue;
    }
    // Non-image attachments are referenced rather than inlined.
    total += 16;
  }

  return total;
}

/**
 * What the transcript says while a turn is being retried.
 *
 * Names the reason, because "retrying" alone leaves the reader guessing whether
 * to wait or to give up — and the two common reasons call for opposite
 * decisions. The attempt count is included so a second silence is legible as
 * progress through a bounded sequence rather than an open-ended one.
 */
export function buildRetryNotice(code: string, attempt: number, budget: number): string {
  const progress = `Attempt ${attempt + 1} of ${budget + 1}.`;

  switch (code) {
    case 'timeout':
      return `The provider did not respond in time. Retrying — ${progress}`;
    case 'rate_limited':
      return `The provider is rate limiting this key. Waiting, then retrying — ${progress}`;
    case 'network_error':
      return `The connection to the provider dropped. Retrying — ${progress}`;
    case 'upstream_unavailable':
      return `The provider is temporarily unavailable. Retrying — ${progress}`;
    case 'stream_stalled':
      return `The model stopped mid-answer. Retrying — ${progress}`;
    default:
      return `The request failed and is being retried — ${progress}`;
  }
}

function positiveOrNull(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

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
    /**
     * Resolves the conversation's workspace mode and project root.
     *
     * A resolver rather than a request field on purpose: the writable root is a
     * security boundary, so it is read from the conversation row in the main
     * process and never accepted from the renderer.
     */
    private readonly workspaceResolver: (conversationId: string) => ToolWorkspace = () => DEFAULT_TOOL_WORKSPACE,
  ) {}

  private resolveWorkspace(conversationId: string): ToolWorkspace {
    try {
      return this.workspaceResolver(conversationId);
    } catch {
      // A missing or unreadable project must not take the turn down with it:
      // fall back to the mode that grants the least.
      return DEFAULT_TOOL_WORKSPACE;
    }
  }

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

  /**
   * Measures the prompt that would be sent right now, without sending it.
   *
   * Deliberately built from the same three pieces `executeWithRetry` uses —
   * `selectModelHistory`, `buildSystemPrompt`, `createBuiltInTools` — so the
   * displayed number cannot drift from the request. Anything that changes what
   * is actually sent changes this too.
   */
  measureContextUsage(request: GetContextUsageRequest): ContextUsageSnapshot {
    const modelHints = this.modelsRepo.getRuntimeHints(request.modelId);
    const maxTokens = positiveOrNull(modelHints.contextWindow);

    const toolPermissionMode =
      request.toolPermissionMode ??
      this.conversationsRepo.getToolPermissionMode(request.conversationId) ??
      DEFAULT_TOOL_PERMISSION_MODE;
    const workspace = this.resolveWorkspace(request.conversationId);
    const siteTools = this.resolveSiteTools(request);
    const tools = request.enableTools
      ? createBuiltInTools(this.modelsRepo, siteTools, toolPermissionMode, workspace)
      : undefined;
    const toolTokens = tools ? estimateToolDefinitionTokens(tools) : 0;

    // The system prompt is measured without the summary addendum first: the
    // addendum's size depends on how much history gets compressed, which is
    // what the budget below decides.
    const baseSystemPrompt = this.buildSystemPrompt(
      request.enableTools,
      null,
      siteTools != null,
      toolPermissionMode,
      workspace
    );
    const systemTokens = estimateTextTokens(baseSystemPrompt);
    const pendingTokens = estimatePendingTokens(request);

    // Same helper the send path uses, so the ring is sized against the same
    // window the request will be. Unsent composer text joins the floor here but
    // not there: by send time it is already part of the history being measured.
    const { reservedOutputTokens, budget } = this.resolveContextBudget({
      modelHints,
      requestedMaxOutputTokens: undefined,
      fixedFloorTokens: systemTokens + toolTokens + pendingTokens,
    });

    const history = this.selectModelHistory(request.conversationId);
    const modelInput = this.contextManager.buildModelInput({
      conversationId: request.conversationId,
      history,
      mode: 'standard',
      budget,
    });

    const lastTurn = this.conversationsRepo.getLatestUsage?.(request.conversationId) ?? null;
    const summaryTokens = modelInput.usage.addendumTokens;
    const historyTokens = modelInput.usage.historyTokens;
    const promptTokens = systemTokens + toolTokens + summaryTokens + historyTokens + pendingTokens;

    return {
      maxTokens,
      promptTokens,
      // The prompt minus the fixed floor: what the conversation itself occupies.
      conversationTokens: summaryTokens + historyTokens + pendingTokens,
      systemTokens,
      toolTokens,
      historyTokens,
      summaryTokens,
      pendingTokens,
      reservedOutputTokens,
      droppedTurnCount: modelInput.usage.droppedTurnCount,
      keptTurnCount: modelInput.usage.keptTurnCount,
      overflow: maxTokens != null && promptTokens > maxTokens - reservedOutputTokens,
      lastTurn,
    };
  }

  /**
   * The completion reservation, and the window left for history once it and the
   * fixed system/tool floor are taken out.
   *
   * Shared by the send path and by `measureContextUsage` on purpose: two copies
   * of this arithmetic is how a displayed number starts disagreeing with the
   * request it claims to describe. `budget` is `undefined` when the catalog does
   * not know the model's window, which leaves compaction on turn counts.
   */
  private resolveContextBudget({
    modelHints,
    requestedMaxOutputTokens,
    fixedFloorTokens,
  }: {
    modelHints: ReturnType<ModelsRepo['getRuntimeHints']>;
    requestedMaxOutputTokens: number | undefined;
    fixedFloorTokens: number;
  }) {
    const reservedOutputTokens = resolveMaxOutputTokens(
      requestedMaxOutputTokens,
      modelHints,
      DEFAULT_STREAM_CORE_CONFIG
    );
    const contextWindow = positiveOrNull(modelHints.contextWindow);

    return {
      reservedOutputTokens,
      budget:
        contextWindow == null
          ? undefined
          : {
              totalTokens: Math.max(1, contextWindow - reservedOutputTokens),
              reservedTokens: fixedFloorTokens,
            },
    };
  }

  private buildSystemPrompt(
    enableTools: boolean | undefined,
    contextAddendum: string | null,
    siteToolsActive: boolean,
    toolPermissionMode: ToolPermissionMode = DEFAULT_TOOL_PERMISSION_MODE,
    workspace: ToolWorkspace = DEFAULT_TOOL_WORKSPACE,
  ) {
    // The Sites instructions only ship when the Sites tools do, so a turn that
    // did not opt in is not nudged toward building one.
    const basePrompt = siteToolsActive
      ? `${TOOL_USE_SYSTEM_PROMPT}\n\n${SITE_TOOL_SYSTEM_PROMPT}`
      : TOOL_USE_SYSTEM_PROMPT;
    // Tell the model what it may actually do, so it does not plan around a tool
    // that was withheld from its tool set.
    const toolPrompt = [
      basePrompt,
      describeWorkspaceModeForPrompt(workspace.mode, workspace),
      describeToolPermissionsForPrompt(toolPermissionMode)
    ].join('\n\n');
    const base = enableTools ? `${toolPrompt}\n\n${VISUAL_PROMPT}` : VISUAL_PROMPT;
    if (!contextAddendum) {
      return base;
    }

    return `${base}\n\n${contextAddendum}`;
  }

  private resolveSiteTools(request: {
    conversationId: string;
    enableTools?: boolean;
    mentions?: MentionId[];
  }) {
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
    const toolPermissionMode =
      request.toolPermissionMode ??
      this.conversationsRepo.getToolPermissionMode(request.conversationId) ??
      DEFAULT_TOOL_PERMISSION_MODE;
    // Resolved once per turn, like the tool set: a mode switch mid-stream must
    // not change what this turn was allowed to do.
    const workspace = this.resolveWorkspace(request.conversationId);
    const tools = request.enableTools
      ? createBuiltInTools(this.modelsRepo, siteTools, toolPermissionMode, workspace)
      : undefined;
    // Catalog-derived limits so the adapter can size the request to this model
    // rather than to a provider-wide constant.
    const modelHints = this.modelsRepo.getRuntimeHints(request.modelId);

    while (true) {
      const attemptElapsed = startTimer();
      const turnState: TurnState = {
        parts: [...(initialParts ?? [])],
        lastTextPartId: 'assistant-text',
        visualParser: new VisualStreamParser(),
        pendingApprovals: new Map<string, PendingToolApproval>(),
      };
      // Same budget the ring displays, so what is shown is what is sent.
      const modelInput = this.contextManager.buildModelInput({
        conversationId: request.conversationId,
        history: this.selectModelHistory(request.conversationId),
        mode: compactionMode,
        budget: this.resolveContextBudget({
          modelHints,
          requestedMaxOutputTokens: request.maxOutputTokens,
          fixedFloorTokens:
            estimateTextTokens(
              this.buildSystemPrompt(request.enableTools, null, siteTools != null, toolPermissionMode, workspace)
            ) + (tools ? estimateToolDefinitionTokens(tools) : 0),
        }).budget,
      });

      logger.info('turn.attempt', {
        requestId,
        providerId: request.providerId,
        modelId: request.modelId,
        attempt,
        compactionMode,
        historyMessages: modelInput.recentMessages.length,
        historyTokens: modelInput.usage.historyTokens,
        summaryTokens: modelInput.usage.addendumTokens,
        droppedTurns: modelInput.usage.droppedTurnCount,
        toolCount: tools ? Object.keys(tools).length : 0,
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
            workspace,
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
          logger.warn('turn.compacting', {
            requestId,
            modelId: request.modelId,
            attempt,
            historyTokens: modelInput.usage.historyTokens,
            code: normalized.code,
          });
          emitEvent({
            type: 'notice',
            requestId,
            code: 'compacting',
            level: 'info',
            message: 'The conversation was too long for this model. Summarising older turns and retrying.',
            });
          continue;
        }

        // A timeout is not a blip. Every other retryable failure comes back in
        // milliseconds, so three of them cost seconds; a first-response timeout
        // costs `firstResponseTimeoutMs` each, and four attempts of that is
        // twelve minutes of a transcript that says nothing but "Thinking"
        // before the user is told anything at all. One retry covers the genuine
        // hiccup; past that the honest answer is the error.
        const retryBudget = normalized.code === 'timeout' ? 1 : MAX_STREAM_RETRIES;
        const canRetry =
          attempt < retryBudget && normalized.retryable && !streamedAnyResponse && !signal.aborted;

        if (!canRetry) {
          throw error;
        }

        // Honour the provider's own Retry-After when it sent one, otherwise
        // back off exponentially instead of hammering with a fixed short delay.
        const delayMs = computeRetryDelayMs(attempt, normalized.retryAfterMs);
        attempt += 1;

        logger.warn('turn.retrying', {
          requestId,
          modelId: request.modelId,
          providerId: request.providerId,
          attempt,
          retryBudget,
          code: normalized.code,
          delayMs,
          attemptMs: attemptElapsed(),
          error,
        });

        // Said out loud, because the alternative is what shipped: a retry after
        // a 180s timeout is three silent minutes in which the transcript claims
        // the model is thinking.
        emitEvent({
          type: 'notice',
          requestId,
          code: 'retrying',
          level: 'warning',
          message: buildRetryNotice(normalized.code, attempt, retryBudget),
        });

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
