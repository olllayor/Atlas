import { DEFAULT_TOOL_PERMISSION_MODE, type ToolPermissionMode } from '../../../shared/chatParameters';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { ModelMessage } from 'ai';
import type { BrowserWindow } from 'electron';

import type {
  ApprovalDecision,
  ChatMessagePart,
  ChatStartRequest,
  ChatStartResponse,
  ChatInputPart,
  ConversationDetail,
  ConversationSummary,
  ConversationStatus,
  ContextUsageSnapshot,
  GetContextUsageRequest,
  OpenVisualWindowRequest,
  RecoverEventsResponse,
  RuntimeStateSnapshot,
  StreamEvent,
  ToolApprovalResponseRequest,
} from '../../../shared/contracts';
import {
  finalizeMessageParts,
  finalizeInterruptedParts,
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
  getAttachmentKind,
  getContentPreviewText,
  normalizeAttachmentMediaType,
  sumAttachmentSize,
} from '../../../shared/attachments';
import { buildStandaloneVisualWindowHtml, buildVisualSrcDoc } from '../../../shared/visualDocument';
import type { GoalRuntime } from '../goal/goalRuntime';
import { GOAL_CONTINUATION_STEER, GOAL_PROGRESS_TOOLS } from '../goal/goalRuntime';
import {
  deriveTitleFromUserMessage,
  isPlaceholderSessionTitle,
  sanitizeGeneratedTitle,
} from '../../../shared/sessionTitles';
import { assistantCitationsToPlainText } from '../../../shared/citations';
import type { AttachmentStore } from '../../attachments/AttachmentStore';
import type { ConversationsRepo } from '../../db/repositories/conversationsRepo';
import type { ModelsRepo } from '../../db/repositories/modelsRepo';
import type { RuntimeStateRepo } from '../../db/repositories/runtimeStateRepo';
import type { KeychainStore } from '../../secrets/keychain';
import { logger, startTimer } from '../../observability/logger';
import type { RejectedCapability } from './ErrorNormalizer';
import { detectRejectedCapability, normalizeError } from './ErrorNormalizer';
import { requiresStoredCredential } from './ProviderAdapter';
import { ToolApprovalController } from './ToolApprovalController';
import { isMcpToolName } from '../../../shared/mcp';
import type { AuditInput } from '../mcp/McpAuditLog';
import type { ProviderRegistry } from './providerRegistry';
import type { ExecuteTurnResult } from './ChatSessionRuntime';
import { ChatSessionRuntime } from './ChatSessionRuntime';
import { SubagentRuntime } from '../agents/SubagentRuntime';
import { SubagentContinuationManager } from '../agents/SubagentContinuationManager';
import { BackgroundLivenessService } from './BackgroundLivenessService';
import { enrichSubagentEntries } from '../agents/subagentProjections';
import { ToolExecutionTracker } from '../tools/ToolExecutionTracker';
import type { ToolStateStore } from '../tools/ToolStateStore';
import { shouldPersistResponseMessages } from './persistResponseMessages';
import type { TurnCheckpointHooks } from '../../workspace/CheckpointCoordinator';
import { NOOP_TURN_CHECKPOINTS } from '../../workspace/CheckpointCoordinator';
import { getBufferedEventKey, mergeBufferedEvents } from './streamBuffer';

type ActiveRequest = {
  requestId: string;
  controller: AbortController;
  window: BrowserWindow;
  /** Null when the submitting window was already gone at prepare time. */
  onWindowClosed: (() => void) | null;
  request: ChatStartRequest;
  turnId: string;
  assistantMessageId: string;
  parts: ChatMessagePart[];
  responseMessages: ModelMessage[];
  awaitingApproval: boolean;
  tracker: ToolExecutionTracker | null;
  /**
   * Set when this turn completed a side-effecting tool call — the one signal
   * goal mode accepts as substantive progress (prose never resets the stall
   * streak; Orca's rule). bash counts as a whole here: read-only inspection
   * still proves the model is engaging with the workspace rather than
   * restating its plan.
   */
  goalProgress?: boolean;
  /** Timestamp of the last SQLite persistence of message parts during streaming. */
  lastPersistAt?: number;
  /** Set when in-memory parts have changed since last persistence. */
  dirtyMessage?: boolean;
  /** Trailing timer to ensure dirty parts persist even if streaming stream pauses. */
  persistTimer?: ReturnType<typeof setTimeout> | null;
  resolvedApprovals?: Map<string, { approvalId: string; approved: boolean; reason?: string }>;
};

type BufferedRequestEvents = {
  timer: ReturnType<typeof setTimeout> | null;
  events: Map<string, Extract<StreamEvent, { type: 'chunk' | 'reasoning' | 'tool-input-delta' }>>;
};

const STREAM_BATCH_INTERVAL_MS = 33;
/**
 * ARCHITECTURE INVARIANT: 1-second streaming persistence throttle.
 *
 * Typing/event-loop benchmarks showed throttling synchronous SQLite writes
 * during continuous streaming cuts DB write overhead by ~96.6% (23.61 ms down
 * to 0.79 ms) while settle paths (`message.completed`, `turn.completed`,
 * `turn.failed`, interruption, error) force-persist, so crash durability of
 * settled turns is preserved. better-sqlite3 writes block the main thread, so
 * lowering this reintroduces jank and raising it widens the crash-loss window
 * (max ~1s of unpersisted tail). Do not retune without rerunning
 * `bench:typing` and `bench:eventloop`.
 */
export const STREAM_PERSIST_INTERVAL_MS = 1000;

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
  | 'listPendingFollowups'
  | 'listConversationsWithFollowups'
  | 'getFollowupQueuedEvent'
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
  listPendingFollowups: () => [],
  listConversationsWithFollowups: () => [],
  getFollowupQueuedEvent: () => null,
};

/**
 * Whether the call awaiting approval asked to run without the OS sandbox.
 *
 * Read off the streamed part rather than threaded through the approval record:
 * the input is already sitting there under the same `toolCallId`, and a
 * partially-streamed call is still a plain JSON string at this point.
 */
function isSandboxEscalatedCall(parts: ChatMessagePart[], toolCallId: string) {
  const part = parts.find(
    (candidate): candidate is Extract<ChatMessagePart, { type: 'tool' }> =>
      candidate.type === 'tool' && candidate.toolCallId === toolCallId,
  );

  if (!part) {
    return false;
  }

  const input = part.input ?? parseJsonObject(part.rawInput);

  return Boolean(
    input && typeof input === 'object' && (input as { dangerouslyDisableSandbox?: unknown }).dangerouslyDisableSandbox === true,
  );
}

function parseJsonObject(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    // A half-streamed argument object is not a signal either way; the caller
    // treats it as unescalated, and the ladder still gates the call.
    return null;
  }
}

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

/**
 * Ceiling for the naming call. Well above a reasoning model's warm-up, well
 * below the provider stream's own 180s watchdogs.
 */
const TITLE_GENERATION_TIMEOUT_MS = 90_000;

/** 16 hex chars: enough to tell "changed" from "unchanged", small in a log. */
function sha256Short(value: string | undefined) {
  if (!value) {
    return null;
  }
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function messageContentChars(message: ModelMessage) {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') {
    return content.length;
  }
  try {
    return JSON.stringify(content ?? '').length;
  } catch {
    return 0;
  }
}

/**
 * How many turns may stream at once, across all conversations.
 *
 * Three is what a single provider key tolerates before rate limiting turns
 * "parallel" into "all of them slower"; the rest wait as `queued`.
 */
const MAX_CONCURRENT_TURNS = 3;

export class ChatEngine {
  private readonly activeRequests = new Map<string, ActiveRequest>();
  /** Requests currently holding one of the concurrency slots. */
  private readonly runningRequestIds = new Set<string>();
  /** Requests accepted but waiting for a slot, oldest first. */
  private readonly queuedRequestIds: string[] = [];
  /**
   * Follow-ups: messages accepted while their conversation already had a turn
   * in flight. Unlike the slot queue above, these are deferred whole — no turn
   * row, no assistant placeholder — so a queued message never renders as an
   * empty assistant bubble. Oldest first, and strictly per-conversation FIFO:
   * a conversation's second follow-up cannot start before its first.
   *
   * Every transition is also an append-only event (`turn.followup_*`), and
   * `resumePersistedFollowups` folds those back after a restart — the queue's
   * live state is disposable, its log is not (dsh's durable-inbox pattern).
   */
  private readonly followupQueue: Array<{
    requestId: string;
    request: ChatStartRequest;
    /** The submitting window; null after a restart-resume until one exists. */
    window: BrowserWindow | null;
    preview: string;
  }> = [];
  /**
   * The `closed` listener registered per follow-up, kept keyed by requestId so
   * dispatch can remove exactly the closure it registered — a fresh arrow per
   * call would make removeListener a silent no-op.
   */
  private readonly followupCloseListeners = new Map<string, () => void>();
  /** Counts envelope writes for the periodic retention prune. */
  private headerWrites = 0;

