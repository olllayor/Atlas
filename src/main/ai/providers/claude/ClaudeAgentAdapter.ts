/**
 * `ProviderAdapter` for Claude Code over its official Agent SDK:
 * runs chat turns directly against the `claude` CLI via `@anthropic-ai/claude-agent-sdk`,
 * exactly like T3 Code (blueprint: pingdotgg/t3code Layers/ClaudeAdapter.ts).
 *
 * No external ACP bridge package (e.g. `@zed-industries/claude-code-acp`) is needed.
 */

import { randomUUID } from 'node:crypto';
import {
  query,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk';

import type { ModelSummary, ProviderId } from '../../../../shared/contracts.js';
import type { ReasoningEffort } from '../../../../shared/chatParameters.js';
import type { LocalAgentSettings } from '../../../../shared/localAgents.js';
import type {
  ProviderAdapter,
  ProviderApprovalDecision,
  ProviderCapabilities,
  ProviderStreamRequest,
  ProviderStreamResult
} from '../../core/ProviderAdapter.js';
import type { OpenCodeSessionStore } from '../opencode/OpenCodeAgentAdapter.js';
import { isSameOpenCodeDirectory } from '../opencode/OpenCodeAgentAdapter.js';
import { splitLaunchArgs } from '../opencode/openCodeParsers.js';
import { makeClaudeEnvironment } from './claudeHome.js';
import { resolveClaudeSdkExecutablePath } from './claudeExecutable.js';
import { buildClaudePrompt } from './claudePrompt.js';
import { discoverClaudeSkills } from './claudeSkills.js';
import {
  probeClaude,
  DEFAULT_CLAUDE_MODELS,
  CLAUDE_UNAUTHENTICATED_MESSAGE,
  type ClaudeModelOption
} from './probeClaude.js';

export interface ClaudeAgentAdapterDeps {
  readonly readSettings: () => LocalAgentSettings;
  readonly sessions: OpenCodeSessionStore;
  readonly defaultDirectory: () => string;
  readonly providerId?: ProviderId;
  readonly agentLabel?: string;
  /** Test seam to inject custom query factory */
  readonly createQuery?: typeof query;
}

const DEFAULT_CLAUDE_CAPABILITIES = {
  contextWindow: 200_000,
  maxOutputTokens: 8_192,
  supportsVision: true,
  supportsDocumentInput: true,
  supportsTools: true
} as const;

function abortError(label = 'Claude Code'): Error {
  const error = new Error(`The ${label} turn was aborted.`);
  error.name = 'AbortError';
  return error;
}

/** Parse launch arguments string into flag/value dictionary for the SDK. */
function parseExtraArgs(launchArgs: string): Record<string, string | null> {
  const rawArgs = splitLaunchArgs(launchArgs);
  const extraArgs: Record<string, string | null> = {};

  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i];
    if (!token?.startsWith('-')) {
      continue;
    }
    const stripped = token.replace(/^-+/, '');
    const eqIdx = stripped.indexOf('=');
    if (eqIdx >= 0) {
      const key = stripped.slice(0, eqIdx);
      const val = stripped.slice(eqIdx + 1);
      extraArgs[key] = val;
    } else {
      const next = rawArgs[i + 1];
      if (next && !next.startsWith('-')) {
        extraArgs[stripped] = next;
        i++;
      } else {
        extraArgs[stripped] = null;
      }
    }
  }

  return extraArgs;
}

/** Label for compact_boundary triggers. */
function triggerLabel(trigger: string | undefined): string {
  return trigger === 'auto' ? 'automatic' : 'manual';
}

/** SDK effort levels, the subset of Atlas' ladder the CLI accepts. */
type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

function toClaudeEffort(effort: ReasoningEffort | undefined): ClaudeEffort | null {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return effort;
    default:
      return null;
  }
}

