/**
 * `ProviderAdapter` for Claude Code over its official Agent SDK:
 * runs chat turns directly against the `claude` CLI via `@anthropic-ai/claude-agent-sdk`,
 * exactly like T3 Code (blueprint: pingdotgg/t3code Layers/ClaudeAdapter.ts).
 *
 * No external ACP bridge package (e.g. `@zed-industries/claude-code-acp`) is needed.
 */

import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';
import { query, type PermissionResult, type Query } from '@anthropic-ai/claude-agent-sdk';

import type { ModelSummary, ProviderId } from '../../../../shared/contracts.js';
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
import { probeClaude, DEFAULT_CLAUDE_MODELS, type ClaudeModelOption } from './probeClaude.js';

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

/** Extract plain text and user prompt content from ModelMessage array. */
function extractUserPrompt(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.role === 'user') {
      if (typeof msg.content === 'string') {
        return msg.content;
      }
      if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        for (const part of msg.content) {
          if (typeof part === 'string') {
            textParts.push(part);
          } else if (typeof part === 'object' && part !== null && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
            textParts.push((part as { text: string }).text);
          }
        }
        return textParts.join('\n');
      }
    }
  }
  return '';
}

export class ClaudeAgentAdapter implements ProviderAdapter {
  readonly providerId: ProviderId;
  private readonly label: string;
  private cachedModels: ClaudeModelOption[] | null = null;
  private activeQuery: Query | null = null;

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
      reasoningEfforts: ['low', 'medium', 'high', 'max'],
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
    if (this.activeQuery) {
      try {
        this.activeQuery.close();
      } catch {
        // ignore close error during shutdown
      }
      this.activeQuery = null;
    }
  }

  async streamChat(request: ProviderStreamRequest): Promise<ProviderStreamResult> {
    const startedAt = Date.now();
    const conversationId = request.agentContext?.conversationId ?? null;
    const directory = request.agentContext?.workspaceRoot ?? this.deps.defaultDirectory();
    const settings = this.deps.readSettings();

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

    const userPrompt = extractUserPrompt(request.messages);
    if (!userPrompt.trim()) {
      throw new Error('No user prompt found in messages.');
    }

    const abortController = new AbortController();
    const onAbort = () => {
      abortController.abort();
      if (this.activeQuery) {
        try {
          this.activeQuery.close();
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

    const queryFn = this.deps.createQuery ?? query;
    let capturedSessionId = resumeSessionId;
    let accumulatedText = '';
    let accumulatedReasoning = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedReadTokens = 0;

    const queryRuntime = queryFn({
      prompt: userPrompt,
      options: {
        pathToClaudeCodeExecutable: executablePath,
        cwd: directory,
        persistSession: true,
        includePartialMessages: true,
        env: environment,
        canUseTool,
        abortController,
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        ...(request.modelId && request.modelId !== 'default' ? { model: request.modelId } : {}),
        ...(request.reasoningEffort ? { effort: request.reasoningEffort as 'low' | 'medium' | 'high' | 'max' } : {}),
        ...(toolPermissionMode === 'full-access'
          ? { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true }
          : { permissionMode: 'default' }),
        ...(Object.keys(extraArgs).length > 0 ? { extraArgs } : {})
      }
    });

    this.activeQuery = queryRuntime;

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
            if (message.session_id) {
              capturedSessionId = message.session_id;
            }
            const usage = message.usage;
            if (usage) {
              inputTokens = usage.input_tokens ?? 0;
              outputTokens = usage.output_tokens ?? 0;
              cachedReadTokens = usage.cache_read_input_tokens ?? 0;
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

      // Persist session cursor for conversation
      if (conversationId && capturedSessionId) {
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
      throw error;
    } finally {
      this.activeQuery = null;
      request.signal.removeEventListener('abort', onAbort);
      for (const pending of this.pendingApprovals.values()) {
        pending.resolve('deny');
      }
      this.pendingApprovals.clear();
    }
  }
}
