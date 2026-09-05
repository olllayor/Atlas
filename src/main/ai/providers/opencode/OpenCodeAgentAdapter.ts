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
 * - **Sampling.** `session/prompt` accepts a model, an agent, a variant (for
 *   reasoning effort), a system prompt and parts — there is no temperature,
 *   output ceiling, or tool-choice on the wire. opencode applies its own config,
 *   so `request.temperature`, `maxOutputTokens`, and `toolChoice` have nowhere
 *   to go. `request.reasoningEffort` maps onto OpenCode's `variant` parameter
 *   (parity with pingdotgg/t3code PR #9287).
 *   The catalog reports `supportsTemperature: false`, while reasoning efforts
 *   are mapped to supported variants or synthesized standard levels.
 */

import { realpath } from 'node:fs/promises';

import type { ReasoningEffort } from '../../../../shared/chatParameters.js';
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
import { OPENCODE_SESSION_CURSOR_VERSION } from '../../../db/repositories/opencodeSessionsRepo.js';
import { isOpenCodeNotFound } from './OpenCodeAgentClient.js';
import { flattenOpenCodeModels, parseOpenCodeModelSlug } from './inventory.js';
import {
  buildOpenCodePermissionRules,
  toOpenCodeQuestionAnswers,
  type OpenCodeNormalizedQuestion
} from './openCodeParsers.js';
import { OpenCodeEventTranslator, isOpenCodeChildRequestEvent } from './openCodeEvents.js';
import { buildOpenCodePromptParts } from './openCodePrompt.js';

/** Where a turn's opencode session id is remembered between runs. */
export interface OpenCodeSessionStore {
  get(conversationId: string): {
    sessionId: string;
    directory: string;
    schemaVersion?: number;
    transport?: 'sdk' | 'acp';
  } | null;
  set(input: {
    conversationId: string;
    sessionId: string;
    directory: string;
    transport: 'sdk' | 'acp';
  }): void;
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

/**
 * Maps Atlas' unified reasoning effort onto OpenCode's `variant` wire field.
 * Blueprint: pingdotgg/t3code PR #9287 and OpenCodeAdapter.ts variant resolution.
 */
export function toOpenCodeVariant(effort?: ReasoningEffort | null): string | undefined {
  if (!effort || effort === 'off') {
    return undefined;
  }
  switch (effort) {
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
    case 'on':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
    case 'max':
      return 'xhigh';
    default:
      return undefined;
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
    {
      type: 'permission' | 'question';
      client: OpenCodeAgentClient;
      questions?: readonly OpenCodeNormalizedQuestion[];
      settled: boolean;
      notifyResolved?: () => void;
    }
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

    if (pending.type === 'question') {
      if (decision === 'deny') {
        await pending.client.rejectQuestion({ requestId: approvalId });
      } else {
        const answers = (pending.questions ?? []).map((q) =>
          q.options[0]?.label ? [q.options[0].label] : []
        );
        await pending.client.replyToQuestion({ requestId: approvalId, answers });
      }
    } else {
      await pending.client.replyToPermission({
        requestId: approvalId,
        reply: toOpenCodePermissionReply(decision)
      });
    }
  }

  async respondToQuestion(approvalId: string, answers: Record<string, unknown>): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending || pending.settled) {
      return;
    }
    pending.settled = true;
    this.pendingApprovals.delete(approvalId);
    pending.notifyResolved?.();
    const questionAnswers = toOpenCodeQuestionAnswers(pending.questions ?? [], answers);
    await pending.client.replyToQuestion({ requestId: approvalId, answers: questionAnswers });
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
    const toolPermissionMode =
      (request.toolPermissionMode as string | undefined) ??
      (request.agentContext?.toolPermissionMode as string | undefined) ??
      null;
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
        directory,
        toolPermissionMode
      });
      // A context-less call (title, summary) has no conversation to resume
      // into, so its session is scratch and must not pile up in opencode's
      // own history.
      if (ephemeral) {
        disposableSessionId = sessionId;
      }

      // Abort ordering copied from t3: tell opencode first (best effort), then
      // let the local event stream unwind. Abort parent and all child sessions (PR #9005).
      onAbort = () => {
        void this.abortSessionAndDescendants(sessionId, client);
        streamAbort.abort();
      };
      if (request.signal.aborted) {
        void this.abortSessionAndDescendants(sessionId, client);
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
          if (toolPermissionMode === 'full-access') {
            // Question asks arrive here too (the translator emits both
            // onQuestionRequested and onToolApprovalRequested for them, in
            // that order, so the question entry already exists). Answering a
            // question over the permission wire would 400/stall, and leaving
            // the question entry behind would leak it past the turn.
            const questionPending = this.pendingApprovals.get(event.approvalId);
            if (questionPending?.type === 'question') {
              this.pendingApprovals.delete(event.approvalId);
              questionPending.notifyResolved?.();
              const answers = (questionPending.questions ?? []).map((q) =>
                q.options[0]?.label ? [q.options[0].label] : []
              );
              void client
                .replyToQuestion({ requestId: event.approvalId, answers })
                .catch(() => {});
              return;
            }
            void client.replyToPermission({ requestId: event.approvalId, reply: 'once' }).catch(() => {});
            return;
          }
          raisedApprovals.add(event.approvalId);
          if (!this.pendingApprovals.has(event.approvalId)) {
            this.pendingApprovals.set(event.approvalId, {
              type: 'permission',
              client,
              settled: false,
              ...(request.onToolApprovalResolved
                ? { notifyResolved: () => request.onToolApprovalResolved?.({ approvalId: event.approvalId }) }
                : {})
            });
          }
          request.onToolApprovalRequested?.(event);
        },
        onQuestionRequested: (event) => {
          raisedApprovals.add(event.approvalId);
          this.pendingApprovals.set(event.approvalId, {
            type: 'question',
            client,
            questions: event.questions,
            settled: false,
            ...(request.onToolApprovalResolved
              ? { notifyResolved: () => request.onToolApprovalResolved?.({ approvalId: event.approvalId }) }
              : {})
          });
        },
        onToolApprovalResolved: (event) => {
          this.pendingApprovals.delete(event.approvalId);
          request.onToolApprovalResolved?.(event);
        },
        ...(request.onNotice ? { onNotice: request.onNotice } : {})
      });

      await this.recoverPendingRequests(client, sessionId, translator);

      const pump = this.pumpEvents(client, translator, streamAbort.signal, sessionId);

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

      const variant = toOpenCodeVariant(request.reasoningEffort);

      const promptResult = await client.prompt({
        sessionId,
        model: { providerID: slug.providerID, modelID: slug.modelID },
        parts,
        ...(variant ? { variant } : {}),
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
    toolPermissionMode?: string | null;
  }): Promise<{ sessionId: string; seeded: boolean; ephemeral: boolean }> {
    const stored = input.conversationId ? this.deps.sessions.get(input.conversationId) : null;
    // A cursor from the other transport is a miss: both runtimes share
    // opencode's session storage, so a foreign id would resolve live into the
    // wrong runtime (verified: an SDK session resumes over ACP).
    const usable =
      stored &&
      (stored.schemaVersion ?? OPENCODE_SESSION_CURSOR_VERSION) === OPENCODE_SESSION_CURSOR_VERSION &&
      (stored.transport ?? 'sdk') === 'sdk'
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
              directory: input.directory,
              transport: 'sdk'
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

    const permission = buildOpenCodePermissionRules(input.toolPermissionMode);
    const created = await input.client.createSession({ title: 'Atlas', permission });
    if (!input.conversationId) {
      return { sessionId: created.id, seeded: true, ephemeral: true };
    }

    this.deps.sessions.set({
      conversationId: input.conversationId,
      sessionId: created.id,
      directory: input.directory,
      transport: 'sdk'
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
    signal: AbortSignal,
    rootSessionId: string
  ): Promise<unknown> {
    try {
      for await (const event of client.subscribeEvents(signal)) {
        const record = typeof event === "object" && event !== null ? (event as Record<string, unknown>) : null;
        const type = typeof record?.type === "string" ? record.type : "";
        const props = typeof record?.properties === "object" && record.properties !== null
          ? (record.properties as Record<string, unknown>)
          : null;
        const sid = typeof props?.sessionID === "string" ? props.sessionID : null;

        if (sid && !translator.isRelatedSession(sid) && isOpenCodeChildRequestEvent(type)) {
          const isRelated = await this.verifySessionAncestry(sid, rootSessionId, client);
          if (isRelated) {
            translator.addRelatedSessionId(sid);
          }
        }

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

  private async verifySessionAncestry(
    candidateSessionId: string,
    rootSessionId: string,
    client: OpenCodeAgentClient
  ): Promise<boolean> {
    let current: string | undefined = candidateSessionId;
    const seen = new Set<string>();

    for (let depth = 0; current !== undefined && depth < 32; depth++) {
      if (current === rootSessionId) {
        return true;
      }
      if (seen.has(current)) {
        return false;
      }
      seen.add(current);
      try {
        const session = await client.getSession(current);
        if (!session) return false;
        current = session.parentID;
      } catch {
        return false;
      }
    }
    return false;
  }

  private async recoverPendingRequests(
    client: OpenCodeAgentClient,
    sessionId: string,
    translator: OpenCodeEventTranslator
  ): Promise<void> {
    try {
      const [questions, permissions, children] = await Promise.all([
        client.listQuestions ? client.listQuestions().catch(() => []) : Promise.resolve([]),
        client.listPermissions ? client.listPermissions().catch(() => []) : Promise.resolve([]),
        client.listChildren ? client.listChildren(sessionId).catch(() => []) : Promise.resolve([])
      ]);
      for (const child of children) {
        translator.addRelatedSessionId(child.id);
      }

      for (const question of questions) {
        const sid = typeof question.sessionID === 'string' ? question.sessionID : null;
        if (sid && (translator.isRelatedSession(sid) || (await this.verifySessionAncestry(sid, sessionId, client)))) {
          translator.addRelatedSessionId(sid);
          translator.handle({
            type: 'question.asked',
            properties: question
          });
        }
      }
      for (const permission of permissions) {
        const sid = typeof permission.sessionID === 'string' ? permission.sessionID : null;
        if (sid && (translator.isRelatedSession(sid) || (await this.verifySessionAncestry(sid, sessionId, client)))) {
          translator.addRelatedSessionId(sid);
          translator.handle({
            type: 'permission.asked',
            properties: permission
          });
        }
      }
    } catch {
      // Best-effort recovery on reconnect
    }
  }

  /**
   * Stop an OpenCode session and all its child sessions (t3code PR #9005).
   * Subagents spawned via OpenCode's `task` tool run as child sessions.
   * Stopping only the parent would leave subagents spinning in the background.
   */
  private async abortSessionAndDescendants(sessionId: string, client: OpenCodeAgentClient): Promise<void> {
    try {
      await client.abort(sessionId);
    } catch (error) {
      if (!isOpenCodeNotFound(error)) {
        console.warn(`[opencode] failed to abort session ${sessionId}:`, error);
      }
    }
    if (!client.listChildren) return;
    const visited = new Set<string>([sessionId]);

    const visit = async (id: string, shouldAbort: boolean): Promise<void> => {
      if (shouldAbort) {
        try {
          await client.abort(id);
        } catch (error) {
          if (!isOpenCodeNotFound(error)) {
            console.warn(`[opencode] failed to abort child session ${id}:`, error);
          }
        }
      }

      let children: Array<{ id: string }> = [];
      try {
        children = await client.listChildren!(id);
      } catch (error) {
        if (!isOpenCodeNotFound(error)) {
          console.warn(`[opencode] failed to list children for session ${id}:`, error);
        }
      }

      const unvisited = children.filter((child) => !visited.has(child.id));
      for (const child of unvisited) {
        visited.add(child.id);
      }

      await Promise.all(unvisited.map((child) => visit(child.id, true)));
    };

    await visit(sessionId, false);
  }

}