/**
 * Resolve the effort for this turn against the probed catalog: unknown models
 * keep the requested level (today's behavior), models that take no effort get
 * none, and a level the model does not list is dropped rather than rejected
 * by the CLI.
 */
export function resolveEffortForModel(
  requested: ReasoningEffort | undefined,
  modelId: string,
  catalog: ClaudeModelOption[] | null
): { effort: ClaudeEffort | null; dropped: boolean } {
  const level = toClaudeEffort(requested);
  if (!level) {
    return { effort: null, dropped: false };
  }
  const known = catalog?.find((m) => m.id === modelId || (m.resolvedModel && m.resolvedModel === modelId));
  if (!known) {
    return { effort: level, dropped: false };
  }
  if (known.supportsEffort === false) {
    return { effort: null, dropped: true };
  }
  if (known.supportedEffortLevels && !known.supportedEffortLevels.includes(level)) {
    return { effort: null, dropped: true };
  }
  return { effort: level, dropped: false };
}

/** Normalize user/alias model slugs to actual Claude CLI model IDs (t3code PR #9078). */
function normalizeClaudeModel(modelId: string | undefined): string | undefined {
  if (!modelId || modelId === 'default') return undefined;
  const trimmed = modelId.trim();
  if (trimmed === 'fable' || trimmed === 'fable-5.1' || trimmed === 'claude-fable-5.1') {
    return 'claude-fable-5-1';
  }
  return trimmed;
}

export class ClaudeAgentAdapter implements ProviderAdapter {
  readonly providerId: ProviderId;
  private readonly label: string;
  private cachedModels: ClaudeModelOption[] | null = null;
  private readonly activeQueries = new Set<Query>();

  readonly capabilities: ProviderCapabilities = {
    requiresApiKeyForCatalog: false,
    returnsCompleteCatalog: true,
    catalogRequiresNetwork: false,
    authenticatesItself: true
  };

  /**
   * Pending approval requests keyed by approvalId.
   */
  private readonly pendingApprovals = new Map<
    string,
    {
      toolUseId: string;
      resolve: (decision: ProviderApprovalDecision) => void;
      notifyResolved?: () => void;
    }
  >();

  constructor(private readonly deps: ClaudeAgentAdapterDeps) {
    this.providerId = deps.providerId ?? 'claude-code';
    this.label = deps.agentLabel ?? 'Claude Code';
  }

