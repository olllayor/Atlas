/**
 * `ProviderAdapter` for the deep OpenCode integration: a chat turn runs inside
 * an opencode session, and its native events are translated into the same
 * callbacks every other Atlas provider emits (plan D5).
 *
 * Blueprint: pingdotgg/t3code `Layers/OpenCodeAdapter.ts` — session resume
 * rules, recreate-only-on-confirmed-miss, abort ordering, one-shot guards.
 *
 * What is deliberately *not* here:
 *
 * - **Tool execution.** During an opencode turn the agent runs its own tools
 *   and Atlas renders them (plan D4), so the toolset Atlas would normally send
 *   is left behind and the user is told once.
 * - **Sampling.** `session/prompt` accepts a model, an agent, a system prompt
 *   and parts — there is no temperature, output ceiling, effort or tool-choice
 *   on the wire. opencode applies its own config, so `request.temperature`,
 *   `maxOutputTokens`, `reasoningEffort` and `toolChoice` have nowhere to go.
 *   The catalog says so too: opencode rows report `supportsTemperature: false`
 *   and no effort ladder, so the UI never offers a control that does nothing.
 */

import type { ModelSummary, ProviderId } from '../../../../shared/contracts.js';
import type { OpenCodeSettings } from '../../../../shared/opencodeSettings.js';
import { OPENCODE_PROVIDER_ID } from '../../../../shared/opencodeSettings.js';
import type {
  ProviderAdapter,
  ProviderApprovalDecision,
  ProviderCapabilities,
  ProviderStreamRequest,
  ProviderStreamResult
} from '../../core/ProviderAdapter.js';
import type { OpenCodeAgentClient, OpenCodePermissionReply } from './OpenCodeAgentClient.js';
import { flattenOpenCodeModels, parseOpenCodeModelSlug } from './inventory.js';
import { OpenCodeEventTranslator } from './openCodeEvents.js';
import { buildOpenCodePromptParts } from './openCodePrompt.js';

/** Where a turn's opencode session id is remembered between runs. */
export interface OpenCodeSessionStore {
  get(conversationId: string): { sessionId: string; directory: string } | null;
  set(input: { conversationId: string; sessionId: string; directory: string }): void;
  clear(conversationId: string): void;
}

export interface OpenCodeAgentAdapterDeps {
  /** Current settings; re-read per call so a Settings change lands immediately. */
  readonly readSettings: () => OpenCodeSettings;
  /** Keychain-held server password, or null when none is set (plan D3). */
  readonly readServerPassword: () => Promise<string | null>;
  /**
   * Server lifecycle. The returned lease's `release()` hands the reference
   * back so the runtime can reap an idle server; it rides on the connection
   * precisely so no caller can take one and forget to return it.
   */
  readonly connect: (settings: OpenCodeSettings) => Promise<{
    baseUrl: string;
    owned: boolean;
    release: () => void;
  }>;
  readonly createClient: (input: {
    baseUrl: string;
    directory: string;
    serverPassword?: string;
  }) => OpenCodeAgentClient;
  readonly sessions: OpenCodeSessionStore;
  /** Directory used when a turn carries no workspace (unattached chats). */
  readonly defaultDirectory: () => string;
}

/** How Atlas' approval vocabulary maps onto opencode's replies (plan T6). */
export function toOpenCodePermissionReply(decision: ProviderApprovalDecision): OpenCodePermissionReply {
  switch (decision) {
    case 'approve':
      return 'once';
    case 'approve_always':
      return 'always';
    case 'deny':
    default:
      return 'reject';
  }
}

function abortError(): Error {
  const error = new Error('The OpenCode turn was aborted.');
  error.name = 'AbortError';
  return error;
}

export class OpenCodeAgentAdapter implements ProviderAdapter {
  readonly providerId: ProviderId = OPENCODE_PROVIDER_ID;

  readonly capabilities: ProviderCapabilities = {
    // opencode holds its own credentials; Atlas never stores an API key for it.
    requiresApiKeyForCatalog: false,
    returnsCompleteCatalog: true,
    // The catalog comes off a live server, so a successful refresh really does
    // prove the integration works end to end.
    catalogRequiresNetwork: true,
    // `opencode auth login` owns the credentials; Atlas stores none, so no turn
    // may be gated on finding one.
    authenticatesItself: true
  };

