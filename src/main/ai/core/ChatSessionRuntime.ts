import type { ModelMessage, ToolChoice, ToolSet } from 'ai';

import type { ToolPermissionMode } from '../../../shared/chatParameters';
import type {
  ChatInputMessage,
  ChatMessagePart,
  ChatStartRequest,
  ContextUsageSnapshot,
  GetContextUsageRequest,
  StreamEvent,
  StreamPluginInvocationEvent,
} from '../../../shared/contracts';
import type { MentionId } from '../../../shared/mentions';
import type { PluginMentionEntry, PluginMentionTarget } from '../../../shared/pluginMentions';
import { describePluginMention, parsePluginMentions } from '../../../shared/pluginMentions';
import { isMcpToolName } from '../../../shared/mcp';
import { pluginServerName } from '../../../shared/plugins';
import { resolveMcpToolProvenance } from '../mcp/mcpToolProvenance';
import type { AuditInput } from '../mcp/McpAuditLog';
import {
  applyStreamEventToParts,
  buildFallbackMessageParts,
  finalizeMessageParts,
  getReasoningContentFromParts,
  getTextContentFromParts,
} from '../../../shared/messageParts';
import { estimateImageTokens, estimateTextTokens } from '../../../shared/tokenEstimate';
import type { VisualMode } from '../../../shared/visualIntent';
import { DEFAULT_VISUAL_MODE, resolveVisualGate } from '../../../shared/visualIntent';
import { VisualStreamParser } from '../../../shared/visualParser';
import type { ConversationsRepo } from '../../db/repositories/conversationsRepo';
import type { ModelsRepo } from '../../db/repositories/modelsRepo';
import type { KeychainStore } from '../../secrets/keychain';
import { DEFAULT_TOOL_PERMISSION_MODE } from '../../../shared/chatParameters';
import {
  PLAN_TOOL_SYSTEM_PROMPT,
  TOOL_USE_SYSTEM_PROMPT,
  createBuiltInTools,
  describeAgentInstructionsForPrompt,
  describeToolPermissionsForPrompt,
  describeWorkspaceModeForPrompt
} from '../tools/builtInTools';
import { JOB_TOOL_SYSTEM_PROMPT, buildJobCompletionNoticeMessage } from '../tools/jobTools';
import { SESSION_SEARCH_SYSTEM_PROMPT } from '../tools/sessionSearchTools';
import { GOAL_TOOL_SYSTEM_PROMPT } from '../tools/goalTools';
import { buildGoalEnvelope } from '../goal/goalRuntime';
import { formatCompletionNotice, type BackgroundJobRegistry } from '../jobs/BackgroundJobRegistry';
import type { SkillsService } from '../../plugins/SkillsService';
import { createSkillTools } from '../../plugins/skillTools';
import type { ToolWorkspace } from '../tools/toolWorkspace';
import type { SubagentRuntime } from '../agents/SubagentRuntime';
import type { SubagentContinuationManager } from '../agents/SubagentContinuationManager';
import { DEFAULT_TOOL_WORKSPACE } from '../tools/toolWorkspace';
import { SITE_TOOL_SYSTEM_PROMPT } from '../tools/siteTools';
import { formatToolError } from '../tools/ToolErrorFormatter';
import type { SpillStore } from '../tools/spill/SpillStore';
import { applySpillPolicy } from '../tools/spill/spillPolicy';
import { applyTimeoutPolicy } from '../guards/timeoutPolicy';
import { logger, startTimer } from '../../observability/logger';
import { MissingCredentialError, computeRetryDelayMs, normalizeError, sleep } from './ErrorNormalizer';
import type { ProviderAdapter, ProviderStreamResult } from './ProviderAdapter';
import type { ProviderRegistry } from './providerRegistry';
import { getProviderOrThrow } from './providerRegistry';
import { requiresStoredCredential } from './ProviderAdapter';
import { DEFAULT_STREAM_CORE_CONFIG, resolveMaxOutputTokens } from '../providers/streamCore';
import { shouldPersistResponseMessages } from './persistResponseMessages';
import { VISUAL_PROMPT } from './VISUAL_PROMPT';
import type { ContextBuildMode } from './ContextManager';
import { ContextManager } from './ContextManager';
import {
  COMPACTION_THRESHOLD_DEFAULT,
  clampCompactionThresholdPercent,
  compactionPercentToRatio,
} from '../../../shared/contextCompaction';

/** What a turn's Sites gate is evaluated against. */
export type SiteToolContext = {
  conversationId: string;
  mentions: MentionId[];
};

/**
 * Supplies MCP tools to a turn.
 *
 * `loadTools` may connect and is awaited on the send path; `peekTools` answers
 * from cache for the synchronous context meter.
 */
/** Which turn an audit record belongs to, and whose plugin produced it. */
export type McpAuditContext = {
  requestId: string;
  conversationId: string;
  pluginFor?: (serverName: string) => { name: string; version: string | null } | null;
};

export type McpToolsProvider = {
  loadTools: (conversationId?: string, audit?: McpAuditContext) => Promise<ToolSet>;
  peekTools: () => ToolSet;
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
  subagentRuntime?: SubagentRuntime;
  continuationManager?: SubagentContinuationManager;
  persistMessage?: boolean;
  parentAgentId?: string;
  /** Nesting depth: root turn = 0, child agent = 1, grandchild = 2, … */
  depth?: number;
  allowedTools?: string[];
  /**
   * Called once per attempt with the exact request envelope about to go to
   * the provider. Observational only — the harness records it as a
   * `request.header` event so prefix stability across turns is checkable.
   */
  onRequestHeader?: (header: RequestHeader) => void;
};

/** Envelope snapshot for one provider attempt; see `onRequestHeader`. */
export type RequestHeader = {
  attempt: number;
  systemPrompt: string | undefined;
  messages: ModelMessage[];
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
  /** Provider-reported prompt-cache hit tokens; absent when unreported. */
  cachedInputTokens?: number;
  latencyMs?: number;
};