  /**
   * Answer a tool permission prompt raised by Claude Code.
   */
  async resolveApproval(approvalId: string, decision: ProviderApprovalDecision): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      return;
    }
    this.pendingApprovals.delete(approvalId);
    pending.notifyResolved?.();
    pending.resolve(decision);
  }

  async validateCredential(): Promise<void> {
    await this.listModels();
  }

  async listModels(): Promise<ModelSummary[]> {
    return this.getModelCatalog();
  }

  async getModelCatalog(): Promise<ModelSummary[]> {
    const settings = this.deps.readSettings();
    const syncedAt = new Date().toISOString();

    if (!this.cachedModels) {
      const probeResult = await probeClaude({
        binaryPath: settings.binaryPath,
        homePath: settings.homePath,
        launchArgs: settings.launchArgs,
        env: settings.env,
        customModels: settings.customModels,
        cwd: this.deps.defaultDirectory()
      });
      this.cachedModels = probeResult.models.length > 0 ? probeResult.models : [...DEFAULT_CLAUDE_MODELS];
    }

    const rows: ModelSummary[] = this.cachedModels.map((m) => ({
      id: m.id,
      providerId: this.providerId,
      label: m.label,
      isFree: false,
      archived: false,
      lastSyncedAt: syncedAt,
      lastSeenFreeAt: null,
      // The probe reports per-model effort support; unknown models keep the
      // historical ladder so the picker still offers thinking control.
      supportsReasoning: m.supportsEffort ?? true,
      reasoningEfforts: m.supportedEffortLevels ? [...m.supportedEffortLevels] : ['low', 'medium', 'high', 'max'],
      supportsTemperature: false,
      ...DEFAULT_CLAUDE_CAPABILITIES
    }));

    const knownIds = new Set(rows.map((r) => r.id));
    for (const custom of settings.customModels) {
      const id = custom.trim();
      if (!id || knownIds.has(id)) {
        continue;
      }
      knownIds.add(id);
      rows.push({
        id,
        providerId: this.providerId,
        label: id,
        isFree: false,
        archived: false,
        lastSyncedAt: syncedAt,
        lastSeenFreeAt: null,
        supportsReasoning: true,
        reasoningEfforts: ['low', 'medium', 'high', 'max'],
        supportsTemperature: false,
        ...DEFAULT_CLAUDE_CAPABILITIES
      });
    }

    return rows;
  }

  async shutdown(): Promise<void> {
    for (const pending of this.pendingApprovals.values()) {
      pending.resolve('deny');
    }
    this.pendingApprovals.clear();
    for (const active of this.activeQueries) {
      try {
        active.close();
      } catch {
        // ignore close error during shutdown
      }
    }
    this.activeQueries.clear();
  }

  async streamChat(request: ProviderStreamRequest): Promise<ProviderStreamResult> {
    const startedAt = Date.now();
    const conversationId = request.agentContext?.conversationId ?? null;
    const directory = request.agentContext?.workspaceRoot ?? this.deps.defaultDirectory();
    const settings = this.deps.readSettings();

    // Context-less calls (title, summary) carry no conversation: they run as
    // scratch sessions that are never persisted, with tools disabled, so a
    // title can neither pollute the session list nor execute anything.
    const ephemeral = !conversationId;

    // Check existing session for this conversation
    const stored = conversationId ? this.deps.sessions.get(conversationId) : null;
    let resumeSessionId: string | undefined;

    if (stored?.sessionId) {
      const sameDir = await isSameOpenCodeDirectory(stored.directory, directory);
      if (sameDir) {
        resumeSessionId = stored.sessionId;
      } else if (conversationId) {
        // Directory moved; start a fresh session in the new directory
        this.deps.sessions.clear(conversationId);
      }
    }

    const executablePath = resolveClaudeSdkExecutablePath(settings.binaryPath, settings.env);
    const environment = makeClaudeEnvironment(settings);
    const extraArgs = parseExtraArgs(settings.launchArgs);

    // Skill names for `$skill` dispatch; discovery is best-effort and never
    // fails a turn.
    let skillNames: ReadonlySet<string> = new Set();
    try {
      const skills = await discoverClaudeSkills({ homePath: settings.homePath, cwd: directory });
      skillNames = new Set(skills.filter((skill) => skill.userInvocable !== false).map((skill) => skill.name));
    } catch {
      skillNames = new Set();
    }

    const built = buildClaudePrompt({ messages: request.messages, skillNames });
    const promptEmpty =
      typeof built.prompt === 'string'
        ? built.prompt.trim().length === 0
        : (built.prompt.message.content as unknown[]).length === 0;
    if (promptEmpty) {
      throw new Error('No user prompt found in messages.');
    }
    if (built.deferredPaths.length > 0) {
      request.onNotice?.({
        code: 'claude.filesDeferred',
        level: 'warning',
        message: `${built.deferredPaths.length} attachment${built.deferredPaths.length === 1 ? ' was' : 's were'} sent as path${built.deferredPaths.length === 1 ? '' : 's'} rather than embedded content.`
      });
    }

    const abortController = new AbortController();
    let liveQuery: Query | null = null;
    const onAbort = () => {
      abortController.abort();
      if (liveQuery) {
        try {
          liveQuery.close();
        } catch {
          // ignore
        }
      }
      for (const pending of this.pendingApprovals.values()) {
        pending.resolve('deny');
      }
      this.pendingApprovals.clear();
    };

    request.signal.addEventListener('abort', onAbort, { once: true });

    const toolPermissionMode =
      (request.toolPermissionMode as string | undefined) ??
      (request.agentContext?.toolPermissionMode as string | undefined) ??
      'ask';

    const canUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
      options: {
        signal: AbortSignal;
        decisionReason?: string;
        title?: string;
        toolUseID: string;
      }
    ): Promise<PermissionResult> => {
      if (options.signal.aborted || request.signal.aborted) {
        return { behavior: 'deny', message: 'Turn was aborted by user.' };
      }

      // Scratch sessions (title, summary) never execute: deny before any UI.
      if (ephemeral) {
        return { behavior: 'deny', message: 'Tool use is disabled for this request.' };
      }

      if (toolPermissionMode === 'full-access') {
        return { behavior: 'allow' };
      }

      const approvalId = randomUUID();
      const toolCallId = options.toolUseID;

      request.onToolApprovalRequested?.({
        approvalId,
        toolCallId,
        toolName,
        reason: options.decisionReason ?? options.title ?? `Execute ${toolName}`
      });

      const decision = await new Promise<ProviderApprovalDecision>((resolve) => {
        const handleCancel = () => {
          this.pendingApprovals.delete(approvalId);
          resolve('deny');
        };

        options.signal.addEventListener('abort', handleCancel, { once: true });
        request.signal.addEventListener('abort', handleCancel, { once: true });

        this.pendingApprovals.set(approvalId, {
          toolUseId: toolCallId,
          resolve: (d) => {
            options.signal.removeEventListener('abort', handleCancel);
            request.signal.removeEventListener('abort', handleCancel);
            resolve(d);
          },
          notifyResolved: () => {
            request.onToolApprovalResolved?.({ approvalId });
          }
        });
      });

      if (decision === 'approve') {
        return { behavior: 'allow', updatedInput: input };
      }
      if (decision === 'approve_always') {
        return {
          behavior: 'allow',
          updatedInput: input,
          updatedPermissions: [
            {
              type: 'addRules',
              rules: [{ toolName }],
              behavior: 'allow',
              destination: 'session'
            }
          ]
        };
      }
      return { behavior: 'deny', message: 'User declined tool execution.' };
    };

    const permissionMode: PermissionMode =
      toolPermissionMode === 'full-access'
        ? 'bypassPermissions'
        : toolPermissionMode === 'read-only'
          ? 'plan'
          : 'default';

    const { effort, dropped: effortDropped } = resolveEffortForModel(
      request.reasoningEffort,
      request.modelId,
      this.cachedModels
    );
    if (effortDropped) {
      request.onNotice?.({
        code: 'claude.effortUnsupported',
        level: 'info',
        message: `The selected model does not take an effort level, so the thinking budget was ignored for this turn.`
      });
    }

    const selectedModel = normalizeClaudeModel(request.modelId);
    const queryFn = this.deps.createQuery ?? query;
    let capturedSessionId = resumeSessionId;
    let accumulatedText = '';
    let accumulatedReasoning = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedReadTokens = 0;
    let authFailureMessage: string | undefined;
    let receivedResult = false;

    const queryRuntime = queryFn({
      // Structured prompts (images, skill dispatch) stream as one message;
      // the SDK takes an async iterable for anything beyond plain text.
      prompt:
        typeof built.prompt === 'string'
          ? built.prompt
          : (async function* (): AsyncGenerator<SDKUserMessage> {
              yield built.prompt as SDKUserMessage;
            })(),
      options: {
        pathToClaudeCodeExecutable: executablePath,
        cwd: directory,
        persistSession: !ephemeral,
        includePartialMessages: true,
        env: environment,
        canUseTool,
        abortController,
        ...(ephemeral ? { allowedTools: [], permissionPrompts: 'none' as const } : {}),
        ...(request.system ? { systemPrompt: request.system } : {}),
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(effort ? { effort } : {}),
        permissionMode,
        ...(permissionMode === 'bypassPermissions'
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        ...(Object.keys(extraArgs).length > 0 ? { extraArgs } : {})
      }
    });

    liveQuery = queryRuntime;
    this.activeQueries.add(queryRuntime);

    try {
      for await (const message of queryRuntime) {
        if (request.signal.aborted) {
          throw abortError(this.label);
        }

        if ('session_id' in message && typeof message.session_id === 'string') {
          capturedSessionId = message.session_id;
        }

        const chunkId =
          ('uuid' in message && typeof message.uuid === 'string' ? message.uuid : '') ||
          capturedSessionId ||
          'chunk';

        switch (message.type) {
          case 'stream_event': {
            const streamEvent = message.event;
            if (!streamEvent) break;

            if (streamEvent.type === 'content_block_start') {
              const block = streamEvent.content_block;
              if (block && block.type === 'tool_use') {
                request.onToolInputStart?.({
                  toolCallId: block.id,
                  toolName: block.name,
                  dynamic: true,
                  providerExecuted: true,
                  title: block.name
                });
              }
            } else if (streamEvent.type === 'content_block_delta') {
              const delta = streamEvent.delta;
              if (!delta) break;

              if (delta.type === 'text_delta') {
                accumulatedText += delta.text;
                request.onChunk({
                  id: chunkId,
                  delta: delta.text
                });
              } else if (delta.type === 'thinking_delta') {
                accumulatedReasoning += delta.thinking;
                request.onReasoningChunk?.({
                  id: chunkId,
                  delta: delta.thinking
                });
              } else if (delta.type === 'input_json_delta') {
                request.onToolInputDelta?.({
                  toolCallId: (streamEvent as unknown as { tool_use_id?: string }).tool_use_id ?? '',
                  delta: delta.partial_json
                });
              }
            }
            break;
          }

          case 'assistant': {
            const assistantMsg = message.message;
            // Catch authentication_failed errors emitted by the CLI (t3code PR #8869, PR #9468)
            if ((message as { error?: string }).error === 'authentication_failed') {
              let detail = '';
              if (assistantMsg && Array.isArray(assistantMsg.content)) {
                detail = assistantMsg.content
                  .filter((b) => b.type === 'text')
                  .map((b) => (b as { text: string }).text)
                  .join('\n')
                  .trim();
              }
              authFailureMessage = detail
                ? `${detail}. ${CLAUDE_UNAUTHENTICATED_MESSAGE}`
                : CLAUDE_UNAUTHENTICATED_MESSAGE;
            }
            if (assistantMsg && Array.isArray(assistantMsg.content)) {
              if (!accumulatedText) {
                for (const block of assistantMsg.content) {
                  if (block.type === 'text') {
                    accumulatedText += block.text;
                    request.onChunk({ id: assistantMsg.id ?? 'msg', delta: block.text });
                  }
                }
              }
            }
            break;
          }

          case 'result': {
            receivedResult = true;
            if (message.session_id) {
              capturedSessionId = message.session_id;
            }
            const usage = message.usage;
            if (usage) {
              inputTokens = usage.input_tokens ?? 0;
              outputTokens = usage.output_tokens ?? 0;
              cachedReadTokens = usage.cache_read_input_tokens ?? 0;
            }

            const isError = Boolean((message as { is_error?: boolean }).is_error);
            const errors = (message as { errors?: string[] }).errors;

            // Fail turn immediately if auth failure occurred (t3code PR #8869)
            if (authFailureMessage && (isError || !accumulatedText)) {
              if (conversationId) {
                this.deps.sessions.clear(conversationId);
              }
              throw new Error(authFailureMessage);
            }

            if (isError && !accumulatedText) {
              if (conversationId) {
                this.deps.sessions.clear(conversationId);
              }
              const errDetail = errors && errors.length > 0 ? errors.join('\n') : '';
              throw new Error(errDetail || authFailureMessage || 'Claude turn failed.');
            }
            break;
          }

          case 'system': {
            const subtype = (message as { subtype?: string }).subtype;
            if (subtype === 'task_started') {
              const started = message as {
                skip_transcript?: boolean;
                description?: string;
                subagent_type?: string;
              };
              if (!started.skip_transcript && started.description) {
                request.onNotice?.({
                  code: 'claude.subagentStarted',
                  level: 'info',
                  message: started.subagent_type
                    ? `Subagent (${started.subagent_type}) started: ${started.description}`
                    : `Subagent started: ${started.description}`
                });
              }
            } else if (subtype === 'compact_boundary') {
              const meta = (message as { compact_metadata?: { pre_tokens?: number; post_tokens?: number; trigger?: string } }).compact_metadata;
              const pre = meta?.pre_tokens;
              const post = meta?.post_tokens;
              request.onNotice?.({
                code: 'claude.compacted',
                level: 'info',
                message:
                  pre !== undefined && post !== undefined
                    ? `Conversation compacted (${triggerLabel(meta?.trigger)}): ${pre.toLocaleString()} → ${post.toLocaleString()} tokens.`
                    : 'Conversation compacted to stay within context.'
              });
            }
            break;
          }

          case 'rate_limit_event': {
            const info = (message as { rate_limit_info?: { status?: string; utilization?: number; resetsAt?: number } }).rate_limit_info;
            if (info && (info.status === 'rejected' || info.status === 'allowed_warning')) {
              const percent =
                typeof info.utilization === 'number' ? ` at ${Math.round(info.utilization * 100)}%` : '';
              const reset =
                typeof info.resetsAt === 'number'
                  ? ` Resets ${new Date(info.resetsAt * 1000).toLocaleTimeString()}.`
                  : '';
              request.onNotice?.({
                code: 'claude.rateLimited',
                level: 'warning',
                message:
                  info.status === 'rejected'
                    ? `Claude usage limit reached${percent}.${reset}`
                    : `Claude usage running high${percent}.${reset}`
              });
            }
            break;
          }

          default:
            break;
        }
      }

      if (request.signal.aborted) {
        throw abortError(this.label);
      }

      // Check if the CLI exited unexpectedly without producing a result or text (t3code PR #9395)
      if (!receivedResult && !accumulatedText && !request.signal.aborted) {
        if (conversationId) {
          this.deps.sessions.clear(conversationId);
        }
        throw new Error(
          authFailureMessage ||
          'Claude Code exited unexpectedly before producing a response.'
        );
      }

      // Persist session cursor for conversation (never for scratch sessions).
      if (conversationId && capturedSessionId && !ephemeral) {
        this.deps.sessions.set({
          conversationId,
          sessionId: capturedSessionId,
          directory,
          transport: 'sdk'
        });
      }

      return {
        content: accumulatedText,
        reasoning: accumulatedReasoning || undefined,
        inputTokens,
        outputTokens,
        cachedInputTokens: cachedReadTokens > 0 ? cachedReadTokens : undefined,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      if (request.signal.aborted) {
        throw abortError(this.label);
      }
      // If resuming failed due to missing/invalid session or authentication failure,
      // clear the cached session cursor so subsequent attempts can start fresh (t3code PR #9344, PR #9628).
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (
        conversationId &&
        resumeSessionId &&
        (errorMsg.toLowerCase().includes('session') ||
          errorMsg.toLowerCase().includes('conversation') ||
          errorMsg.toLowerCase().includes('auth') ||
          errorMsg.toLowerCase().includes('login'))
      ) {
        this.deps.sessions.clear(conversationId);
      }
      throw error;
    } finally {
      this.activeQueries.delete(queryRuntime);
      liveQuery = null;
      request.signal.removeEventListener('abort', onAbort);
      for (const pending of this.pendingApprovals.values()) {
        pending.resolve('deny');
      }
      this.pendingApprovals.clear();
    }
  }
}