  /** Permission asks awaiting a decision, keyed by opencode's request id. */
  private readonly pendingApprovals = new Map<
    string,
    { client: OpenCodeAgentClient; settled: boolean; notifyResolved?: () => void }
  >();

  constructor(private readonly deps: OpenCodeAgentAdapterDeps) {}

  /**
   * opencode authenticates itself (`opencode auth login`), so there is no Atlas
   * credential to validate — reachability is what "valid" means here.
   */
  async validateCredential(): Promise<void> {
    const { client, release } = await this.openClient(this.deps.defaultDirectory());
    try {
      await client.listProviders();
    } finally {
      release();
    }
  }

  async listModels(): Promise<ModelSummary[]> {
    const settings = this.deps.readSettings();
    const { client, release } = await this.openClient(this.deps.defaultDirectory());
    try {
      const inventory = await client.listProviders();
      return flattenOpenCodeModels({ inventory, customModels: settings.customModels });
    } finally {
      release();
    }
  }

  /**
   * Answer a permission request opencode raised during a turn. One-shot: a
   * second decision for the same ask (double-click, timeout racing the user)
   * is dropped rather than sent twice.
   */
  async resolveApproval(approvalId: string, decision: ProviderApprovalDecision): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending || pending.settled) {
      return;
    }
    pending.settled = true;
    this.pendingApprovals.delete(approvalId);
    // The turn keeps streaming, so it must stop treating this ask as pending
    // before opencode's answer produces more tool events.
    pending.notifyResolved?.();
    await pending.client.replyToPermission({
      requestId: approvalId,
      reply: toOpenCodePermissionReply(decision)
    });
  }

  async streamChat(request: ProviderStreamRequest): Promise<ProviderStreamResult> {
    const startedAt = Date.now();
    const slug = parseOpenCodeModelSlug(request.modelId);
    if (!slug) {
      throw new Error(
        `"${request.modelId}" is not an OpenCode model id. Expected "<provider>/<model>", e.g. "opencode/claude-opus-4-7".`
      );
    }

    const conversationId = request.agentContext?.conversationId ?? null;
    const directory = request.agentContext?.workspaceRoot ?? this.deps.defaultDirectory();
    const { client, release } = await this.openClient(directory);

    const streamAbort = new AbortController();
    let onAbort: (() => void) | null = null;
    let disposableSessionId: string | null = null;

    try {
      const { sessionId, seeded, ephemeral } = await this.resolveSession({
        client,
        conversationId,
        directory
      });
      // A context-less call (title, summary) has no conversation to resume
      // into, so its session is scratch and must not pile up in opencode's
      // own history.
      if (ephemeral) {
        disposableSessionId = sessionId;
      }

      // Abort ordering copied from t3: tell opencode first (best effort), then
      // let the local event stream unwind.
      onAbort = () => {
        void client.abort(sessionId).catch(() => undefined);
        streamAbort.abort();
      };
      if (request.signal.aborted) {
        throw abortError();
      }
      request.signal.addEventListener('abort', onAbort, { once: true });

      const translator = new OpenCodeEventTranslator(sessionId, {
        onChunk: request.onChunk,
        ...(request.onReasoningChunk ? { onReasoningChunk: request.onReasoningChunk } : {}),
        ...(request.onToolInputStart ? { onToolInputStart: request.onToolInputStart } : {}),
        ...(request.onToolInputDelta ? { onToolInputDelta: request.onToolInputDelta } : {}),
        ...(request.onToolInputAvailable ? { onToolInputAvailable: request.onToolInputAvailable } : {}),
        ...(request.onToolOutputAvailable ? { onToolOutputAvailable: request.onToolOutputAvailable } : {}),
        ...(request.onToolOutputError ? { onToolOutputError: request.onToolOutputError } : {}),
        onToolApprovalRequested: (event) => {
          this.pendingApprovals.set(event.approvalId, {
            client,
            settled: false,
            ...(request.onToolApprovalResolved
              ? { notifyResolved: () => request.onToolApprovalResolved?.({ approvalId: event.approvalId }) }
              : {})
          });
          request.onToolApprovalRequested?.(event);
        },
        ...(request.onNotice ? { onNotice: request.onNotice } : {})
      });

      const pump = this.pumpEvents(client, translator, streamAbort.signal);

      if (request.tools && Object.keys(request.tools).length > 0) {
        request.onNotice?.({
          code: 'opencode.toolsDelegated',
          level: 'info',
          message: 'OpenCode runs its own tools for this turn; Atlas shows them as they happen.'
        });
      }

      const parts = buildOpenCodePromptParts({ messages: request.messages, seedHistory: seeded });
      if (parts.length === 0) {
        throw new Error('Nothing to send: the turn carried no user message.');
      }

      const promptResult = await client.prompt({
        sessionId,
        model: { providerID: slug.providerID, modelID: slug.modelID },
        parts,
        ...(request.system ? { system: request.system } : {})
      });

      streamAbort.abort();
      await pump;

      if (request.signal.aborted || translator.wasAborted) {
        throw abortError();
      }

      const failure = promptResult.errorText ?? translator.errorText;
      if (failure) {
        throw new Error(failure);
      }

      const tokens = promptResult.tokens ?? {};
      const cacheRead = tokens.cacheRead;

      return {
        // Streamed text is authoritative; the final message is the fallback for
        // a server that reported no deltas at all.
        content: translator.assistantText || promptResult.text,
        reasoning: translator.assistantReasoning || promptResult.reasoning,
        // opencode counts cache reads outside `input`, while Atlas' contract
        // wants the whole prompt in `inputTokens` with the hit as a subset.
        ...(tokens.input !== undefined
          ? { inputTokens: tokens.input + (cacheRead ?? 0) }
          : {}),
        ...(tokens.output !== undefined ? { outputTokens: tokens.output } : {}),
        ...(tokens.reasoning !== undefined ? { reasoningTokens: tokens.reasoning } : {}),
        // Absent stays absent — a coerced 0 would fake a 0% cache rate.
        ...(cacheRead !== undefined ? { cachedInputTokens: cacheRead } : {}),
        latencyMs: Date.now() - startedAt
      };
    } finally {
      if (onAbort) {
        request.signal.removeEventListener('abort', onAbort);
      }
      streamAbort.abort();
      if (disposableSessionId) {
        await client.deleteSession(disposableSessionId).catch(() => undefined);
      }
      release();
    }
  }

  private async openClient(directory: string) {
    const settings = this.deps.readSettings();
    const connection = await this.deps.connect(settings);

    try {
      const serverPassword = await this.deps.readServerPassword();
      const client = this.deps.createClient({
        baseUrl: connection.baseUrl,
        directory,
        ...(serverPassword ? { serverPassword } : {})
      });
      return { client, release: () => connection.release() };
    } catch (error) {
      // Nothing downstream can release a lease the caller never received.
      connection.release();
      throw error;
    }
  }

  /**
   * Resume rules, straight from t3code:
   *
   * - a stored session is resumed as-is;
   * - a *confirmed* miss (opencode says 404) silently recreates — any other
   *   failure fails the turn, so a server hiccup never looks like a fresh chat;
   * - a directory change recreates too, because opencode scopes history by
   *   the directory a session was created in.
   */
  private async resolveSession(input: {
    client: OpenCodeAgentClient;
    conversationId: string | null;
    directory: string;
  }): Promise<{ sessionId: string; seeded: boolean; ephemeral: boolean }> {
    const stored = input.conversationId ? this.deps.sessions.get(input.conversationId) : null;

    if (stored && stored.directory === input.directory) {
      const existing = await input.client.getSession(stored.sessionId);
      if (existing) {
        return { sessionId: existing.id, seeded: false, ephemeral: false };
      }
    }

    const created = await input.client.createSession({ title: 'Atlas' });
    if (!input.conversationId) {
      return { sessionId: created.id, seeded: true, ephemeral: true };
    }

    this.deps.sessions.set({
      conversationId: input.conversationId,
      sessionId: created.id,
      directory: input.directory
    });
    return { sessionId: created.id, seeded: true, ephemeral: false };
  }

  /**
   * Drain the event stream into the translator. Stream failures are swallowed
   * on purpose: the prompt call is the source of truth for the turn, and a
   * dropped SSE connection must not lose an answer opencode already produced.
   */
  private async pumpEvents(
    client: OpenCodeAgentClient,
    translator: OpenCodeEventTranslator,
    signal: AbortSignal
  ): Promise<void> {
    try {
      for await (const event of client.subscribeEvents(signal)) {
        translator.handle(event);
        if (signal.aborted) {
          return;
        }
      }
    } catch {
      // Deltas are a nicety; the final message still arrives over HTTP.
    }
  }
}