  private dropFollowupListener(requestId: string) {
    let listener = this.followupCloseListeners.get(requestId);
    if (!listener) {
      listener = () => this.dropFollowup(requestId);
      this.followupCloseListeners.set(requestId, listener);
    }
    return listener;
  }
  private readonly bufferedEvents = new Map<string, BufferedRequestEvents>();
  private readonly backgroundLiveness: import('./BackgroundLivenessService').BackgroundLivenessService;
  private readonly continuationManager: SubagentContinuationManager;
  private readonly subagentRuntime: SubagentRuntime;

  constructor(
    private readonly conversationsRepo: ConversationsRepo,
    private readonly modelsRepo: ModelsRepo,
    private readonly keychain: KeychainStore,
    private readonly providers: ProviderRegistry,
    private readonly attachmentStore: AttachmentStore,
    private readonly runtime: Pick<
      ChatSessionRuntime,
      'executeTurn' | 'measureContextUsage' | 'requestForcedCompaction'
    > = new ChatSessionRuntime(
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
      | 'listPendingFollowups'
      | 'listConversationsWithFollowups'
      | 'getFollowupQueuedEvent'
    > = NOOP_RUNTIME_STATE_REPO,
    private readonly toolStateStore?: ToolStateStore,
    private readonly approvalController = new ToolApprovalController(),
    /**
     * Called when a provider refuses a turn *because of* something the request
     * carried — an attachment kind, or the tool definitions. The catalog cannot
     * describe most endpoints, so the failed send is the only source that ever
     * learns the answer — see
     * `CustomProviderService.recordCapabilityRejection`.
     */
    private readonly onCapabilityRejected?: (input: {
      modelId: string;
      capability: RejectedCapability;
    }) => void | Promise<void>,
    /**
     * Snapshots the project folder on either side of a turn. Failures here are
     * swallowed by the coordinator — a repository that cannot be snapshotted is
     * still one the user is allowed to send from.
     */
    private readonly checkpoints: TurnCheckpointHooks = NOOP_TURN_CHECKPOINTS,
    /**
     * Where approval decisions are recorded.
     *
     * Last, and optional, so every existing call site is unchanged — and
     * observational, so a build that never passes one behaves identically.
     */
    private readonly auditLog?: { record: (input: AuditInput) => void },
    /**
     * Attributes a wire tool name to the installed plugin behind it, for the
     * approval audit trail. `ChatEngine` has no registry of its own — this is
     * built fresh from one each call, in `index.ts`, so it always answers
     * against what is installed *now* rather than what was installed when the
     * engine was constructed.
     */
    private readonly pluginLookup?: (toolName: string) => { name: string; version: string | null } | null,
    /**
     * Where resumed follow-ups find a window to deliver events through.
     * Injected rather than imported so plain-Node tests (which cannot load
     * Electron's module) can run the queue; main passes the live lookup.
     */
    private readonly resolveEventWindow?: () => BrowserWindow | null
  ) {
    this.backgroundLiveness = new BackgroundLivenessService();
    this.continuationManager = new SubagentContinuationManager({
      conversationsRepo: this.conversationsRepo,
      runtimeStateRepo: this.runtimeStateRepo,
      executeTurn: async ({ childId, parentConversationId, prompt, model, tools, depth, parentAgentId, signal }) => {
        // Resolve provider/model: inherit from parent conversation or use child's override, fallback to first configured model
        const parentSummary = this.conversationsRepo.getSummary(parentConversationId);
        const childSummary = this.conversationsRepo.getSummary(childId);
        const fallback = this.resolveFallbackModel();
        const providerId = parentSummary?.defaultProviderId ?? childSummary?.defaultProviderId ?? fallback?.providerId ?? 'openrouter';
        const modelId = model ?? parentSummary?.defaultModelId ?? childSummary?.defaultModelId ?? fallback?.modelId ?? 'unknown';
        const requestId = randomUUID();
        // Continuable turns are persisted so history survives cold resume
        const result = await this.runtime.executeTurn({
          requestId,
          request: {
            conversationId: childId,
            providerId,
            modelId,
            messages: [{ role: 'user', content: prompt }],
            enableTools: true,
          },
          signal,
          persistMessage: true,
          subagentRuntime: this.subagentRuntime,
          continuationManager: this.continuationManager,
          parentAgentId,
          depth,
          allowedTools: tools,
          emitEvent: () => {},
        });
        return result;
      },
      onRuntimeEvent: (envelope) => {
        // Classification lives in the service; this is only the boundary.
        try {
          this.backgroundLiveness.recordTaskEnvelope(envelope);
        } catch {}
        const activeReq = Array.from(this.activeRequests.values()).find(
          (req) => req.request.conversationId === envelope.conversationId
        );
        if (activeReq) {
          this.sendToWindow(activeReq.window, {
            type: 'runtime-sync',
            conversationId: envelope.conversationId,
            requestId: envelope.requestId,
            eventId: envelope.eventId,
            sequence: envelope.sequence,
          });
        }
      },
      onLivenessChange: (parentId, childId, status) => {
        try {
          this.backgroundLiveness.recordSubagentLiveness({ conversationId: parentId, subagentId: childId, status });
        } catch {}
      },
    });
    this.subagentRuntime = new SubagentRuntime({
      runtimeStateRepo,
      continuationManager: this.continuationManager,
      createChildConversation: (input) => {
        const maybeRepo = this.conversationsRepo as unknown as Partial<Pick<ConversationsRepo, 'createSubagentConversation'>>;
        if (typeof maybeRepo.createSubagentConversation !== 'function') return null;
        return maybeRepo.createSubagentConversation({
          parentConversationId: input.parentConversationId,
          title: input.title,
          delegationDepth: input.delegationDepth,
          agentId: input.agentId,
          mode: input.mode as 'one-shot' | 'continuable',
          parentTurnId: input.parentTurnId,
        });
      },
      deleteChildConversation: (childId) => {
        try {
          this.conversationsRepo.delete(childId);
        } catch {}
      },
      onRuntimeEvent: (envelope) => {
        const activeReq = Array.from(this.activeRequests.values()).find(
          (req) => req.request.conversationId === envelope.conversationId
        );
        if (activeReq) {
          this.sendToWindow(activeReq.window, {
            type: 'runtime-sync',
            conversationId: envelope.conversationId,
            requestId: envelope.requestId,
            eventId: envelope.eventId,
            sequence: envelope.sequence,
          });
        }
      },
      childExecutor: async ({ conversationId, prompt, model, role, tools, outputFile, signal, onEvent, parentAgentId, depth }) => {
        const activeReq = Array.from(this.activeRequests.values()).find(
          (req) => req.request.conversationId === conversationId
        );
        const parentRequest = activeReq?.request;
        const convSummary = this.conversationsRepo.getSummary(conversationId);
        const fallback = this.resolveFallbackModel();
        const providerId = parentRequest?.providerId ?? convSummary?.defaultProviderId ?? fallback?.providerId ?? 'openrouter';
        const modelId = model ?? parentRequest?.modelId ?? convSummary?.defaultModelId ?? fallback?.modelId ?? 'unknown';

        const childRequestId = randomUUID();

        const effectiveParentMode: ToolPermissionMode =
          parentRequest?.toolPermissionMode ??
          convSummary?.toolPermissionMode ??
          DEFAULT_TOOL_PERMISSION_MODE;

        const childStartRequest: ChatStartRequest = {
          conversationId,
          providerId,
          modelId,
          messages: [],
          enableTools: true,
          toolPermissionMode: effectiveParentMode === 'read-only' ? 'read-only' : 'full-access',
        };

        let currentMessages: ModelMessage[] = [
          {
            role: 'user',
            content: role ? `[Role: ${role}]\n\n${prompt}` : prompt,
          },
        ];

        let accumulatedParts: ChatMessagePart[] = [];
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        let turnResult: ExecuteTurnResult;
        let loops = 0;
        const MAX_CHILD_TURNS = 15;

        while (true) {
          loops += 1;
          turnResult = await this.runtime.executeTurn({
            requestId: childRequestId,
            request: childStartRequest,
            signal,
            persistMessage: false,
            messagesOverride: currentMessages,
            initialParts: accumulatedParts,
            subagentRuntime: this.subagentRuntime,
            continuationManager: this.continuationManager,
            parentAgentId,
            depth,
            allowedTools: tools,
            emitEvent: (evt) => {
              onEvent(evt);
            },
          });

          accumulatedParts = turnResult.parts ?? accumulatedParts;
          totalInputTokens += turnResult.inputTokens ?? 0;
          totalOutputTokens += turnResult.outputTokens ?? 0;

          if (turnResult.status !== 'awaiting_approval' || !turnResult.pendingApprovals.length) {
            break;
          }

          if (loops >= MAX_CHILD_TURNS) {
            break;
          }

          // Subagents run in full-access (unless the parent is read-only), so they
          // never pause for approval — the parent already delegated.
          const isFullAccessChild = childStartRequest.toolPermissionMode === 'full-access';
          const allAutoApproved = isFullAccessChild
            ? true
            : turnResult.pendingApprovals.every((approval) => {
                const toolType = inferCanonicalToolType({ toolName: approval.toolName });
                const sessionScopeKey = isSandboxEscalatedCall(accumulatedParts, approval.toolCallId)
                  ? null
                  : buildApprovalScopeKey(toolType, approval.toolName);
                return (
                  sessionScopeKey &&
                  this.approvalController.hasConversationScopeGrant(conversationId, sessionScopeKey)
                );
              });

          if (!allAutoApproved) {
            break;
          }

          const approvalMessage: ModelMessage = {
            role: 'tool',
            content: turnResult.pendingApprovals.map((approval) => ({
              type: 'tool-approval-response',
              approvalId: approval.approvalId,
              approved: true,
            })),
          } as ModelMessage;

          currentMessages = [
            ...currentMessages,
            ...(turnResult.responseMessages ?? []),
            approvalMessage,
          ];
        }

        const text = turnResult.parts
          .filter((p) => p.type === 'text')
          .map((p) => (p as { text: string }).text)
          .join('\n');

        if (outputFile) {
          try {
            await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });
            await fs.promises.writeFile(outputFile, text, 'utf-8');
          } catch (err) {
            logger.error('Failed to write subagent output file', { outputFile, error: err });
          }
        }

        const isAwaitingApproval =
          turnResult.status === 'awaiting_approval' || turnResult.pendingApprovals.length > 0;

        return {
          content: text || (isAwaitingApproval ? 'Child task requested unapproved tool execution' : 'Completed subagent task'),
          status: isAwaitingApproval ? 'awaiting_approval' : 'completed',
          usage: {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            totalTokens: totalInputTokens + totalOutputTokens,
          },
        };
      },
    });
  }

  /*
    Goal mode (C4 /goal). Optional and attached after construction: index.ts
    builds the GoalRuntime over this engine's own callbacks, so a constructor
    parameter would be circular. Null outside the real app (tests).
  */
  private goalRuntime: GoalRuntime | null = null;

  attachGoalRuntime(runtime: GoalRuntime): void {
    this.goalRuntime = runtime;
  }

  /**
   * Durable-log writer for goal lifecycle events. Same repo path the followup
   * queue uses, so goal rows replay in the transcript's activity stream like
   * every other work-log entry.
   */
  recordGoalActivity(input: {
    eventId: string;
    conversationId: string;
    activityType: string;
    payload: Record<string, unknown>;
  }): void {
    this.runtimeStateRepo.recordEvent({
      eventId: input.eventId,
      conversationId: input.conversationId,
      turnId: input.eventId,
      requestId: input.eventId,
      activityType: input.activityType as Parameters<RuntimeStateRepo['recordEvent']>[0]['activityType'],
      tone: 'info',
      provider: 'system',
      providerEventType: input.activityType,
      payload: input.payload,
    });
  }

  /** Public view for the GoalRuntime's admission-gate callbacks. */
  isBusyForGoal(conversationId: string): boolean {
    return this.isConversationBusy(conversationId);
  }

  hasPendingGoalApproval(conversationId: string): boolean {
    for (const active of this.activeRequests.values()) {
      if (active.request.conversationId === conversationId && active.awaitingApproval) {
        return true;
      }
    }
    return false;
  }

  /** Aborts the conversation's live turn, if any. Used by goal pause (persist-before-cancel ordering lives in the IPC handler). */
  abortActiveTurn(conversationId: string): boolean {
    for (const [requestId, active] of this.activeRequests) {
      if (active.request.conversationId === conversationId) {
        void this.abort(requestId);
        return true;
      }
    }
    return false;
  }

  /**
   * Starts the next outer turn of an active goal without a user message.
   *
   * The steer text rides only in the request payload — it is never persisted,
   * so the transcript shows the goal's work, not the harness's nudges (Orca
   * keeps internal context out of the transcript for the same reason).
   * Callers must have admitted this continuation via the GoalRuntime gate.
   */
  startGoalContinuation(conversationId: string): void {
    if (this.isConversationBusy(conversationId)) return;
    const summary = this.conversationsRepo.getSummary(conversationId) as
      | { defaultProviderId?: string | null; defaultModelId?: string | null }
      | null;
    const fallback = this.resolveFallbackModel();
    const providerId = summary?.defaultProviderId ?? fallback?.providerId;
    const modelId = summary?.defaultModelId ?? fallback?.modelId;
    if (!providerId || !modelId) return;

    const requestId = randomUUID();
    logger.info('goal.turn.continuation', { requestId, conversationId });
    const window = this.resolveMainWindow();
    if (!window || window.isDestroyed()) {
      // Nowhere to stream into (app closing): drop the turn. The goal stays
      // active; the next user interaction or resume re-admits.
      return;
    }
    const request: ChatStartRequest = {
      conversationId,
      providerId,
      modelId,
      messages: [{ role: 'user', content: GOAL_CONTINUATION_STEER }],
      enableTools: true,
    };
    this.prepareTurn(window, requestId, request);
  }

  private notifyGoalSettled(
    conversationId: string,
    info: { aborted: boolean; failed: boolean; hadSubstantiveProgress: boolean; tokensIn: number; tokensOut: number },
  ): void {
    try {
      this.goalRuntime?.onTurnSettled(conversationId, info);
    } catch (error) {
      // A goal bug must never corrupt the turn teardown it runs inside.
      logger.warn('goal.settle_failed', { conversationId, error });
    }
  }


  private resolveFallbackModel(): { providerId: string; modelId: string } | null {
    try {
      const configured = this.modelsRepo.list({ configuredOnly: true });
      if (configured.length > 0) return { providerId: configured[0].providerId, modelId: configured[0].id };
      const all = this.modelsRepo.list();
      if (all.length > 0) return { providerId: all[0].providerId, modelId: all[0].id };
    } catch {}
    const firstProvider = Array.from(this.providers.keys())[0];
    if (firstProvider) return { providerId: firstProvider, modelId: 'unknown' };
    return null;
  }

  /**
   * The subagent runtime, exposed so the app shell can cascade-stop live
   * subagent sessions on conversation deletion and app quit — the same
   * owner-disposal edges the background-job registry already handles.
   */
  get subagents(): SubagentRuntime {
    return this.subagentRuntime;
  }

  get continuations(): SubagentContinuationManager {
    return this.continuationManager;
  }

  listSubagents(parentConversationId: string) {
    const raw = this.conversationsRepo.listSubagentChildren(parentConversationId);
    return enrichSubagentEntries(raw, this.conversationsRepo, this.continuationManager);
  }

  async followupSubagent(parentConversationId: string, childId: string, content: string): Promise<string> {
    return this.continuationManager.followup(parentConversationId, childId, content);
  }

  interruptSubagent(childId: string): { accepted: true } {
    return this.continuationManager.interrupt(childId);
  }

  /**
   * Stop every live agent in a conversation without touching the parent turn.
   *
   * The composer's stop already fans out on its way to aborting the turn; this
   * is the other case — a fleet still running after its launching turn ended,
   * which the composer no longer offers a control for.
   */
  async interruptConversationAgents(conversationId: string): Promise<{ interrupted: number }> {
    const interrupted = await this.subagentRuntime.interruptAll(
      conversationId,
      'Stopped from the Agents panel'
    );
    return { interrupted };
  }

  /**
   * Composer takeover input (plan §3.5): whether `childId` is a subagent, its
   * mode, whether the exact parent can still authorize followups, and whether
   * a live activation is working. Null for ordinary conversations.
   */
  getSubagentComposerState(childId: string): {
    isSubagent: true;
    mode: 'one-shot' | 'continuable';
    parentAvailable: boolean;
    running: boolean;
  } | null {
    const meta = this.conversationsRepo.getSubagentMeta(childId);
    if (!meta || meta.origin !== 'subagent') return null;

    const parentAvailable = (() => {
      if (!meta.parentId) return false;
      try {
        const parent = this.conversationsRepo.getSummary(meta.parentId);
        return Boolean(parent && !parent.archivedAt);
      } catch {
        return false;
      }
    })();

    const status = this.continuationManager.getActivationStatus(childId);
    const running = Boolean(status && (status.processing || status.queued > 0));

    return { isSubagent: true, mode: meta.mode === 'continuable' ? 'continuable' : 'one-shot', parentAvailable, running };
  }

  getSubagentHistory(request: { parentConversationId: string; childId: string; mode?: string | null }): ConversationDetail {
    const meta = this.conversationsRepo.getSubagentMeta(request.childId);
    if (!meta || meta.origin !== 'subagent') {
      throw new Error(`Conversation ${request.childId} is not a subagent`);
    }
    if (meta.parentId !== request.parentConversationId) {
      throw new Error(`Parent mismatch for subagent ${request.childId}`);
    }
    if (request.mode != null && meta.mode !== request.mode) {
      throw new Error(`Mode mismatch for subagent ${request.childId}: expected ${request.mode}, got ${meta.mode}`);
    }
    return this.conversationsRepo.get(request.childId);
  }

  getSubagentsLiveness(): Map<string, 'working' | 'monitoring' | null> {
    // Directly project the liveness registry — never enumerate conversations via
    // `list()` which is paginated/filtered and would miss parents not on the
    // first page or archived parents with live children.
    return new Map(this.backgroundLiveness.getAllLiveness() as Map<string, 'working' | 'monitoring' | null>);
  }

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

    const selectedModel = this.modelsRepo.getById(request.modelId, request.providerId);
    const capabilityError = getAttachmentCapabilityError(selectedModel, fileParts);
    if (capabilityError) {
      throw new Error(capabilityError);
    }

    const requestId = randomUUID();

    // What the turn is carrying, recorded before anything can go wrong with it.
    // Attachment bytes are the first thing worth knowing when a send takes
    // minutes: a 3.7 MB image becomes ~4.9 MB of base64 on the wire, which is
    // enough to stall a gateway past the first-response watchdog.
    logger.info('turn.started', {
      requestId,
      conversationId: request.conversationId,
      providerId: request.providerId,
      modelId: request.modelId,
      enableTools: request.enableTools ?? false,
      textChars: previewContent.length,
      attachmentCount: fileParts.length,
      attachmentBytes: sumAttachmentSize(fileParts),
      attachmentTypes: fileParts.map((part) => part.mediaType),
    });

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

    // User-initiated activity re-engages a parked chat: sending into a
    // settled or snoozed conversation returns it to the active list. Only
    // the send path calls this — agent completions and goal-loop
    // continuations must not clear parked state, or parking would be moot.
    this.conversationsRepo.clearLifecycleOnUserActivity(request.conversationId);

    // Name the session from the prompt right now, before a single token is
    // streamed. Waiting for the model meant every in-flight thread sat in
    // the sidebar as `Session · <date>` — the title arrived, if at all,
    // long after the user had stopped looking for it.
    this.applyLocalTitle(window, request.conversationId, previewContent);

    // A conversation with a turn already open takes this message as a
    // follow-up rather than a competing turn: two live streams in one thread
    // would interleave answers out of order and race each other's tool calls.
    // The message above is durable, so nothing is lost waiting; the turn's own
    // rows are created only when the follow-up actually starts.
    if (this.isConversationBusy(request.conversationId)) {
      const onWindowClosed = this.dropFollowupListener(requestId);
      window.once('closed', onWindowClosed);
      const index = this.followupQueue.findIndex((entry) => entry.request.conversationId === request.conversationId);
      this.followupQueue.splice(index + 1, 0, { requestId, request, window, preview: previewContent });
      // Durable enqueue: the fold at boot rebuilds the waiting line from this.
      this.recordFollowupEvent(request.conversationId, 'turn.followup_queued', requestId, {
        preview: previewContent,
        request,
      });
      this.markConversationStatus(request.conversationId, 'queued', { lastError: null });
      return { requestId, queued: true };
    }

    this.prepareTurn(window, requestId, request);

    return { requestId };
  }

  /** Does this conversation have a turn open or a follow-up already waiting? */
  private isConversationBusy(conversationId: string) {
    return this.hasLiveTurn(conversationId) || this.followupQueue.some((entry) => entry.request.conversationId === conversationId);
  }

  /** Does this conversation currently hold an ActiveRequest (running, awaiting approval, or parked for a slot)? */
  private hasLiveTurn(conversationId: string) {
    for (const active of this.activeRequests.values()) {
      if (active.request.conversationId === conversationId) {
        return true;
      }
    }
    return false;
  }

  private dropFollowup(requestId: string) {
    const index = this.followupQueue.findIndex((entry) => entry.requestId === requestId);
    if (index >= 0) {
      this.removeFollowupAt(index);
    }
  }

  /**
   * Creates everything a running turn needs — abort wiring, the assistant
   * placeholder, the turn and session rows, the baseline checkpoint — and then
   * either starts it or parks it for the next free concurrency slot.
   *
   * `origin` distinguishes a direct submit from a queue dispatch so the
   * durable log can mark the follow-up consumed (`turn.followup_started`),
   * which is what keeps a restarted fold from resurrecting it.
   */
  private prepareTurn(
    window: BrowserWindow | null,
    requestId: string,
    request: ChatStartRequest,
    origin: 'direct' | 'followup' = 'direct',
  ) {
    // A resumed follow-up has no submitting window; its events still have to
    // reach the user, so they ride the frontmost window instead. With no
    // window at all there is nowhere to deliver events — bail before any row
    // is created and let the dispatcher retry once one exists.
    const effectiveWindow = window ?? this.resolveMainWindow();
    if (!effectiveWindow) {
      return;
    }

    if (origin === 'direct' && this.hasLiveTurn(request.conversationId)) {
      const lastMessage = request.messages.at(-1);
      const preview = lastMessage ? getContentPreviewText(lastMessage.content, lastMessage.parts ?? []) : '';
      const onWindowClosed = this.dropFollowupListener(requestId);
      if (window && !window.isDestroyed()) window.once('closed', onWindowClosed);
      const idx = this.followupQueue.findIndex((e) => e.request.conversationId === request.conversationId);
      this.followupQueue.splice(idx + 1, 0, { requestId, request, window, preview });
      this.recordFollowupEvent(request.conversationId, 'turn.followup_queued', requestId, { preview, request });
      this.markConversationStatus(request.conversationId, 'queued', { lastError: null });
      return;
    }

    const assistantMessageId = randomUUID();
    const turnId = randomUUID();

    const controller = new AbortController();
    let onWindowClosed: (() => void) | null = null;
    if (window && !window.isDestroyed()) {
      onWindowClosed = () => {
        void this.subagentRuntime.interruptAll(request.conversationId, 'Window closed');
        controller.abort();
        this.cleanupRequest(requestId);
      };
      window.once('closed', onWindowClosed);
    }

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
    if (origin === 'followup') {
      // Marks the durable queue entry consumed. Without this, a restart fold
      // would see the follow-up as still pending and run it twice.
      this.recordFollowupEvent(request.conversationId, 'turn.followup_started', requestId, {});
    }

    // Awaited, not fired off: the baseline has to be on disk before the first
    // tool can touch a file, or the turn's own edits end up inside its own
    // "before" snapshot and the diff comes out empty. The capture is awaited
    // inside runRequest instead of here so queuing for a concurrency slot
    // never blocks the caller on filesystem work.
    this.activeRequests.set(requestId, {
      requestId,
      controller,
      window: effectiveWindow,
      onWindowClosed,
      request,
      turnId,
      assistantMessageId,
      parts: [],
      responseMessages: [],
      awaitingApproval: false,
      lastPersistAt: Date.now(),
      dirtyMessage: false,
      persistTimer: null,
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

    void this.prepareAndRun(effectiveWindow, requestId, request, turnId, assistantMessageId, controller);
  }

  /** Frontmost window for event delivery when the submitter is gone. */
  private resolveMainWindow(): BrowserWindow | null {
    return this.resolveEventWindow?.() ?? null;
  }

  /**
   * One writer for the three queue-lifecycle events. Failures are swallowed:
   * the log is how a restart rebuilds the queue, but a failed append must not
   * break the live dispatch it describes.
   */
  private recordFollowupEvent(
    conversationId: string,
    activityType: 'turn.followup_queued' | 'turn.followup_started' | 'turn.followup_cancelled',
    requestId: string,
    payload: Record<string, unknown>,
  ) {
    try {
      this.runtimeStateRepo.recordEvent({
        eventId: randomUUID(),
        conversationId,
        turnId: requestId,
        requestId,
        activityType,
        tone: 'info',
        provider: 'system',
        providerEventType: activityType,
        payload,
      });
    } catch (error) {
      logger.warn('followup.event_failed', { conversationId, activityType, requestId, error });
    }
  }

  /**
   * Rebuilds the waiting line from the log after a restart.
   *
   * Pending = queued − started − cancelled per conversation, in sequence
   * order — exactly what `listPendingFollowups` folds. Entries re-enqueue with
   * their original requestIds so renderer-side optimistic state keeps matching;
   * they carry no window and borrow one at dispatch. Auto-resumed on purpose:
   * the user asked for these sends before the app closed (dsh resumes its
   * durable inbox the same way).
   */
  resumePersistedFollowups() {
    let resumed = 0;

    for (const conversationId of this.runtimeStateRepo.listConversationsWithFollowups()) {
      const pending = this.runtimeStateRepo.listPendingFollowups(conversationId);
      for (const entry of pending) {
        if (this.followupQueue.some((q) => q.requestId === entry.requestId) || this.activeRequests.has(entry.requestId)) {
          continue;
        }
        const stored = this.runtimeStateRepo.getFollowupQueuedEvent(conversationId, entry.requestId);
        if (!stored) {
          // The enqueue payload was torn or predates durability; drop the
          // entry from the fold rather than dispatching a half-known request.
          continue;
        }

        this.followupQueue.push({
          requestId: entry.requestId,
          request: stored.request as ChatStartRequest,
          window: null,
          preview: stored.preview,
        });
        resumed += 1;
      }

      if (pending.length > 0) {
        this.markConversationStatus(conversationId, 'queued', { lastError: null });
      }
    }

    if (resumed > 0) {
      logger.info('followup.resumed', { count: resumed });
      // Slots are free at boot; start draining immediately.
      this.startNextQueuedRequest();
    }
  }

  private async prepareAndRun(
    window: BrowserWindow,
    requestId: string,
    request: ChatStartRequest,
    turnId: string,
    assistantMessageId: string,
    controller: AbortController,
  ) {
    try {
      await this.checkpoints.captureTurnStart(request.conversationId, turnId);
    } catch (error) {
      logger.warn('checkpoint.capture_failed', { conversationId: request.conversationId, turnId, error });
    }

    // The conversation may have been aborted or the window closed while the
    // baseline was being captured; do not resurrect it.
    if (!this.activeRequests.has(requestId)) {
      return;
    }

    this.beginRun(requestId, request);
  }

  /** Marks a request as occupying a slot and starts it. */
  private beginRun(requestId: string, request: ChatStartRequest, messagesOverride?: ModelMessage[]) {
    this.runningRequestIds.add(requestId);
    this.markConversationStatus(request.conversationId, 'running', {
      startedAt: new Date().toISOString(),
      lastError: null,
    });

    setImmediate(() => {
      void this.runRequest(requestId, request, messagesOverride);
    });
  }

  /**
   * Hands freed capacity to the next piece of work.
   *
   * Follow-ups go first: a conversation that just finished owes its own queued
   * messages an answer before some other conversation's slot-waiting turn.
   * Within the follow-up queue the order is strict FIFO, and a conversation
   * with a turn still open is skipped — its earlier message must finish being
   * a turn before the next one becomes one.
   *
   * Requests aborted while queued were already dropped from `activeRequests`,
   * so they are skipped rather than resurrected.
   */
  private startNextQueuedRequest() {
    // Prune entries whose window died before dispatch — the `closed` listener
    // usually removes them first, but a destroyed-window check costs nothing
    // and keeps the scan from skipping over a corpse forever.
    for (let index = this.followupQueue.length - 1; index >= 0; index -= 1) {
      const window = this.followupQueue[index]?.window;
      if (window?.isDestroyed()) {
        this.removeFollowupAt(index);
      }
    }

    while (this.runningRequestIds.size < MAX_CONCURRENT_TURNS) {
      // Dispatchability looks only at live turns: the entry being considered
      // sits in this very queue, so counting queued siblings here would make
      // every head block itself forever. Ordering within the queue is already
      // guaranteed by scanning from the front — an earlier same-conversation
      // entry is either dispatched first or blocks this one through its own
      // live turn.
      const followupIndex = this.followupQueue.findIndex(
        (entry) => !this.hasLiveTurn(entry.request.conversationId),
      );
      if (followupIndex >= 0) {
        const [entry] = this.followupQueue.splice(followupIndex, 1);
        const { requestId, request, window } = entry;
        if (window && !window.isDestroyed()) {
          window.removeListener('closed', this.dropFollowupListener(requestId));
        }
        this.followupCloseListeners.delete(requestId);
        // A resumed entry has no submitting window; without any window to
        // deliver events through there is nothing to dispatch into yet, so it
        // goes back and waits for one to exist.
        if (!window && !this.resolveMainWindow()) {
          this.followupQueue.splice(followupIndex, 0, entry);
          return;
        }
        // Held synchronously: prepareTurn's beginRun only fires after the
        // checkpoint capture resolves, and without this the dispatch loop
        // would keep reading the slot as free and over-fill it.
        // If prepareTurn bails (no window), clean the reservation.
        const beforeSize = this.runningRequestIds.size;
        this.runningRequestIds.add(requestId);
        const activeBefore = this.activeRequests.size;
        this.prepareTurn(window, requestId, request, 'followup');
        // prepareTurn may have early-exited without creating activeRequest (no window or busy race) -> release slot
        if (this.activeRequests.size === activeBefore && this.runningRequestIds.size === beforeSize + 1) {
          this.runningRequestIds.delete(requestId);
        }
        continue;
      }

      const nextId = this.queuedRequestIds.shift();
      if (!nextId) {
        return;
      }

      const queued = this.activeRequests.get(nextId);
      if (queued) {
        this.beginRun(nextId, queued.request);
        return;
      }
    }
  }

  private removeFollowupAt(index: number) {
    const [entry] = this.followupQueue.splice(index, 1);
    if (!entry) {
      return;
    }
    // A resumed entry has no window registered against its removal.
    if (entry.window && !entry.window.isDestroyed()) {
      entry.window.removeListener('closed', this.dropFollowupListener(entry.requestId));
    }
    this.followupCloseListeners.delete(entry.requestId);
  }

  /**
   * Conversation-level status, which outlives the request the way a task does.
   *
   * The renderer already knows a turn is live from its own draft state; this
   * exists so the fact survives a reload and so a conversation the user
   * switched away from can still be shown as running or failed. Persisting it
   * must never take a turn down, hence the swallow.
   */
  private markConversationStatus(
    conversationId: string,
    status: ConversationStatus,
    fields: { startedAt?: string | null; completedAt?: string | null; lastError?: string | null } = {},
  ) {
    try {
      this.conversationsRepo.updateStatus(conversationId, {
        status,
        startedAt: fields.startedAt ?? null,
        completedAt: fields.completedAt ?? null,
        lastError: fields.lastError ?? null,
      });
    } catch (error) {
      logger.warn('conversation.status.persist_failed', { conversationId, status, error });
    }
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

  async abort(requestId: string) {
    // A follow-up that never started has no stream and no rows to close — the
    // user message stays in the transcript, unanswered, which is the honest
    // record of a message withdrawn before its turn began. The cancellation
    // is durable so a restart fold does not resurrect it.
    const followupEntry = this.followupQueue.find((entry) => entry.requestId === requestId);
    if (followupEntry) {
      this.dropFollowup(requestId);
      this.recordFollowupEvent(
        followupEntry.request.conversationId,
        'turn.followup_cancelled',
        requestId,
        {},
      );
      this.markConversationStatus(followupEntry.request.conversationId, 'idle', {
        completedAt: new Date().toISOString(),
      });
      // Same shape the renderer already handles for an aborted live stream:
      // its error path clears the draft and refetches, so no new state or
      // branch is needed on the other side of the IPC.
      if (followupEntry.window && !followupEntry.window.isDestroyed()) {
        this.sendEvent(followupEntry.window, {
          type: 'error',
          requestId,
          code: 'aborted',
          message: 'Message was cancelled while waiting to be sent.',
          retryable: false,
        });
      }
      this.clearBufferedEvents(requestId);
      return;
    }

    const active = this.activeRequests.get(requestId);
    if (active) {
      await this.subagentRuntime.interruptAll(active.request.conversationId, 'Parent turn aborted');
      active.controller.abort();
    }

    // A turn still waiting for a slot has no stream to abort, so the signal
    // would go nowhere: drop it from the queue and close it out here.
    const queuedIndex = this.queuedRequestIds.indexOf(requestId);
    if (queuedIndex >= 0) {
      this.queuedRequestIds.splice(queuedIndex, 1);
      if (active) {
        this.markConversationStatus(active.request.conversationId, 'idle', {
          completedAt: new Date().toISOString(),
        });
        this.conversationsRepo.updateMessage({
          messageId: active.assistantMessageId,
          status: 'aborted',
        });
        this.cleanupRequest(requestId, active);
      }
    }
  }

  /**
   * Prompt size for the next request. Measured in the runtime that builds the
   * prompt, so the ring cannot drift from what is actually sent.
   */
  getContextUsage(request: GetContextUsageRequest): ContextUsageSnapshot {
    return this.runtime.measureContextUsage(request);
  }

  /**
   * Manual `/compact`: the next turn re-splits from zero and walks to the
   * pressure line. No out-of-band model call — dsh's compactNow summarizes
   * immediately, but that requires an idle-turn seam Atlas does not have;
   * requesting here is cheap and cannot fail.
   */
  compactConversation(conversationId: string): void {
    this.runtime.requestForcedCompaction(conversationId);
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
      pendingFollowups: this.runtimeStateRepo.listPendingFollowups(conversationId),
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

    // The other half of the approval correlation. Recorded here, after the
    // decision is already resolved, so the trail can prove which request a
    // response answered — without which a transcript shows an approval and a
    // call with no way to tie them together. Purely observational: the branch
    // below acts on `request.decision`, never on whether this was written.
    if (isMcpToolName(resolved.toolName ?? '')) {
      this.auditLog?.record({
        requestId: request.requestId,
        conversationId: active.request.conversationId,
        type: 'approval_responded',
        server: null,
        plugin: this.pluginLookup?.(resolved.toolName ?? '') ?? null,
        tool: resolved.toolName ?? null,
        outcome:
          request.decision === 'decline'
            ? 'denied'
            : request.decision === 'cancel'
              ? 'cancelled'
              : 'ok',
        approvalId: request.approvalId,
        toolCallId: resolved.toolCallId ?? null,
        detail: request.reason ?? null,
        payload: { decision: request.decision, sessionScopeKey },
        // Keyed on the approval alone, matching `approval_requested`: a
        // decision is made once, and a duplicate delivery of this response
        // must not read as the approval having been decided twice.
        idempotencyKey: `ap:${request.approvalId}`
      });
    }

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

    // Providers that run their own tools keep the turn open across an approval:
    // the decision goes back over their wire and the same stream carries on,
    // instead of the request being re-run with an approval message.
    const adapter = this.providers.get(active.request.providerId);
    if (adapter?.resolveApproval) {
      active.awaitingApproval = false;
      await adapter.resolveApproval(
        request.approvalId,
        request.decision === 'accept_for_session'
          ? 'approve_always'
          : request.decision === 'accept'
            ? 'approve'
            : 'deny'
      );
      return;
    }

    if (request.decision === 'decline' || request.decision === 'cancel') {
      active.resolvedApprovals?.clear();
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

    if (!active.resolvedApprovals) {
      active.resolvedApprovals = new Map();
    }
    active.resolvedApprovals.set(request.approvalId, {
      approvalId: request.approvalId,
      approved: true,
      reason: request.reason,
    });

    if (this.approvalController.hasPendingApprovals(request.requestId)) {
      active.awaitingApproval = true;
      return;
    }

    const history = this.conversationsRepo.getModelHistory(active.request.conversationId);
    const resolvedList = Array.from(active.resolvedApprovals.values());
    active.resolvedApprovals.clear();

    const approvalMessage: ModelMessage = {
      role: 'tool',
      content: resolvedList.map((item) => ({
        type: 'tool-approval-response',
        approvalId: item.approvalId,
        approved: item.approved,
        ...(item.reason?.trim() ? { reason: item.reason.trim() } : {}),
      })),
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

    const elapsed = startTimer();

    try {
      const result = await this.runtime.executeTurn({
        requestId,
        request,
        signal: active.controller.signal,
        assistantMessageId: active.assistantMessageId,
        messagesOverride,
        initialParts: active.parts,
        subagentRuntime: this.subagentRuntime,
        continuationManager: this.continuationManager,
        emitEvent: (event) => {
          this.handleRuntimeStreamEvent(active, event);
        },
        onRequestHeader: (header) => {
          this.recordRequestHeader(active, header);
        },
      });

      active.parts = result.parts ?? active.parts;
      if (result.responseMessages?.length) {
        active.responseMessages.push(...result.responseMessages);
      }

      if (result.status === 'awaiting_approval') {
        active.awaitingApproval = true;
        this.persistActiveMessage(active, true);
        const pendingApprovals = result.pendingApprovals.map((approval) => {
          const toolType = inferCanonicalToolType({ toolName: approval.toolName });
          return {
            ...approval,
            conversationId: request.conversationId,
            toolType,
            // A call asking to run outside the OS sandbox is a different act
            // from the sandboxed one the user blessed for the session, and the
            // scope key is only the tool's name — so a standing "always allow
            // bash" would have waved it through unasked. Escalated calls carry
            // no scope at all: they cannot match a grant, and accepting one
            // cannot create a grant for the next.
            sessionScopeKey: isSandboxEscalatedCall(active.parts, approval.toolCallId)
              ? null
              : buildApprovalScopeKey(toolType, approval.toolName),
          };
        });
        this.approvalController.setPendingApprovals(requestId, pendingApprovals);
        this.runtimeStateRepo.completeTurn(active.turnId, this.runtimeStateRepo.getLastSequence(request.conversationId), 'awaiting_approval');
        // Full-access means "run without asking" — including OpenCode permission
        // asks and any built-in approval that still slipped through. The user
        // explicitly chose the high-risk mode, so auto-accept instead of
        // parking the turn on an approval card.
        const effectiveMode =
          request.toolPermissionMode ??
          this.conversationsRepo.getSummary(request.conversationId)?.toolPermissionMode ??
          DEFAULT_TOOL_PERMISSION_MODE;
        const autoApprovedList =
          effectiveMode === 'full-access'
            ? pendingApprovals
            : pendingApprovals.filter(
                (approval) =>
                  approval.sessionScopeKey &&
                  this.approvalController.hasConversationScopeGrant(request.conversationId, approval.sessionScopeKey),
              );
        for (const autoApproved of autoApprovedList) {
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

      logger.info('turn.completed', {
        requestId,
        modelId: request.modelId,
        ms: elapsed(),
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        reasoningTokens: result.reasoningTokens ?? null,
        parts: result.parts?.length ?? 0,
      });

      this.markConversationStatus(request.conversationId, 'completed', {
        completedAt: new Date().toISOString(),
        lastError: null,
      });

      this.sendCompletionEvents(active.window, requestId, result);
      this.cleanupRequest(requestId, active);

      // Settles AFTER cleanup: admission reads isBusy/approval state, and the
      // settling request itself must no longer count as busy or its own
      // continuation would be rejected as a queued steer every turn.
      this.notifyGoalSettled(request.conversationId, {
        aborted: false,
        failed: false,
        hadSubstantiveProgress: Boolean(active.goalProgress),
        tokensIn: result.inputTokens ?? 0,
        tokensOut: result.outputTokens ?? 0,
      });

      // Fire-and-forget: naming must never delay or fail the turn itself.
      void this.maybeGenerateTitle(active).catch(() => undefined);
    } catch (error) {
      const normalized = normalizeError(error);
      // `error` carries the raw provider text; the sanitiser in the logger
      // keeps it from dumping a payload into the file.
      logger.error('turn.failed', {
        requestId,
        modelId: request.modelId,
        ms: elapsed(),
        code: normalized.code,
        retryable: normalized.retryable,
        error,
      });
      this.rememberCapabilityRejection(active.request, error);
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
      if (active.persistTimer) {
        clearTimeout(active.persistTimer);
        active.persistTimer = null;
      }
      active.dirtyMessage = false;
      this.conversationsRepo.updateMessage({
        messageId: active.assistantMessageId,
        status: 'error',
        errorCode: normalized.code,
        // Interrupted-turn finalization, not the plain one: tool calls that
        // never finished are closed with a synthetic error here so neither
        // the UI nor any later reconstruction of this turn sees a call
        // stuck "in progress" forever.
        parts: finalizeInterruptedParts(active.parts),
      });
      this.runtimeStateRepo.completeTurn(active.turnId, this.runtimeStateRepo.getLastSequence(active.request.conversationId), 'aborted');
      this.runtimeStateRepo.updateProviderSession(requestId, { status: 'aborted' });
      // An aborted turn can still have written files before it stopped, so it
      // gets the same closing snapshot a completed one does.
      await this.checkpoints.captureTurnEnd(active.request.conversationId, active.turnId);
      // An abort is the user's own decision, not a failure of the task.
      this.markConversationStatus(
        active.request.conversationId,
        normalized.code === 'aborted' ? 'idle' : 'failed',
        {
          completedAt: new Date().toISOString(),
          lastError: normalized.code === 'aborted' ? null : normalized.message,
        },
      );
      this.sendEvent(active.window, {
        type: 'error',
        requestId,
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable
      });
      this.cleanupRequest(requestId, active);
      // Same post-cleanup ordering as the success path: the gate's busy and
      // approval reads must see the conversation after teardown.
      this.notifyGoalSettled(active.request.conversationId, {
        aborted: normalized.code === 'aborted',
        failed: normalized.code !== 'aborted',
        hadSubstantiveProgress: Boolean(active.goalProgress),
        tokensIn: 0,
        tokensOut: 0,
      });
    }
  }

  /**
   * Write down a capability the provider just refused.
   *
   * Guarded twice on purpose. The error text has to name the capability, *and*
   * the turn has to have actually exercised it — a model complaining about
   * images in a text-only turn is talking about something else (a tool result,
   * its own output), and recording that would take images away from a model
   * that supports them. Tools are guarded the same way, on whether this turn
   * was sent with any.
   */
  private rememberCapabilityRejection(request: ChatStartRequest, error: unknown) {
    if (!this.onCapabilityRejected) {
      return;
    }

    const capability = detectRejectedCapability(error);
    if (!capability) {
      return;
    }

    if (!this.turnExercised(request, capability)) {
      return;
    }

    logger.warn('capability.rejected', {
      requestId: request.conversationId,
      modelId: request.modelId,
      capability,
    });

    void Promise.resolve(this.onCapabilityRejected({ modelId: request.modelId, capability })).catch(
      () => undefined,
    );
  }

  /** Did this turn actually use the thing the provider says it cannot do? */
  private turnExercised(request: ChatStartRequest, capability: RejectedCapability) {
    if (capability === 'tools') {
      return request.enableTools === true;
    }

    const fileParts = (request.messages.at(-1)?.parts ?? []).filter(
      (part): part is Extract<ChatInputPart, { type: 'file' }> => part.type === 'file',
    );

    return fileParts.some((part) => {
      const kind = getAttachmentKind(normalizeAttachmentMediaType(part.mediaType, part.filename));
      return capability === 'image' ? kind === 'image' : kind === 'document';
    });
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
          cachedInputTokens: result.cachedInputTokens ?? null,
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
      // Not awaited: this method is synchronous and the turn is already over.
      // The coordinator serializes per conversation, so the next turn's
      // baseline still lands after this snapshot.
      void this.checkpoints.captureTurnEnd(active.request.conversationId, active.turnId);
    }

    this.sendEvent(window, {
      type: 'meta',
      requestId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      reasoningTokens: result.reasoningTokens,
      cachedInputTokens: result.cachedInputTokens,
      latencyMs: result.latencyMs
    });

    // Goal settle deliberately NOT here: it runs in runRequest after
    // cleanupRequest so the admission gate reads post-teardown state.
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

    if (target.onWindowClosed) {
      target.window.removeListener('closed', target.onWindowClosed);
    }
    this.flushBufferedEvents(requestId);
    if (target.persistTimer) {
      clearTimeout(target.persistTimer);
      target.persistTimer = null;
    }
    this.persistActiveMessage(target, true);
    this.bufferedEvents.delete(requestId);
    this.activeRequests.delete(requestId);
    target.resolvedApprovals?.clear();
    this.approvalController.clearRequest(requestId);
    this.runningRequestIds.delete(requestId);
    this.startNextQueuedRequest();
  }

  /**
   * Writes the envelope snapshot of one provider attempt as a `request.header`
   * event. Sizes are stored raw; content is reduced to two hashes — the system
   * prompt and the tail of the history — because comparing those across turns
   * is the whole point: equal hashes mean an unchanged prefix, which is what
   * provider prompt caches key on and what BYOK bills quietly depend on.
   */
  private recordRequestHeader(
    active: ActiveRequest,
    header: { attempt: number; systemPrompt: string | undefined; messages: ModelMessage[] },
  ) {
    const tail = header.messages.slice(-8);
    this.recordRuntimeEnvelope(active, {      eventId: randomUUID(),
      conversationId: active.request.conversationId,
      turnId: active.turnId,
      requestId: active.requestId,
      activityType: 'request.header',
      tone: 'info',
      provider: active.request.providerId,
      providerEventType: 'request.header',
      messageId: active.assistantMessageId,
      payload: {
        attempt: header.attempt,
        messageCount: header.messages.length,
        historyChars: header.messages.reduce((total, message) => total + messageContentChars(message), 0),
        systemChars: header.systemPrompt?.length ?? 0,
        systemHash: sha256Short(header.systemPrompt),
        historyTailHash: sha256Short(JSON.stringify(tail)),
      },
    });

    // Envelope snapshots are diagnostic with a short shelf life; without a
    // cap they are the one unbounded growth vector in the event log. Prune
    // opportunistically — every Nth write, cheap even when it runs.
    this.headerWrites += 1;
    if (this.headerWrites % 25 === 0 && 'pruneRequestHeaders' in this.runtimeStateRepo) {
      try {
        (this.runtimeStateRepo as RuntimeStateRepo).pruneRequestHeaders();
      } catch {
        // Retention is housekeeping, never correctness.
      }
    }
  }

  private handleRuntimeStreamEvent(active: ActiveRequest, event: StreamEvent) {
    active.tracker?.handleEvent(event);

    // Goal progress signal (C4): a completed side-effecting tool call is the
    // one thing that resets the stall streak (bash counts as a whole here;
    // read-only inspection still proves engagement rather than restating a plan).
    if (
      event.type === 'tool-output-available' &&
      !event.preliminary &&
      GOAL_PROGRESS_TOOLS.has(event.toolName)
    ) {
      active.goalProgress = true;
    }

    if (
      event.type === 'meta' ||
      event.type === 'done' ||
      event.type === 'error' ||
      event.type === 'runtime-sync' ||
      event.type === 'conversation-title'
    ) {
      return;
    }

    // Notices go straight to the window and are not recorded as activity: they
    // describe the attempt, not the conversation, and a transcript replayed
    // tomorrow should not still be announcing a retry that succeeded. Buffered
    // deltas are flushed first so the notice cannot arrive before the text it
    // follows.
    if (event.type === 'notice') {
      this.flushBufferedEvents(event.requestId);
      this.sendEvent(active.window, event);
      return;
    }

    if (event.type === 'chunk' || event.type === 'reasoning' || event.type === 'tool-input-delta') {
      this.queueBufferedEvent(event.requestId, event);
      return;
    }

    this.flushBufferedEvents(event.requestId);
    this.recordStreamEvent(active, event);
  }

  private recordStreamEvent(
    active: ActiveRequest,
    event: Exclude<StreamEvent, { type: 'runtime-sync' | 'done' | 'meta' | 'error' | 'notice' | 'conversation-title' }>
  ) {
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

    const key = getBufferedEventKey(event);
    const existing = buffered.events.get(key);
    buffered.events.set(key, mergeBufferedEvents(existing, event));

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
      void this.subagentRuntime.interruptAll(active.request.conversationId, 'Window closed');
      active.controller.abort();
      if (active.onWindowClosed) {
        if (active.onWindowClosed) {
          active.window.removeListener('closed', active.onWindowClosed);
        }
      }
      this.clearBufferedEvents(requestId);
      this.activeRequests.delete(requestId);
      return;
    }

    for (const event of buffered.events.values()) {
      try {
        this.recordStreamEvent(active, event);
      } catch {
        void this.subagentRuntime.interruptAll(active.request.conversationId, 'Window closed');
        active.controller.abort();
        if (active.onWindowClosed) {
        if (active.onWindowClosed) {
          active.window.removeListener('closed', active.onWindowClosed);
        }
      }
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
    event: Exclude<StreamEvent, { type: 'runtime-sync' | 'done' | 'meta' | 'error' | 'notice' | 'conversation-title' }>
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
      case 'plugin-invocation':
        // Recorded as a runtime envelope, not only rendered. This is the first
        // line of the audit trail the plugin work is building toward: which
        // plugin, which skill, which version, and whether it resolved — all
        // captured at the moment the turn was scoped, before any tool ran.
        return [{
          eventId: randomUUID(),
          ...base,
          activityType: 'turn.started' as const,
          tone: event.outcome === 'invoked' ? ('info' as const) : ('error' as const),
          providerEventType: event.type,
          payload: {
            kind: 'plugin-invocation',
            plugin: event.plugin,
            skill: event.skill,
            mention: event.mention,
            outcome: event.outcome,
            version: event.version,
            detail: event.detail,
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

  private persistActiveMessage(active: ActiveRequest, force = false): void {
    if (active.persistTimer) {
      clearTimeout(active.persistTimer);
      active.persistTimer = null;
    }

    const now = Date.now();
    const elapsed = typeof active.lastPersistAt === 'number' ? now - active.lastPersistAt : Infinity;

    if (!force && elapsed < STREAM_PERSIST_INTERVAL_MS) {
      if (active.dirtyMessage && !active.persistTimer) {
        const remaining = Math.max(0, STREAM_PERSIST_INTERVAL_MS - elapsed);
        active.persistTimer = setTimeout(() => {
          if (this.activeRequests.has(active.requestId)) {
            this.persistActiveMessage(active, true);
          }
        }, remaining);
      }
      return;
    }

    if (!active.dirtyMessage && !force) {
      return;
    }

    active.lastPersistAt = now;
    active.dirtyMessage = false;

    this.conversationsRepo.updateMessage({
      messageId: active.assistantMessageId,
      content: getTextContentFromParts(active.parts),
      reasoning: getReasoningContentFromParts(active.parts),
      parts: active.parts,
      providerId: active.request.providerId,
      modelId: active.request.modelId,
    });
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
    options?: { forcePersist?: boolean },
  ) {
    const envelope = this.runtimeStateRepo.recordEvent({
      ...input,
      messageId: input.messageId ?? active.assistantMessageId,
    });

    active.parts = applyRuntimeEventToMessageParts(active.parts, envelope);
    active.dirtyMessage = true;

    const isSettleEvent =
      input.activityType === 'message.completed' ||
      input.activityType === 'turn.completed' ||
      input.activityType === 'runtime.error' ||
      input.activityType === 'approval.requested' ||
      input.activityType === 'approval.resolved';

    this.persistActiveMessage(active, options?.forcePersist || isSettleEvent);

    this.sendToWindow(active.window, {
      type: 'runtime-sync',
      conversationId: active.request.conversationId,
      requestId: active.requestId ?? active.assistantMessageId,
      eventId: envelope.eventId,
      sequence: envelope.sequence,
    });
  }

  /**
   * True while a title is ours to change: either the untouched
   * `Session · <date>` placeholder, or an earlier automatic name. A title
   * the user typed is final and never overwritten.
   */
  private canAutoTitle(conversationId: string): boolean {
    const state = this.conversationsRepo.getTitleState(conversationId);
    if (!state) {
      return false;
    }

    return state.auto || isPlaceholderSessionTitle(state.title);
  }

  /**
   * Immediate, offline naming from the user's own words. Runs inside
   * `start()` so the sidebar row is named the moment the message is sent.
   */
  private applyLocalTitle(window: BrowserWindow, conversationId: string, userText: string) {
    try {
      if (!this.canAutoTitle(conversationId)) {
        return;
      }

      // Titles see quote text, never href bytes: a cite-first message would
      // otherwise name the session after `atlas-citation://` protocol noise.
      const title = deriveTitleFromUserMessage(assistantCitationsToPlainText(userText));
      if (!title) {
        return;
      }

      const renamed = this.conversationsRepo.rename(conversationId, title, { auto: true });
      this.sendToWindow(window, {
        type: 'conversation-title',
        conversationId,
        title: renamed.title,
      });
    } catch (error) {
      // Naming must never be able to break sending a message.
      console.warn('[titles] local naming failed; keeping the placeholder.', error);
    }
  }

  /**
   * Improve on the local name once the model has answered, using the full
   * exchange. Runs after the turn's `done` event and never blocks it.
   */
  private async maybeGenerateTitle(active: ActiveRequest) {
    const conversationId = active.request.conversationId;

    if (!this.canAutoTitle(conversationId)) {
      return;
    }

    const lastUserMessage = [...active.request.messages].reverse().find((message) => message.role === 'user');
    const userText = lastUserMessage?.content?.trim().slice(0, 600);
    if (!userText) {
      return;
    }
    const assistantText = getTextContentFromParts(active.parts).trim().slice(0, 600);

    // The local name is already on screen; the model only replaces it if it
    // produces something usable. A provider hiccup leaves the session named.
    let title: string | null = null;

    const adapter = this.providers.get(active.request.providerId);
    const apiKey = adapter ? await this.keychain.getSecret(active.request.providerId) : null;

    // A self-authenticating provider (OpenCode) has no stored key, and skipping
    // on that basis left every one of its chats named by the local heuristic.
    if (adapter && (apiKey || !requiresStoredCredential(adapter))) {
      try {
        const result = await adapter.streamChat({
          apiKey: apiKey ?? '',
          modelId: active.request.modelId,
          // Same catalog facts the turn itself uses. Without them the
          // request carries a default temperature, which reasoning models
          // reject with a hard 400 (see `resolveTemperature`).
          modelHints: this.modelsRepo.getRuntimeHints(active.request.modelId, active.request.providerId),
          // A title needs no deliberation, and on a reasoning model the
          // thinking tokens come out of the same budget as the answer —
          // leaving the reply empty if the model is allowed to ruminate.
          reasoningEffort: 'minimal',
          system:
            'Generate a short title for a chat session based on its opening exchange. ' +
            'Reply with the title only: 3-6 words, no quotes, no trailing punctuation, ' +
            'same language as the conversation.',
          messages: [
            {
              role: 'user',
              content: `User message:\n${userText}\n\nAssistant reply:\n${assistantText || '(none)'}`,
            },
          ],
          maxOutputTokens: 1_000,
          // No private deadline here: the provider stream has its own
          // first-response and idle watchdogs, and a tighter timer just
          // killed slow-but-healthy models before they answered.
          signal: AbortSignal.timeout(TITLE_GENERATION_TIMEOUT_MS),
          onChunk: () => {},
        });

        title = sanitizeGeneratedTitle(result.content) ?? title;
      } catch (error) {
        // Never fatal — but never silent either. Swallowing this is what
        // made the feature look like it simply did not run.
        console.warn(
          `[titles] model naming failed for ${active.request.modelId}; keeping the local title.`,
          error
        );
      }
    }

    if (!title) {
      return;
    }

    // Re-check: the user may have renamed while the model was working.
    if (!this.canAutoTitle(conversationId)) {
      return;
    }

    const renamed = this.conversationsRepo.rename(conversationId, title, { auto: true });
    this.sendToWindow(active.window, {
      type: 'conversation-title',
      conversationId,
      title: renamed.title,
    });
  }

  /**
   * Explicit user-triggered title regeneration. Re-reads the opening
   * exchange and calls the model to produce a fresh 3-6 word title,
   * falling back to the heuristic generator if offline or erroring.
   */
  async regenerateTitle(conversationId: string): Promise<ConversationSummary> {
    const detail = this.conversationsRepo.get(conversationId);
    if (!detail) {
      throw new Error(`Conversation ${conversationId} not found.`);
    }

    const messages = detail.messages ?? [];
    const firstUserMessage = messages.find((message) => message.role === 'user');
    const firstAssistantMessage = messages.find((message) => message.role === 'assistant');

    let title: string | null = null;
    // Plain text, never href bytes: the model names the session from words.
    const userText = firstUserMessage
      ? assistantCitationsToPlainText(firstUserMessage.content).trim().slice(0, 600)
      : undefined;
    const assistantText = firstAssistantMessage
      ? assistantCitationsToPlainText(getTextContentFromParts(firstAssistantMessage.parts))
          .trim()
          .slice(0, 600)
      : '';

    if (userText) {
      const fallback = this.resolveFallbackModel();
      const modelId = detail.conversation.defaultModelId || fallback?.modelId || 'gpt-4o-mini';
      const providerId = detail.conversation.defaultProviderId || fallback?.providerId || 'opencode';
      const adapter = this.providers.get(providerId);
      const apiKey = adapter ? await this.keychain.getSecret(providerId) : null;

      if (adapter && (apiKey || !requiresStoredCredential(adapter))) {
        try {
          const result = await adapter.streamChat({
            apiKey: apiKey ?? '',
            modelId,
            modelHints: this.modelsRepo.getRuntimeHints(modelId, providerId),
            reasoningEffort: 'minimal',
            system:
              'Generate a short title for a chat session based on its opening exchange. ' +
              'Reply with the title only: 3-6 words, no quotes, no trailing punctuation, ' +
              'same language as the conversation.',
            messages: [
              {
                role: 'user',
                content: `User message:\n${userText}\n\nAssistant reply:\n${assistantText || '(none)'}`,
              },
            ],
            maxOutputTokens: 1_000,
            signal: AbortSignal.timeout(TITLE_GENERATION_TIMEOUT_MS),
            onChunk: () => {},
          });

          title = sanitizeGeneratedTitle(result.content) ?? null;
        } catch (error) {
          console.warn(
            `[titles] model title regeneration failed for ${modelId}; falling back to heuristic.`,
            error
          );
        }
      }

      if (!title) {
        title = deriveTitleFromUserMessage(assistantCitationsToPlainText(userText));
      }
    }

    const finalTitle = title || detail.conversation.title || 'New conversation';

    const renamed = this.conversationsRepo.rename(conversationId, finalTitle, { auto: true });

    const mainWindow = this.resolveMainWindow();
    if (mainWindow) {
      this.sendToWindow(mainWindow, {
        type: 'conversation-title',
        conversationId,
        title: renamed.title,
      });
    }

    return renamed;
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
}

