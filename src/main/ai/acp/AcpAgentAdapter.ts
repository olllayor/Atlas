/**
 * `ProviderAdapter` over the Agent Client Protocol: one turn loop for every
 * local agent that speaks ACP over stdio (Claude Code today, whatever the
 * registry adds next).
 *
 * opencode is deliberately *not* one of them — it is driven over its own SDK
 * server, the way t3code drives it — but this file grew out of that work and
 * keeps its shape: the agent runs its own tools, Atlas renders them, and a
 * turn resumes the conversation's session or recreates on a confirmed miss.
 *
 * Deliberate slice limits (see `acpClient.ts`):
 *
 * - text and file turns: images ride natively, text files embed, the rest
 *   degrade to path lines;
 * - tool approvals surface through `resolveApproval` with one-shot semantics;
 *   the client only auto-denies when no turn is listening;
 * - a directory move forks the stored session into the new directory.
 */

import type { ModelSummary, ProviderId } from '../../../shared/contracts.js';
import type {
  ProviderAdapter,
  ProviderApprovalDecision,
  ProviderCapabilities,
  ProviderStreamRequest,
  ProviderStreamResult
} from '../core/ProviderAdapter.js';
import { isAcpNotFound, AcpClient, type AcpPermissionAsk, type AcpPromptBlock, type AcpSessionInfo, type AcpSessionUpdate } from './acpClient.js';
import { buildOpenCodePromptParts } from '../providers/opencode/openCodePrompt.js';
import { ToolCallTracker } from '../providers/opencode/openCodeEvents.js';
import { isSameOpenCodeDirectory, type OpenCodeSessionStore } from '../providers/opencode/OpenCodeAgentAdapter.js';

/** `undefined` when there is nothing to add, so the child inherits our env untouched. */
export function acpSpawnEnv(overrides: Record<string, string>): NodeJS.ProcessEnv | undefined {
  return Object.keys(overrides).length > 0 ? { ...process.env, ...overrides } : undefined;
}

/** Structural slice of `AcpClient` a turn needs; fakes script this in tests. */
export interface AcpDriverClient {
  start(): Promise<unknown>;
  createSession(): Promise<AcpSessionInfo>;
  resumeSession(sessionId: string): Promise<AcpSessionInfo>;
  forkSession(sessionId: string, directory: string): Promise<AcpSessionInfo>;
  setModel(sessionId: string, value: string): Promise<AcpSessionInfo>;
  /** Optional: agents with a `mode` config (Antigravity default/auto_edit/yolo). */
  setMode?(sessionId: string, mode: string): Promise<void>;
  prompt(
    sessionId: string,
    blocks: readonly AcpPromptBlock[],
    onChunk?: (chunk: { kind: 'text' | 'thought'; delta: string }) => void
  ): Promise<{
    stopReason: string;
    text: string;
    thought: string;
    skipped: readonly { path: string; reason: string }[];
    usage: { inputTokens?: number; outputTokens?: number; cachedReadTokens?: number };
  }>;
  cancel(sessionId: string): void;
  closeSession(sessionId: string): Promise<void>;
  setPermissionHandler(handler: ((ask: AcpPermissionAsk) => void) | null): void;
  resolvePermission(approvalId: string, decision: 'approve' | 'approve_always' | 'deny'): void;
  handleSessionUpdate(handler: (update: AcpSessionUpdate) => void): () => void;
}

export interface AcpAgentAdapterDeps {
  /**
   * Structural on purpose: `OpenCodeSettings` satisfies it, and so does any
   * other local agent's settings, which is what lets this driver back agents
   * beyond opencode without a second copy of the turn loop.
   */
  readonly readSettings: () => { customModels: readonly string[] };
  /** One client per directory, owned and shut down by the controller. */
  readonly getClient: (directory: string) => AcpDriverClient;
  readonly sessions: OpenCodeSessionStore;
  readonly defaultDirectory: () => string;
  /** Registry id the catalog rows are filed under. */
  readonly providerId: ProviderId;
  /** Name used in user-facing errors. */
  readonly agentLabel: string;
  /**
   * Map the turn's tool-permission mode onto the agent's session mode.
   * Antigravity supplies `default` | `auto_edit` | `yolo`; others ignore.
   */
  readonly mapPermissionMode?: (toolPermissionMode: string | null | undefined) => string | null;
  /** Re-label / fold catalog rows (Antigravity legacy models → archived). */
  readonly classifyCatalog?: (rows: ModelSummary[]) => ModelSummary[];
}

function abortError(label = 'OpenCode'): Error {
  const error = new Error(`The ${label} turn was aborted.`);
  error.name = 'AbortError';
  return error;
}

/**
 * What Atlas knows about a model the agent merely named. `null` is "nobody has
 * said" — Atlas' three-valued flags let the first real request settle it, which
 * `false` would not.
 */
