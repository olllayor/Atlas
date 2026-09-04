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

import { realpath } from 'node:fs/promises';

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
import { isOpenCodeNotFound } from './OpenCodeAgentClient.js';
import { flattenOpenCodeModels, parseOpenCodeModelSlug } from './inventory.js';
import { OpenCodeEventTranslator } from './openCodeEvents.js';
import { buildOpenCodePromptParts } from './openCodePrompt.js';

/** Cursor shape version this adapter understands (mirrors the repo stamp). */
export const OPENCODE_SESSION_CURSOR_VERSION = 1;

/** Where a turn's opencode session id is remembered between runs. */
export interface OpenCodeSessionStore {
  get(conversationId: string): {
    sessionId: string;
    directory: string;
    schemaVersion?: number;
  } | null;
  set(input: { conversationId: string; sessionId: string; directory: string }): void;
  clear(conversationId: string): void;
}

/**
 * Same directory by eye or by filesystem: lexical compare plus realpath, so a
 * trailing slash or a macOS `/tmp` symlink never reads as a project move.
 * Realpath failures fall back to lexical — a stat hiccup must not fork a chat.
 */
export async function isSameOpenCodeDirectory(left: string, right: string): Promise<boolean> {
  if (left === right) {
    return true;
  }
  try {
    const [resolvedLeft, resolvedRight] = await Promise.all([realpath(left), realpath(right)]);
    return resolvedLeft === resolvedRight;
  } catch {
    return left.replace(/\/+$/, '') === right.replace(/\/+$/, '');
  }
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
  readonly connect: (settings: OpenCodeSettings, serverPassword?: string | null) => Promise<{
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

/** Turn an SSE failure into a turn error users can act on. */
function describeOpenCodeStreamError(streamError: unknown): Error {
  const text = streamError instanceof Error ? streamError.message : String(streamError ?? '');
  if (/401|403|unauthorized|forbidden/i.test(text)) {
    return new Error(
      'The OpenCode event stream rejected authentication. Check the saved server password in Settings, then retry the turn.'
    );
  }
  return new Error(
    text.trim().length > 0
      ? `The OpenCode event stream failed and no answer arrived (${text.trim().slice(0, 200)}).`
      : 'The OpenCode event stream failed and no answer arrived.'
  );
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

  /**
   * Permission asks awaiting a decision, keyed by opencode's request id.
   * Entries are dropped when answered, and otherwise when the turn that raised
   * them ends — the map must not outlive the turns it describes.
   */
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
    // Every ask this turn raised, so the ones the user never answered (abort,
    // failure, a server that moved on) leave with it instead of pinning a
    // client in the map for the rest of the app's life.
    const raisedApprovals = new Set<string>();

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
          raisedApprovals.add(event.approvalId);
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
      const streamError = await pump;

      if (request.signal.aborted || translator.wasAborted) {
        throw abortError();
      }

      const failure = promptResult.errorText ?? translator.errorText;
      if (failure) {
        throw new Error(failure);
      }

      const content = translator.assistantText || promptResult.text;
      const reasoning = translator.assistantReasoning || promptResult.reasoning;
      // The prompt call is the source of truth, so a dropped SSE connection
      // with a good answer still succeeds. But a dead stream plus an empty
      // answer used to return an empty success — surface the stream failure
      // instead, with keychain guidance when it smells like auth.
      if (!content && !reasoning && streamError) {
        throw describeOpenCodeStreamError(streamError);
      }

      const tokens = promptResult.tokens ?? {};
      const cacheRead = tokens.cacheRead;

      return {
        // Streamed text is authoritative; the final message is the fallback for
        // a server that reported no deltas at all. `ChatSessionRuntime` ranks
        // the same way one level up (`getTextContentFromParts(result.parts) ||
        // result.content`), so this only ever decides a turn that streamed
        // nothing.
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
      for (const approvalId of raisedApprovals) {
        this.pendingApprovals.delete(approvalId);
      }
      if (disposableSessionId) {
        await client.deleteSession(disposableSessionId).catch(() => undefined);
      }
      release();
    }
  }

  private async openClient(directory: string) {
    // Read the password before connecting: the runtime needs it to set (or
    // strip) OPENCODE_SERVER_PASSWORD on the child, and the client needs the
    // same value for Basic auth. Connecting first used to inherit a host
    // password the client never sent, 401ing our own spawn.
    const serverPassword = await this.deps.readServerPassword();
    const connection = await this.deps.connect(this.deps.readSettings(), serverPassword);

    try {
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
   * Resume rules:
   *
   * - a stored session in the same directory resumes as-is;
   * - a *confirmed* miss (opencode says 404) silently recreates — any other
   *   failure fails the turn, so a server hiccup never looks like a fresh chat;
   * - a directory change forks the stored session there, preserving history —
   *   a forked 404 falls back to fresh, any other fork failure fails the turn;
   * - an unknown cursor version is ignored, never resumed into the wrong chat.
   */
  private async resolveSession(input: {
    client: OpenCodeAgentClient;
    conversationId: string | null;
    directory: string;
  }): Promise<{ sessionId: string; seeded: boolean; ephemeral: boolean }> {
    const stored = input.conversationId ? this.deps.sessions.get(input.conversationId) : null;
    const usable =
      stored && (stored.schemaVersion ?? OPENCODE_SESSION_CURSOR_VERSION) === OPENCODE_SESSION_CURSOR_VERSION
        ? stored
        : null;

    if (usable && (await isSameOpenCodeDirectory(usable.directory, input.directory))) {
      const existing = await input.client.getSession(usable.sessionId);
      if (existing) {
        return { sessionId: existing.id, seeded: false, ephemeral: false };
      }
    } else if (usable) {
      const existing = await input.client.getSession(usable.sessionId);
      if (existing) {
        try {
          const forked = await input.client.forkSession({
            sessionId: usable.sessionId,
            directory: input.directory
          });
          if (input.conversationId) {
            this.deps.sessions.set({
              conversationId: input.conversationId,
              sessionId: forked.id,
              directory: input.directory
            });
          }
          return { sessionId: forked.id, seeded: false, ephemeral: false };
        } catch (error) {
          if (!isOpenCodeNotFound(error)) {
            throw error;
          }
          // Forked 404: the source vanished mid-move. Fall through to fresh.
        }
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
   * Drain the event stream into the translator. Returns the first stream
   * failure (or null) instead of swallowing it: the caller decides — a good
   * prompt answer wins over a dropped SSE connection, but an empty answer
   * plus a dead stream must fail loudly rather than return empty success.
   */
  private async pumpEvents(
    client: OpenCodeAgentClient,
    translator: OpenCodeEventTranslator,
    signal: AbortSignal
  ): Promise<unknown> {
    try {
      for await (const event of client.subscribeEvents(signal)) {
        translator.handle(event);
        if (signal.aborted) {
          return null;
        }
      }
    } catch (error) {
      return error;
    }
    return null;
  }
}