type TurnState = {
  parts: ChatMessagePart[];
  lastTextPartId: string;
  /**
   * Bumped every time a tool call starts, and mixed into the id of the text
   * and reasoning parts that follow.
   *
   * Providers are free to reuse one part id across the steps of a tool loop
   * (several of the OpenRouter free models do). Without this, the text a model
   * writes *after* a search appends to the part it wrote *before* the search,
   * so the transcript shows one run-on paragraph with every tool row stranded
   * below it — the model appears to have kept working after it answered. The
   * step number makes each stretch of prose its own part, in the order it was
   * actually produced.
   */
  stepIndex: number;
  /** Tool calls already counted, so one call cannot bump the step twice. */
  steppedToolCallIds: Set<string>;
  visualParser: VisualStreamParser;
  pendingApprovals: Map<string, PendingToolApproval>;
};

/**
 * Namespace a provider's text/reasoning part id by the step it belongs to.
 *
 * Step 0 keeps the raw id so nothing about single-step turns changes — including
 * the ids already written to the database.
 */
export function stepScopedPartId(partId: string, stepIndex: number) {
  return stepIndex === 0 ? partId : `${partId}#${stepIndex}`;
}

/**
 * The text of the message this turn is answering.
 *
 * Attachments are skipped on purpose: a pasted screenshot is context, not a
 * request to draw one.
 */
export function latestUserText(messages: ChatInputMessage[] | undefined): string {
  if (!messages?.length) {
    return '';
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') {
      continue;
    }

    const fromParts = (message.parts ?? [])
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter((text) => text.length > 0)
      .join('\n');

    return (fromParts || message.content || '').trim();
  }

  return '';
}

/** Open a new step the first time a given tool call is seen. */
function beginToolStep(turnState: Pick<TurnState, 'stepIndex' | 'steppedToolCallIds'>, toolCallId: string) {
  if (turnState.steppedToolCallIds.has(toolCallId)) {
    return;
  }

  turnState.steppedToolCallIds.add(toolCallId);
  turnState.stepIndex += 1;
}

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

/**
 * The next compaction step after a provider-confirmed context overflow, or
 * null once the ladder is exhausted. Each step keeps fewer turns raw and
 * leans harder on the summary; the newest turn survives every step, so the
 * reduction is always balanced — a tool call and its result are compressed
 * together or not at all.
 */
function nextCompactionMode(mode: ContextBuildMode): ContextBuildMode | null {
  switch (mode) {
    case 'standard':
      return 'aggressive';
    case 'aggressive':
      return 'maximal';
    case 'maximal':
      return null;
  }
}