const DEFAULT_ACP_MODEL_CAPABILITIES = {
  contextWindow: null,
  maxOutputTokens: null,
  supportsVision: null,
  supportsDocumentInput: null,
  supportsTools: null
} as const;

/** Split a `data:<mime>;base64,<payload>` URL; null for anything else. */
function parseDataUrl(url: string): { mime: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!match) {
    return null;
  }
  return { mime: match[1] ?? 'application/octet-stream', base64: match[2] ?? '' };
}

function toCatalogRows(
  session: AcpSessionInfo,
  customModels: readonly string[],
  providerId: ProviderId
): ModelSummary[] {
  const syncedAt = new Date().toISOString();
  const rows: ModelSummary[] = session.models.map((model) => ({
    id: model.value,
    providerId,
    label: model.name,
    isFree: false,
    archived: false,
    lastSyncedAt: syncedAt,
    lastSeenFreeAt: null,
    reasoningEfforts: null,
    supportsTemperature: false,
    ...DEFAULT_ACP_MODEL_CAPABILITIES
  }));
  const known = new Set(rows.map((row) => row.id));
  for (const raw of customModels) {
    const id = raw.trim();
    if (!id || known.has(id)) {
      continue;
    }
    known.add(id);
    rows.push({
      id,
      providerId,
      label: id,
      isFree: false,
      archived: false,
      lastSyncedAt: syncedAt,
      lastSeenFreeAt: null,
      reasoningEfforts: null,
      supportsTemperature: false,
      ...DEFAULT_ACP_MODEL_CAPABILITIES
    });
  }
  return rows;
}

export class AcpAgentAdapter implements ProviderAdapter {
  readonly providerId: ProviderId;

  /** Name this driver uses when it has to explain itself to the user. */
  private readonly label: string;

  readonly capabilities: ProviderCapabilities = {
    requiresApiKeyForCatalog: false,
    returnsCompleteCatalog: true,
    catalogRequiresNetwork: true,
    authenticatesItself: true
  };

  /**
   * Permission asks awaiting a decision, keyed by tool call id. Entries drop
   * when answered, otherwise when the turn that raised them ends.
   */
  private readonly pendingApprovals = new Map<
    string,
    { client: AcpDriverClient; settled: boolean; notifyResolved?: () => void }
  >();

  constructor(private readonly deps: AcpAgentAdapterDeps) {
    this.providerId = deps.providerId;
    this.label = deps.agentLabel;
  }

  /**
   * Answer a tool permission ask the agent raised. One-shot like the SDK
   * driver: a second decision for the same ask is dropped, never sent twice.
   */
  async resolveApproval(approvalId: string, decision: ProviderApprovalDecision): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending || pending.settled) {
      return;
    }
    pending.settled = true;
    this.pendingApprovals.delete(approvalId);
    pending.notifyResolved?.();
    pending.client.resolvePermission(approvalId, decision);
  }

  async validateCredential(): Promise<void> {
    const client = this.deps.getClient(this.deps.defaultDirectory());
    await client.start();
    const session = await client.createSession();
    await client.closeSession(session.sessionId).catch(() => undefined);
  }

  async listModels(): Promise<ModelSummary[]> {
    const settings = this.deps.readSettings();
    const client = this.deps.getClient(this.deps.defaultDirectory());
    await client.start();
    const session = await client.createSession();
    try {
      const rows = toCatalogRows(session, settings.customModels, this.providerId);
      return this.deps.classifyCatalog ? this.deps.classifyCatalog(rows) : rows;
    } finally {
      await client.closeSession(session.sessionId).catch(() => undefined);
    }
  }

  async streamChat(request: ProviderStreamRequest): Promise<ProviderStreamResult> {
    const startedAt = Date.now();
    const conversationId = request.agentContext?.conversationId ?? null;
    const directory = request.agentContext?.workspaceRoot ?? this.deps.defaultDirectory();
    const client = this.deps.getClient(directory);
    await client.start();

    let onAbort: (() => void) | null = null;
    let disposableSessionId: string | null = null;
    let unsubscribeTools: (() => void) | null = null;
    const raisedApprovals = new Set<string>();
    try {
      const { sessionId, seeded, ephemeral } = await this.resolveSession({
        client,
        conversationId,
        directory
      });
      if (ephemeral) {
        disposableSessionId = sessionId;
      }

      // Route tool calls into the shared tracker so the UI renders the same
      // tool lifecycle as SDK mode: start on announce, input once complete,
      // exactly one terminal output or error. Only `failed` counts as an
      // error — a nonzero exit still reports `completed` (verified live).
      const toolTracker = new ToolCallTracker({
        ...(request.onToolInputStart ? { onToolInputStart: request.onToolInputStart } : {}),
        ...(request.onToolInputAvailable
          ? { onToolInputAvailable: request.onToolInputAvailable }
          : {}),
        ...(request.onToolOutputAvailable
          ? { onToolOutputAvailable: request.onToolOutputAvailable }
          : {}),
        ...(request.onToolOutputError ? { onToolOutputError: request.onToolOutputError } : {})
      });
      const lastToolInput = new Map<string, string>();
      unsubscribeTools = client.handleSessionUpdate((update) => {
        if (update.sessionId !== sessionId) {
          return;
        }
        if (update.kind === 'tool_call') {
          toolTracker.start(update.toolCallId, update.title);
          return;
        }
        if (update.kind !== 'tool_call_update') {
          return;
        }
        if (update.title) {
          toolTracker.setTitle(update.toolCallId, update.title);
        }
        if (update.input !== undefined && update.status !== 'completed' && update.status !== 'failed') {
          const fingerprint = JSON.stringify(update.input);
          if (lastToolInput.get(update.toolCallId) !== fingerprint) {
            lastToolInput.set(update.toolCallId, fingerprint);
            toolTracker.inputAvailable(update.toolCallId, update.title, update.input);
          }
        }
            if (update.status === 'completed' || update.status === 'failed') {
              // Terminal frames repeat the last input; make sure the record
              // carries it before settling, like the SDK snapshot path.
              if (update.input !== undefined && lastToolInput.get(update.toolCallId) === undefined) {
                lastToolInput.set(update.toolCallId, JSON.stringify(update.input));
                toolTracker.inputAvailable(update.toolCallId, update.title, update.input);
              }
            }
            if (update.status === 'completed') {
              toolTracker.succeeded(update.toolCallId, update.outputText ?? '');
            } else if (update.status === 'failed') {
              toolTracker.failed(update.toolCallId, update.errorText ?? 'The tool failed.');
            }
      });

      // Route permission asks into the turn so the UI can answer them instead
      // of the client auto-denying behind the turn's back. The approval id is
      // the tool call id, so the prompt attaches to the visible call.
      client.setPermissionHandler((ask) => {
        raisedApprovals.add(ask.approvalId);
        this.pendingApprovals.set(ask.approvalId, {
          client,
          settled: false,
          ...(request.onToolApprovalResolved
            ? { notifyResolved: () => request.onToolApprovalResolved?.({ approvalId: ask.approvalId }) }
            : {})
        });
        request.onToolApprovalRequested?.({
          approvalId: ask.approvalId,
          toolCallId: ask.toolCallId ?? ask.approvalId,
          ...(ask.title ? { toolName: ask.title } : {}),
          reason: `${this.label} asked for tool permission.`
        });
      });

      // The model is selected per session: a resumed session may still point
      // at whatever the last turn chose, so every turn reasserts. An unknown
      // model fails loudly here rather than running on the server default.
      await client.setModel(sessionId, request.modelId);

      // Antigravity permission modes: map Atlas' tool-permission mode onto
      // the agent's `default` | `auto_edit` | `yolo` config. Other agents
      // have no `mode` config and ignore the call.
      const toolPermissionMode =
        request.toolPermissionMode ?? request.agentContext?.toolPermissionMode ?? null;
      const mappedMode = this.deps.mapPermissionMode
        ? this.deps.mapPermissionMode(
            typeof toolPermissionMode === 'string' ? toolPermissionMode : null
          )
        : null;
      if (mappedMode && typeof client.setMode === 'function') {
        await client.setMode(sessionId, mappedMode);
      }

      onAbort = () => {
        try {
          client.cancel(sessionId);
        } catch {
          // Local unwind continues regardless.
        }
      };
      if (request.signal.aborted) {
        throw abortError(this.label);
      }
      request.signal.addEventListener('abort', onAbort, { once: true });

      request.onNotice?.({
        code: 'opencode.toolsDelegated',
        level: 'info',
        message: `${this.label} runs its own tools for this turn; Atlas shows them as they happen.`
      });

      const parts = buildOpenCodePromptParts({ messages: request.messages, seedHistory: seeded, gateNative: false });
      const blocks: AcpPromptBlock[] = [];
      // ACP has no system role: the instruction layer rides as the first text
      // block, the same fallback t3code uses for its ACP prompts.
      if (request.system) {
        blocks.push({ type: 'text', text: request.system });
      }
      const pathFallbacks: string[] = [];
      for (const part of parts) {
        if (part.type === 'text' && part.text) {
          blocks.push({ type: 'text', text: part.text });
        } else if (part.type === 'file' && part.url) {
          const inline = parseDataUrl(part.url);
          if (inline) {
            blocks.push({
              type: 'file-bytes',
              mime: part.mime ?? inline.mime,
              base64: inline.base64,
              ...(part.filename ? { name: part.filename } : {})
            });
          } else {
            // Remote URL: no bytes to embed, the path line is the fallback.
            pathFallbacks.push(part.filename ?? part.url);
          }
        }
      }
      if (pathFallbacks.length > 0) {
        blocks.push({ type: 'text', text: `Attachment paths: ${pathFallbacks.join(', ')}` });
      }
      if (blocks.every((block) => block.type !== 'text')) {
        throw new Error('Nothing to send: the turn carried no user message.');
      }

      const chunkId = `acp-${sessionId}`;
      const result = await client.prompt(sessionId, blocks, (chunk) => {
        if (chunk.kind === 'text') {
          request.onChunk({ id: chunkId, delta: chunk.delta });
        } else {
          request.onReasoningChunk?.({ id: chunkId, delta: chunk.delta });
        }
      });

      // Skipped files degrade to path lines inside the client, the SDK
      // driver's fallback: the agent still learns each file exists.
      const skipped = [...result.skipped.map((entry) => entry.path), ...pathFallbacks];
      if (skipped.length > 0) {
        request.onNotice?.({
          code: 'opencode.acpFilesDeferred',
          level: 'warning',
          message: `${skipped.length} attachment${skipped.length === 1 ? ' was' : 's were'} sent as path${skipped.length === 1 ? '' : 's'} rather than embedded content.`
        });
      }

      if (request.signal.aborted) {
        throw abortError(this.label);
      }
      if (result.stopReason === 'cancelled') {
        throw abortError(this.label);
      }

      const tokens = result.usage;
      const cacheRead = tokens.cachedReadTokens;
      return {
        content: result.text,
        ...(result.thought ? { reasoning: result.thought } : {}),
        // opencode reports cache reads disjoint from input over ACP (verified
        // live: input 20145 + cache 1792 = usage.used 21937 exactly), so the
        // sum reconstructs the whole prompt with the hit as a subset.
        ...(tokens.inputTokens !== undefined
          ? { inputTokens: tokens.inputTokens + (cacheRead ?? 0) }
          : {}),
        ...(tokens.outputTokens !== undefined ? { outputTokens: tokens.outputTokens } : {}),
        ...(cacheRead !== undefined ? { cachedInputTokens: cacheRead } : {}),
        latencyMs: Date.now() - startedAt
      };
    } finally {
      if (onAbort) {
        request.signal.removeEventListener('abort', onAbort);
      }
      unsubscribeTools?.();
      client.setPermissionHandler(null);
      for (const approvalId of raisedApprovals) {
        this.pendingApprovals.delete(approvalId);
      }
      if (disposableSessionId) {
        await client.closeSession(disposableSessionId).catch(() => undefined);
      }
    }
  }

  /**
   * Resume rules, ACP edition: same-directory ACP cursors resume cross-process
   * (verified live), confirmed misses recreate, anything else fails the turn.
   * A directory change forks the stored session there (verified live); a
   * forked 404 falls back to fresh, any other fork failure fails the turn. A
   * cursor from the SDK transport is a miss — verified live that an SDK id
   * resolves over ACP, which would graft the wrong runtime onto the chat.
   */
  private async resolveSession(input: {
    client: AcpDriverClient;
    conversationId: string | null;
    directory: string;
  }): Promise<{ sessionId: string; seeded: boolean; ephemeral: boolean }> {
    const stored = input.conversationId ? this.deps.sessions.get(input.conversationId) : null;
    const usable = stored && (stored.transport ?? 'sdk') === 'acp' ? stored : null;

    if (usable && (await isSameOpenCodeDirectory(usable.directory, input.directory))) {
      try {
        const resumed = await input.client.resumeSession(usable.sessionId);
        return { sessionId: resumed.sessionId, seeded: false, ephemeral: false };
      } catch (error) {
        if (!isAcpNotFound(error)) {
          throw error;
        }
      }
    } else if (usable) {
      try {
        const forked = await input.client.forkSession(usable.sessionId, input.directory);
        if (input.conversationId) {
          this.deps.sessions.set({
            conversationId: input.conversationId,
            sessionId: forked.sessionId,
            directory: input.directory,
            transport: 'acp'
          });
        }
        return { sessionId: forked.sessionId, seeded: false, ephemeral: false };
      } catch (error) {
        if (!isAcpNotFound(error)) {
          throw error;
        }
        // Forked 404: the source vanished mid-move. Fall through to fresh.
      }
    }

    const created = await input.client.createSession();
    if (!input.conversationId) {
      return { sessionId: created.sessionId, seeded: true, ephemeral: true };
    }
    this.deps.sessions.set({
      conversationId: input.conversationId,
      sessionId: created.sessionId,
      directory: input.directory,
      transport: 'acp'
    });
    return { sessionId: created.sessionId, seeded: true, ephemeral: false };
  }
}