function compactionNotice(mode: ContextBuildMode): string {
  if (mode === 'maximal') {
    return 'The conversation is still too long for this model. Keeping only the latest exchange raw and retrying.';
  }
  return 'The conversation was too long for this model. Summarising older turns and retrying.';
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
    private readonly contextManager: Pick<ContextManager, 'buildModelInput' | 'requestForcedCompaction'> = new ContextManager(),
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
    /**
     * The user's visual preference, read per turn so a change in Settings
     * applies to the next message rather than to the next restart.
     */
    private readonly visualModeResolver: () => VisualMode = () => DEFAULT_VISUAL_MODE,
    /**
     * Supplies tools from the user's MCP servers.
     *
     * Two entry points because the two callers differ: the send path can await
     * a connection, while the context meter is synchronous and settles for the
     * last known catalog. The meter being a token estimate makes that trade
     * safe — the worst case is a slightly low estimate on the first turn after
     * a server is added, never a different tool set than the one that runs.
     */
    private readonly mcpToolsProvider: McpToolsProvider | null = null,
    /**
     * Installed plugins' skills.
     *
     * Read synchronously on both the send path and the context meter, like the
     * workspace and the instructions: what the prompt lists and what the meter
     * counts must be the same set, or the ring drifts from the request.
     */
    private readonly skillsService: SkillsService | null = null,
    /**
     * Turns on a plugin's servers when one of its skills is opened.
     *
     * Only wired on the send path. The context meter builds the same tool set
     * to measure it, and measuring must not activate anything.
     */
    private readonly onSkillLoaded:
      | ((conversationId: string, pluginName: string, requiredServers: string[]) => boolean)
      | null = null,
    /**
     * Turns on the plugins a message named with `@`.
     *
     * Distinct from `onSkillLoaded` in the one way that matters: this runs
     * *before* the turn's tool set is resolved, because the mention is read off
     * text the user already sent. `load_skill` fires mid-stream and so can only
     * affect the next turn; an `@` mention affects this one.
     *
     * Like `onSkillLoaded`, absent on the context-measuring path — an estimate
     * must not change what the next turn is allowed to do.
     */
    private readonly onPluginMentioned:
      | ((conversationId: string, targets: PluginMentionTarget[]) => void)
      | null = null,
    /**
     * Where plugin activity is recorded.
     *
     * Observational throughout: nothing in this class reads back from it, so a
     * missing log changes what is *known* about a turn and never what the turn
     * does.
     */
    private readonly audit: { record: (input: AuditInput) => void } | null = null,
    /**
     * Where oversized tool results are persisted so the model's context sees a
     * bounded preview instead of the full text.
     *
     * Optional by design: the spill policy is best-effort everywhere, and its
     * absence is a no-op rather than an error — the same posture the policy
     * takes toward a save failure.
     */
    private readonly spillStore: Pick<SpillStore, 'saveText'> | null = null,
    /**
     * Live resolver for the global compaction threshold. Injected so an updated
     * preference takes effect on the next request without restart. Falls back
     * to the default when absent or throwing, which keeps the send path
     * failure-free even if the settings store is unavailable in a test.
     */
    private readonly compactionThresholdResolver: () => number = () => COMPACTION_THRESHOLD_DEFAULT,
  ) {}

  /**
   * The compaction depth each conversation last went out at, so a turn that
   * compresses *more* than the previous one can say so. Insertion-ordered
   * and capped at write time: a deleted conversation's entry is dead
   * weight, never a leak worth an eviction ceremony.
   */
  private readonly lastDroppedTurnsByConversation = new Map<string, number>();

  /** The server behind a namespaced tool name, for an audit record. */
  /**
   * The real installed server and plugin behind a wire tool name, for an
   * approval audit record.
   *
   * Exact, not guessed: matches the sanitised segment against every server
   * every installed plugin declares, rather than re-deriving a label from the
   * name's shape. Both fields come back `null` together when nothing matches
   * — a plugin uninstalled since the call, or a name truncated past the point
   * this can read — because a guessed attribution is worse than an absent one.
   */
  private describeAuditServer(toolName: string): {
    server: { name: string; transport: string; endpoint: string | null } | null;
    plugin: { name: string; version: string | null } | null;
  } {
    const plugins = this.skillsService?.snapshot().plugins ?? [];
    const found = resolveMcpToolProvenance(toolName, plugins);

    if (!found) {
      return { server: null, plugin: null };
    }

    const plugin = plugins.find((candidate) => candidate.manifest.name === found.pluginName);
    const server = plugin?.mcpServers.find((candidate) => candidate.key === found.serverKey);

    return {
      plugin: plugin ? { name: plugin.manifest.name, version: plugin.manifest.version } : null,
      server: server
        ? {
            name: pluginServerName(found.pluginName, server.key),
            transport: server.transport,
            endpoint: server.transport === 'stdio' ? null : server.url
          }
        : null
    };
  }

  /**
   * The plugins and skills a message named explicitly.
   *
   * Resolved against the registry rather than by shape: `@github pr-review` and
   * `@github fix this` are syntactically identical, and only the installed set
   * says which second word is a skill.
   */
  private resolvePluginMentions(text: string): PluginMentionTarget[] {
    const snapshot = this.skillsService?.snapshot();

    if (!snapshot || !text) {
      return [];
    }

    // Disabled and revoked bundles are deliberately included. A mention of one
    // must produce "that plugin is switched off", not silence — silence is
    // indistinguishable from a typo, and the user is left retyping a name that
    // was right all along.
    const catalog: PluginMentionEntry[] = [
      ...snapshot.plugins.map((plugin) => ({
        name: plugin.manifest.name,
        description: plugin.manifest.description,
        skills: plugin.skills.map((skill) => skill.name),
        available: true
      })),
      ...snapshot.disabled.map((plugin) => ({
        name: plugin.manifest.name,
        description: plugin.manifest.description,
        skills: plugin.skills.map((skill) => skill.name),
        available: false,
        unavailableReason: 'This plugin is switched off. Enable it in Plugins to use it.'
      })),
      ...snapshot.blocked.map((entry) => ({
        name: entry.plugin.manifest.name,
        description: entry.plugin.manifest.description,
        skills: entry.plugin.skills.map((skill) => skill.name),
        available: false,
        unavailableReason: entry.reason
      }))
    ];

    return parsePluginMentions(text, catalog);
  }

  /**
   * What an explicitly named plugin contributes to the prompt.
   *
   * Two jobs. It tells the model which plugin the user scoped the turn to, so
   * a turn that named one does not wander off into unrelated tools. And when a
   * skill was named, its body is inlined rather than left for `load_skill` —
   * the user already chose it, so spending a tool round trip re-deciding would
   * be asking the model to second-guess an explicit instruction.
   *
   * Inlining is also the only route to a skill whose sidecar sets
   * `allow_implicit_invocation: false`: those are withheld from the index
   * precisely so the model cannot pick them, and naming one is the whole point
   * of the syntax.
   */
  private describePluginMentionsForPrompt(targets: PluginMentionTarget[], projectRoot?: string | null): string | null {
    if (targets.length === 0 || !this.skillsService) {
      return null;
    }

    const lines: string[] = [];

    for (const target of targets) {
      const unavailable = this.describeUnavailablePlugin(target.plugin);

      if (unavailable) {
        // Said out loud rather than dropped. The model needs to be able to tell
        // the user why the thing they asked for did not happen.
        lines.push(`- ${describePluginMention(target)} — unavailable. ${unavailable}`);
        continue;
      }

      if (!target.skill) {
        lines.push(`- ${describePluginMention(target)} — the user scoped this turn to this plugin.`);
        continue;
      }

      const skill = this.skillsService.find(
        target.skill ? `${target.plugin}:${target.skill}` : target.plugin,
        projectRoot
      );

      lines.push(
        skill
          ? `- ${describePluginMention(target)} — the user asked for this skill. Its instructions follow.`
          : `- ${describePluginMention(target)} — no skill by that name; use the plugin's other capabilities.`
      );

      if (skill) {
        lines.push(this.skillsService.read(skill.qualifiedName, projectRoot));
      }
    }

    return [
      '<invoked_plugins>',
      'The user named these plugins directly. Prefer them over other tools for this turn.',
      ...lines,
      '</invoked_plugins>'
    ].join('\n');
  }

  /**
   * One resolved mention, as the transcript and the audit record will see it.
   *
   * Descriptive only. Nothing here activates a server or widens a tool set —
   * `onPluginMentioned` does the activating, separately, and an MCP call this
   * describes still stops at the same per-call approval as any other
   * third-party tool. The event exists so attribution has one source of truth
   * rather than each surface re-deriving it from the message text.
   */
  private describeInvocation(
    target: PluginMentionTarget
  ): Pick<StreamPluginInvocationEvent, 'plugin' | 'skill' | 'mention' | 'outcome' | 'version' | 'detail'> {
    const snapshot = this.skillsService?.snapshot();
    const mention = describePluginMention(target);
    const base = { plugin: target.plugin, skill: target.skill, mention };

    const installed = [
      ...(snapshot?.plugins ?? []),
      ...(snapshot?.disabled ?? []),
      ...(snapshot?.blocked ?? []).map((entry) => entry.plugin)
    ].find((plugin) => plugin.manifest.name === target.plugin);

    // Captured at resolution rather than looked up later: a plugin can be
    // updated between this turn and anyone reading it back, and a record that
    // reported the version as of *reading* would answer a different question.
    const version = installed?.manifest.version ?? null;

    const blocked = snapshot?.blocked.find((entry) => entry.plugin.manifest.name === target.plugin);

    if (blocked) {
      return { ...base, outcome: 'plugin-blocked', version, detail: blocked.reason };
    }

    if (snapshot?.disabled.some((plugin) => plugin.manifest.name === target.plugin)) {
      return {
        ...base,
        outcome: 'plugin-disabled',
        version,
        detail: 'Switched off. Enable it in Plugins.'
      };
    }

    if (!snapshot?.plugins.some((plugin) => plugin.manifest.name === target.plugin)) {
      return { ...base, outcome: 'plugin-not-installed', version, detail: 'Not installed.' };
    }

    if (target.skill && !this.skillsService?.find(`${target.plugin}:${target.skill}`)) {
      // The plugin is fine; the skill is not. Reporting this as a plugin
      // failure would send the user to the wrong place to fix it.
      return {
        ...base,
        outcome: 'skill-not-found',
        version,
        detail: `No skill named "${target.skill}".`
      };
    }

    return { ...base, outcome: 'invoked', version, detail: null };
  }

  /** Why a named plugin cannot be used, or `null` when it can. */
  private describeUnavailablePlugin(name: string): string | null {
    const snapshot = this.skillsService?.snapshot();

    if (!snapshot) {
      return null;
    }

    if (snapshot.plugins.some((plugin) => plugin.manifest.name === name)) {
      return null;
    }

    const blocked = snapshot.blocked.find((entry) => entry.plugin.manifest.name === name);

    if (blocked) {
      return blocked.reason;
    }

    return snapshot.disabled.some((plugin) => plugin.manifest.name === name)
      ? 'It is switched off. Enable it in Plugins to use it.'
      : 'It is not installed.';
  }

  /**
   * Whether this turn may produce a visual.
   *
   * Gated on the user's own words: the ~2k-token visual spec used to ship with
   * every request, which both paid for itself on turns nobody wanted a diagram
   * for and pushed the model into drawing one anyway. The same answer decides
   * whether the stream parser looks for visual markup, so a turn that was never
   * told how to emit a visual cannot have one parsed out of it either.
   */
  private resolveVisualsEnabled(conversationId: string, userText: string): boolean {
    const mode = (() => {
      try {
        return this.visualModeResolver();
      } catch {
        return DEFAULT_VISUAL_MODE;
      }
    })();

    if (mode !== 'auto') {
      return resolveVisualGate({ mode, userText }).enabled;
    }

    // Only consulted for `auto`, and only to keep "make it wider" attached to
    // the diagram it is about.
    const hadRecentVisual = (() => {
      try {
        return this.conversationsRepo.hasRecentVisual?.(conversationId) ?? false;
      } catch {
        return false;
      }
    })();

    return resolveVisualGate({ mode, userText, hadRecentVisual }).enabled;
  }

  private resolveWorkspace(conversationId: string): ToolWorkspace {
    try {
      return this.workspaceResolver(conversationId);
    } catch {
      // A missing or unreadable project must not take the turn down with it:
      // fall back to the mode that grants the least.
      return DEFAULT_TOOL_WORKSPACE;
    }
  }

  private drainSubagentNotices(
    manager: SubagentContinuationManager,
    conversationId: string,
    requestId: string,
    emitEvent: (event: StreamEvent) => void
  ): ModelMessage[] {
    let notices: ReturnType<SubagentContinuationManager['drainCompletionNotices']>;
    try {
      notices = manager.drainCompletionNotices(conversationId);
    } catch {
      return [];
    }
    if (notices.length === 0) return [];
    emitEvent({
      type: 'notice',
      requestId,
      code: 'subagents-failed',
      level: 'warning',
      message: notices.length === 1 ? `Subagent ${notices[0].childId.slice(0, 8)} failed.` : `${notices.length} subagents failed.`,
    });
    const text = notices.map((n) => `Subagent ${n.childId.slice(0, 8)} (${n.title}) failed: ${n.error}`).join('\n');
    return [{ role: 'user', content: text } as ModelMessage];
  }

  /**
   * Claim every unreported settled background job for the conversation and
   * shape them for the model. The drain is the claim — whatever happens to
   * the turn afterwards, these notices are not re-delivered.
   */
  private drainJobCompletionNotices(
    registry: BackgroundJobRegistry,
    conversationId: string,
    requestId: string,
    emitEvent: (event: StreamEvent) => void
  ): ModelMessage[] {
    let drained: ReturnType<BackgroundJobRegistry['drainCompletionNotices']>;
    try {
      drained = registry.drainCompletionNotices(conversationId);
    } catch {
      // A drain failure must not take the turn down: the notices stay
      // unreported and the next turn tries again.
      return [];
    }

    if (drained.length === 0) {
      return [];
    }

    // The transient user-facing half, same channel as the repeat-guard nudge.
    emitEvent({
      type: 'notice',
      requestId,
      code: 'background-jobs-completed',
      level: 'info',
      message:
        drained.length === 1
          ? `Background job ${drained[0].id} finished.`
          : `${drained.length} background jobs finished.`
    });

    return [buildJobCompletionNoticeMessage(drained)];
  }

  async executeTurn({
    requestId,
    request,
    signal,
    emitEvent,
    assistantMessageId,
    messagesOverride,
    initialParts,
    subagentRuntime,
    continuationManager,
    persistMessage = true,
    parentAgentId,
    depth,
    allowedTools,
    onRequestHeader,
  }: ExecuteTurnRequest): Promise<ExecuteTurnResult> {
    const provider = getProviderOrThrow(this.providers, request.providerId);
    const apiKey = await this.keychain.getSecret(request.providerId);

    // OpenCode signs itself in, so there is no Atlas key to find and demanding
    // one failed every one of its turns.
    if (!apiKey && requiresStoredCredential(provider)) {
      throw new MissingCredentialError('No API key is saved for the selected provider.');
    }

    const result = await this.executeWithRetry({
      requestId,
      request,
      provider,
      apiKey: apiKey ?? '',
      signal,
      emitEvent,
      messagesOverride,
      initialParts,
      assistantMessageId,
      subagentRuntime,
      continuationManager,
      parentAgentId,
      depth,
      allowedTools,
      onRequestHeader,
    });

    const status: ExecuteTurnResult['status'] = result.pendingApprovals.length > 0 ? 'awaiting_approval' : 'completed';
    const persistedResponseMessages =
      status === 'completed' && shouldPersistResponseMessages(result.responseMessages, request.enableTools)
        ? result.responseMessages ?? null
        : null;

    const content = getTextContentFromParts(result.parts) || result.content;
    const reasoning = getReasoningContentFromParts(result.parts) ?? result.reasoning ?? null;

    const messageId =
      assistantMessageId ??
      (persistMessage
        ? this.conversationsRepo.addMessage({
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
            cachedInputTokens: result.cachedInputTokens ?? null,
            latencyMs: result.latencyMs ?? null,
          })
        : requestId);

    if (persistMessage && assistantMessageId) {
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
        cachedInputTokens: result.cachedInputTokens ?? null,
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
      cachedInputTokens: result.cachedInputTokens,
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
  requestForcedCompaction(conversationId: string): void {
    this.contextManager.requestForcedCompaction(conversationId);
  }

  private getCompactionThresholdPercent(): number {
    try {
      const raw = this.compactionThresholdResolver();
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return COMPACTION_THRESHOLD_DEFAULT;
      return clampCompactionThresholdPercent(raw);
    } catch {
      return COMPACTION_THRESHOLD_DEFAULT;
    }
  }

  private getCompactionRatio(): number {
    return compactionPercentToRatio(this.getCompactionThresholdPercent());
  }

  measureContextUsage(request: GetContextUsageRequest): ContextUsageSnapshot {
    const modelHints = this.modelsRepo.getRuntimeHints(request.modelId, request.providerId ?? null);
    const maxTokens = positiveOrNull(modelHints.contextWindow);

    const toolPermissionMode =
      request.toolPermissionMode ??
      this.conversationsRepo.getToolPermissionMode(request.conversationId) ??
      DEFAULT_TOOL_PERMISSION_MODE;
    const workspace = this.resolveWorkspace(request.conversationId);
    const siteTools = this.resolveSiteTools(request);
    const tools = request.enableTools
      ? {
          ...createBuiltInTools(this.modelsRepo, siteTools, toolPermissionMode, workspace, undefined, undefined, this.conversationsRepo),
          ...(this.skillsService ? createSkillTools(this.skillsService, undefined, workspace.root) : {}),
          // Deliberately no activation hook here — see the constructor.
          // Last known catalog: this path cannot await a connection, and an
          // estimate is what it exists to produce.
          ...(this.mcpToolsProvider?.peekTools() ?? {}),
        }
      : undefined;
    const toolTokens = tools ? estimateToolDefinitionTokens(tools) : 0;

    // The system prompt is measured without the summary addendum first: the
    // addendum's size depends on how much history gets compressed, which is
    // what the budget below decides.
    // Measured against the unsent composer text, which is what the gate will
    // see when the message is actually sent: the ring must not drop 2k tokens
    // the moment the user types the word "diagram".
    const visualsEnabled = this.resolveVisualsEnabled(
      request.conversationId,
      request.pendingText ?? ''
    );
    const baseSystemPrompt = this.buildSystemPrompt(
      request.enableTools,
      siteTools != null,
      toolPermissionMode,
      workspace,
      visualsEnabled
    );
    const systemTokens = estimateTextTokens(baseSystemPrompt);
    // Mentioned skill bodies no longer ride in the system prompt; they are
    // counted where they now travel — the pending turn's history snapshot.
    // Resolution only, and deliberately not wired to `onPluginMentioned` on
    // this path: measuring cannot activate a server.
    const pendingMentionTokens = estimateTextTokens(
      this.describePluginMentionsForPrompt(this.resolvePluginMentions(request.pendingText ?? ''), workspace.root) ?? ''
    );
    const pendingTokens = estimatePendingTokens(request) + (pendingMentionTokens > 0 ? pendingMentionTokens : 0);

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
    const cache = this.conversationsRepo.getCacheUsage?.(request.conversationId) ?? null;
    const summaryTokens = modelInput.usage.addendumTokens;
    const historyTokens = modelInput.usage.historyTokens;
    const promptTokens = systemTokens + toolTokens + summaryTokens + historyTokens + pendingTokens;
    const compactionThresholdPercent = this.getCompactionThresholdPercent();
    const compactionRatio = compactionPercentToRatio(compactionThresholdPercent);
    const compactionThresholdTokens =
      budget != null && maxTokens != null
        ? Math.max(0, Math.floor((budget.totalTokens - budget.reservedTokens) * compactionRatio))
        : null;

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
      compactionThresholdTokens,
      compactionThresholdPercent,
      lastTurn,
      cache,
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
    const compactionRatio = this.getCompactionRatio();

    return {
      reservedOutputTokens,
      budget:
        contextWindow == null
          ? undefined
          : {
              totalTokens: Math.max(1, contextWindow - reservedOutputTokens),
              reservedTokens: fixedFloorTokens,
              compactionRatio,
            },
    };
  }

  private buildSystemPrompt(
    enableTools: boolean | undefined,
    siteToolsActive: boolean,
    toolPermissionMode: ToolPermissionMode = DEFAULT_TOOL_PERMISSION_MODE,
    workspace: ToolWorkspace = DEFAULT_TOOL_WORKSPACE,
    visualsEnabled = false
  ) {
    // The Sites instructions only ship when the Sites tools do, so a turn that
    // did not opt in is not nudged toward building one.
    const basePrompt = siteToolsActive
      ? `${TOOL_USE_SYSTEM_PROMPT}\n\n${SITE_TOOL_SYSTEM_PROMPT}`
      : TOOL_USE_SYSTEM_PROMPT;
    // The project's own instructions go last, after the statements Atlas
    // enforces: what the model may do is settled before anything a file on disk
    // gets to say, and the block is bracketed so its edges are unambiguous.
    const agentInstructionsPrompt = workspace.instructions
      ? describeAgentInstructionsForPrompt(workspace.instructions)
      : null;
    // Tell the model what it may actually do, so it does not plan around a tool
    // that was withheld from its tool set.
    // Listed only when the tools are, because `load_skill` is the only way to
    // act on the list and it ships with the rest of the tool set.
    const skillsPrompt =
      this.skillsService?.describeForPrompt({
        mode: workspace.mode,
        hasProject: workspace.root != null,
        projectRoot: workspace.root
      }) ?? null;
    const toolPrompt = [
      basePrompt,
      PLAN_TOOL_SYSTEM_PROMPT,
      // Shipped exactly when the job tools are registered: etiquette for a
      // tool the model cannot call is noise, and omitting it where the tools
      // exist would leave the model busy-polling.
      ...(workspace.jobRegistry && workspace.conversationId ? [JOB_TOOL_SYSTEM_PROMPT] : []),
      // Goal mode: static etiquette ships with the update_goal tool (same
      // conditional); the dynamic envelope rides beside it. Both are gated on
      // status 'active', not merely "a row exists" — paused and terminal rows
      // persist as history, and their etiquette would keep telling a finished
      // goal it is still live. The envelope changes per continued turn, which
      // re-keys the prompt cache only while a goal is active — a bounded cost
      // the plan accepted explicitly.
      ...(workspace.goalTools && workspace.conversationId
        ? (() => {
            const goal = workspace.goalTools.getActive(workspace.conversationId);
            return goal && goal.status === 'active'
              ? [GOAL_TOOL_SYSTEM_PROMPT, buildGoalEnvelope(goal)]
              : [];
          })()
        : []),
      // session_search rides the always-present conversationsRepo, so its
      // etiquette ships unconditionally, like update_plan's.
      SESSION_SEARCH_SYSTEM_PROMPT,
      describeWorkspaceModeForPrompt(workspace.mode, workspace),
      describeToolPermissionsForPrompt(toolPermissionMode),
      ...(skillsPrompt ? [skillsPrompt] : []),
      ...(agentInstructionsPrompt ? [agentInstructionsPrompt] : [])
    ].join('\n\n');
    // Invoked-plugin context is deliberately NOT here. A `@mention` inlines
    // the named skill's full body, which differs per turn — at position 0 of
    // the request that would re-key the provider's prefix cache on every
    // mentioned turn (the whole conversation re-reads). It rides as a derived
    // user-role snapshot inside the turn's history instead — see
    // `deriveTurnSnapshot` and `ContextManager.buildModelInput` — the same
    // cache-safe shape dsh uses for dynamic context: appended after durable
    // content, byte-stable once written.
    // The visual spec goes last of the Atlas-owned blocks and only when this
    // turn asked for a visual, so an ordinary question is not carrying two
    // thousand tokens of SVG instructions it will never use.
    //
    // No compaction summary here on purpose: the handoff rides in the history
    // (see `ContextManager`), because a per-turn-volatile block at the head of
    // the request would re-key the provider's prompt cache on every turn.
    const sections = [
      ...(enableTools ? [toolPrompt] : []),
      ...(visualsEnabled ? [VISUAL_PROMPT] : []),
    ];

    return sections.join('\n\n');
  }

  /**
   * Model-facing context for one historical turn's `@mentions`, derived from
   * that turn's own persisted user text.
   *
   * Deterministic given (user text, skill registry): the same bytes rebuild
   * after a restart, so the snapshot needs no persistence of its own and lands
   * in the wire request right after its turn's user message — chronologically
   * where dsh records a pre-step injection. Returns null for mention-free
   * turns, which contribute nothing and shift nothing.
   */
  private deriveTurnSnapshot(userText: string, projectRoot?: string | null): string | null {
    return this.describePluginMentionsForPrompt(this.resolvePluginMentions(userText), projectRoot);
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
    assistantMessageId,
    subagentRuntime,
    continuationManager,
    parentAgentId,
    depth,
    allowedTools,
    onRequestHeader,
  }: {
    requestId: string;
    request: ChatStartRequest;
    provider: ProviderAdapter;
    apiKey: string;
    signal: AbortSignal;
    emitEvent: (event: StreamEvent) => void;
    messagesOverride?: ModelMessage[];
    initialParts?: ChatMessagePart[];
    /** Present on a resumed turn; absent on a first send, where no row exists yet. */
    assistantMessageId?: string;
    subagentRuntime?: SubagentRuntime;
    continuationManager?: SubagentContinuationManager;
    parentAgentId?: string;
    /** Nesting depth of the current turn (0 = root, 1 = first child agent, …). */
    depth?: number;
    allowedTools?: string[];
    onRequestHeader?: (header: RequestHeader) => void;
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
    // Same reasoning: the gate is evaluated once so a retry cannot answer the
    // same message with a different set of instructions.
    const visualsEnabled = this.resolveVisualsEnabled(
      request.conversationId,
      latestUserText(request.messages)
    );
    // Read before the tool set is resolved, which is the whole reason `@github`
    // works on the turn that types it: the mention is already in the user's
    // text, so the servers it implies can be activated while there is still
    // time for `loadTools` below to see them. `load_skill` cannot do this — it
    // fires mid-stream, after the tool set is fixed.
    const pluginMentions = this.resolvePluginMentions(latestUserText(request.messages));

    if (pluginMentions.length > 0) {
      this.onPluginMentioned?.(request.conversationId, pluginMentions);

      // Announced before the stream opens, so the row states what the turn was
      // scoped to rather than reporting it afterwards. Emitted for failures
      // too: a mention that resolved to nothing is the case most worth telling
      // the user about.
      for (const target of pluginMentions) {
        const invocation = this.describeInvocation(target);

        emitEvent({
          type: 'plugin-invocation',
          requestId,
          messageId: assistantMessageId ?? null,
          ...invocation
        });

        // The durable half of the same fact the transcript row shows. Recorded
        // even when the outcome is not `invoked` — a mention that resolved to
        // nothing is exactly the kind of thing an audit trail should be able
        // to answer for later, same as it is exactly what the user needed told
        // about at the time.
        this.audit?.record({
          requestId,
          conversationId: request.conversationId,
          type: 'plugin_invocation',
          server: null,
          plugin: invocation.plugin ? { name: invocation.plugin, version: invocation.version } : null,
          tool: null,
          outcome: invocation.outcome === 'invoked' ? 'ok' : 'error',
          approvalId: null,
          toolCallId: null,
          detail: invocation.detail,
          payload: { mention: invocation.mention, skill: invocation.skill, outcome: invocation.outcome },
          // One row per (turn, plugin, skill): a resumed turn re-announcing the
          // same mention has nothing new to say about it.
          idempotencyKey: `pi:${requestId}:${target.plugin}:${target.skill ?? ''}`
        });
      }
    }

    // Resolved once per turn alongside the rest: a server coming up mid-stream
    // must not change what this turn was offered. A provider that throws is
    // treated as contributing nothing rather than failing the send.
    const mcpTools = request.enableTools
      ? await (
          this.mcpToolsProvider?.loadTools(request.conversationId, {
            requestId,
            conversationId: request.conversationId,
            // Exact, by the configured server name: `pluginServerName` joins
            // `<plugin>/<key>` with a separator the plugin name cannot itself
            // contain, so splitting on the first `/` cannot be ambiguous the
            // way parsing a *wire* tool name is.
            pluginFor: (serverName) => {
              const [pluginName] = serverName.split('/');
              const plugin = this.skillsService
                ?.snapshot()
                .plugins.find((candidate) => candidate.manifest.name === pluginName);

              return plugin ? { name: plugin.manifest.name, version: plugin.manifest.version } : null;
            }
          }) ?? Promise.resolve({})
        ).catch(() => ({}))
      : {};
    const subagentContext = subagentRuntime
      ? {
          conversationId: request.conversationId,
          turnId: assistantMessageId ?? requestId,
          parentSignal: signal,
          ...(parentAgentId ? { parentAgentId } : {}),
          depth,
        }
      : undefined;

    let tools = request.enableTools
      ? {
          ...createBuiltInTools(
            this.modelsRepo,
            siteTools,
            toolPermissionMode,
            workspace,
            subagentRuntime,
            subagentContext,
            this.conversationsRepo,
            continuationManager,
            subagentContext ? { conversationId: subagentContext.conversationId } : undefined
          ),
          ...(this.skillsService
            ? createSkillTools(
                this.skillsService,
                (pluginName, requiredServers) =>
                  this.onSkillLoaded?.(request.conversationId, pluginName, requiredServers) ?? false,
                workspace.root
              )
            : {}),
          ...mcpTools,
        }
      : undefined;

    if (tools && allowedTools !== undefined) {
      const allowedSet = new Set(allowedTools);
      const filtered: Record<string, unknown> = {};
      for (const [name, toolDef] of Object.entries(tools)) {
        if (allowedSet.has(name)) {
          filtered[name] = toolDef;
        }
      }
      tools = filtered as any;
    }
    // Oversized results are persisted to the spill store and replaced with a
    // bounded preview + locator, so one runaway grep or build log cannot eat
    // the context budget. Applied after the allowedTools filter so wrapping
    // never resurrects a withheld tool; a missing store is a no-op.
    if (tools) {
      const withSpill = applySpillPolicy(
        tools,
        this.spillStore
          ? { conversationId: request.conversationId, store: this.spillStore }
          : null
      );
      // Cooperative per-tool deadlines: a tool that declares `timeoutMs` gets
      // its abort signal fused with a timer, and a fired deadline replaces
      // the result with a structured TOOL_TIMEOUT. Applied outermost so the
      // deadline covers the spill wrapper too.
      tools = applyTimeoutPolicy(withSpill) as any;
    }
    if (tools) {
      // Canonical wire order (dsh invariant): code-unit sort by name, so the
      // serialized schema block is byte-identical across steps and turns no
      // matter how the contributing registries were assembled. MCP tools
      // arrive in server response order, which is exactly the kind of hidden
      // nondeterminism that silently re-keys a provider's prefix cache.
      tools = Object.fromEntries(
        Object.entries(tools).sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0
        )
      ) as any;
    }
    // Catalog-derived limits so the adapter can size the request to this model
    // rather than to a provider-wide constant. Provider-qualified so a model
    // served by two endpoints gets the right window for the chosen one.
    const modelHints = this.modelsRepo.getRuntimeHints(request.modelId, request.providerId);

    while (true) {
      const attemptElapsed = startTimer();
      const turnState: TurnState = {
        parts: [...(initialParts ?? [])],
        lastTextPartId: 'assistant-text',
        stepIndex: 0,
        steppedToolCallIds: new Set<string>(),
        visualParser: new VisualStreamParser({ enabled: visualsEnabled }),
        pendingApprovals: new Map<string, PendingToolApproval>(),
      };
      // Same budget the ring displays, so what is shown is what is sent.
      //
      // Background jobs that settled since the conversation's last turn are
      // drained here — exactly once; the registry marks them reported — and
      // ride into this request as a synthetic user message. Appended to the
      // request copy only, never persisted: the transcript already records
      // what the jobs did, and the notice exists to make the model collect
      // them with job_output.
      const jobNotices = workspace.jobRegistry
        ? this.drainJobCompletionNotices(
            workspace.jobRegistry,
            request.conversationId,
            requestId,
            emitEvent
          )
        : [];
      const subagentNotices = continuationManager
        ? this.drainSubagentNotices(continuationManager, request.conversationId, requestId, emitEvent)
        : [];
      const combinedNotices = [...jobNotices, ...subagentNotices];
      const baseHistory = messagesOverride ?? this.selectModelHistory(request.conversationId);
      const history = combinedNotices.length > 0 ? [...baseHistory, ...combinedNotices] : baseHistory;
      const modelInput = this.contextManager.buildModelInput({
        conversationId: request.conversationId,
        history,
        mode: compactionMode,
        // Per-turn `@mention` context rides as a derived history snapshot, not
        // in the system prompt — see `deriveTurnSnapshot`.
        turnSnapshot: (userText) => this.deriveTurnSnapshot(userText, workspace.root),
        budget: this.resolveContextBudget({
          modelHints,
          requestedMaxOutputTokens: request.maxOutputTokens,
          fixedFloorTokens:
            estimateTextTokens(
              this.buildSystemPrompt(
                request.enableTools,
                siteTools != null,
                toolPermissionMode,
                workspace,
                visualsEnabled
              )
            ) + (tools ? estimateToolDefinitionTokens(tools) : 0),
        }).budget,
      });

      // First attempt only — a retry re-derives the same split, and the
      // notice must not re-announce it. Compaction is invisible by default:
      // the summary replaces turns the user can no longer watch, so the one
      // moment it happens is the one moment worth saying so (dsh puts a
      // durable marker in the transcript; this notice is the live half of
      // that, and the hover card on the context ring is the standing half).
      if (attempt === 0) {
        const previousDropped = this.lastDroppedTurnsByConversation.get(request.conversationId) ?? 0;
        const dropped = modelInput.usage.droppedTurnCount;
        this.lastDroppedTurnsByConversation.delete(request.conversationId);
        this.lastDroppedTurnsByConversation.set(request.conversationId, dropped);
        while (this.lastDroppedTurnsByConversation.size > 500) {
          const oldest = this.lastDroppedTurnsByConversation.keys().next().value;
          if (oldest === undefined) break;
          this.lastDroppedTurnsByConversation.delete(oldest);
        }
        if (dropped > previousDropped) {
          emitEvent({
            type: 'notice',
            requestId,
            code: 'compacting',
            level: 'info',
            message: `Compressed ${dropped} older ${dropped === 1 ? 'turn' : 'turns'} to keep the conversation inside the model's window.`,
          });
        }
      }

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
        const systemPrompt =
          this.buildSystemPrompt(
            request.enableTools,
            siteTools != null,
            toolPermissionMode,
            workspace,
            visualsEnabled,
          ) || undefined;
        onRequestHeader?.({
          attempt,
          systemPrompt,
          messages: modelInput.recentMessages,
        });

        const result = await provider.streamChat({
          apiKey,
          modelId: request.modelId,
          messages: modelInput.recentMessages,
          system: systemPrompt,
          tools,
          toolChoice: inferToolChoice(request),
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          modelHints,
          reasoningEffort: request.reasoningEffort,
          toolPermissionMode,
          // Only session-based agent providers read this (see ProviderAdapter).
          agentContext: {
            conversationId: request.conversationId,
            workspaceRoot: workspace.worktreeRoot ?? workspace.root,
            toolPermissionMode,
          },
          signal,
          onChunk: (event) => {
            streamedAnyResponse = true;
            turnState.lastTextPartId = stepScopedPartId(event.id, turnState.stepIndex);
            this.applyParsedChunks(turnState, turnState.visualParser.feed(event.delta, requestId), requestId, emitEvent);
          },
          onReasoningChunk: (event) => {
            streamedAnyResponse = true;
            this.applyEvent(
              turnState,
              {
                type: 'reasoning',
                requestId,
                id: stepScopedPartId(event.id, turnState.stepIndex),
                delta: event.delta,
              },
              emitEvent,
            );
          },
          onToolInputStart: (event) => {
            streamedAnyResponse = true;
            beginToolStep(turnState, event.toolCallId);
            this.applyEvent(turnState, { type: 'tool-input-start', requestId, ...event }, emitEvent);
          },
          onToolInputDelta: (event) => {
            streamedAnyResponse = true;
            this.applyEvent(turnState, { type: 'tool-input-delta', requestId, ...event }, emitEvent);
          },
          onToolInputAvailable: (event) => {
            streamedAnyResponse = true;
            beginToolStep(turnState, event.toolCallId);
            this.applyEvent(turnState, { type: 'tool-input-available', requestId, ...event }, emitEvent);
          },
          onToolOutputAvailable: (event) => {
            streamedAnyResponse = true;
            // Provider-executed tools (hosted web search) can surface only an
            // output event, with no input phase to notice.
            beginToolStep(turnState, event.toolCallId);
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
            // Observational, and placed after the state change it describes so
            // it can never be mistaken for part of the decision. Only MCP calls
            // are recorded here: a built-in tool's approval is not data leaving
            // the machine, which is what this trail exists to account for.
            if (isMcpToolName(event.toolName ?? '')) {
              const provenance = this.describeAuditServer(event.toolName ?? '');

              this.audit?.record({
                requestId,
                conversationId: request.conversationId,
                type: 'approval_requested',
                server: provenance.server,
                plugin: provenance.plugin,
                tool: event.toolName ?? null,
                outcome: 'ok',
                approvalId: event.approvalId,
                toolCallId: event.toolCallId,
                detail: event.reason ?? null,
                // Keyed on the approval alone: a request is asked once, and a
                // duplicate delivery of the same event must not read as a
                // second, distinct approval being opened.
                idempotencyKey: `ar:${event.approvalId}`
              });
            }

            this.applyEvent(turnState, { type: 'tool-approval-requested', requestId, ...event }, emitEvent);
          },
          onToolApprovalResolved: (event) => {
            // Agent providers answer approvals mid-turn and keep streaming, so
            // a decided ask must stop counting as pending — otherwise the turn
            // ends in `awaiting_approval` with nothing left to decide.
            turnState.pendingApprovals.delete(event.approvalId);
          },
          onNotice: (event) => {
            emitEvent({ type: 'notice', requestId, ...event });
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
        const nextMode: ContextBuildMode | null =
          !streamedAnyResponse && !signal.aborted && this.isPromptTooLongError(error, normalized.message)
            ? nextCompactionMode(compactionMode)
            : null;

        if (nextMode) {
          compactionMode = nextMode;
          logger.warn('turn.compacting', {
            requestId,
            modelId: request.modelId,
            attempt,
            compactionMode,
            historyTokens: modelInput.usage.historyTokens,
            code: normalized.code,
          });
          emitEvent({
            type: 'notice',
            requestId,
            code: 'compacting',
            level: 'info',
            message: compactionNotice(compactionMode),
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
