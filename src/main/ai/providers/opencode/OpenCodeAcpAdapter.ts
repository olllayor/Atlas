/**
 * `ProviderAdapter` over the ACP transport (`opencode acp` over stdio).
 *
 * Live behind `integrationMode: 'acp'`; the SDK adapter stays default. Same
 * user-visible contract: opencode runs its own tools, Atlas renders them, and
 * a turn resumes the conversation's session or recreates on confirmed miss.
 *
 * Deliberate slice limits (see `acp/acpClient.ts`):
 *
 * - text and file turns: images ride natively, text files embed, the rest
 *   degrade to path lines like the SDK fallback;
 * - tool approvals surface through `resolveApproval` with the SDK's one-shot
 *   semantics; the client only auto-denies when no turn is listening;
 * - a directory move forks the stored session into the new directory;
 * - switching integration modes orphans the other runtime's cursor safely:
 *   ids share one store, but a foreign id 404s on first use and recreates.
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
import { isAcpNotFound, AcpClient, type AcpPermissionAsk, type AcpPromptBlock, type AcpSessionInfo } from '../../acp/acpClient.js';
import {
  DEFAULT_OPENCODE_MODEL_CAPABILITIES,
  formatOpenCodeModelSlug,
  parseOpenCodeModelSlug
} from './inventory.js';
import { buildOpenCodePromptParts } from './openCodePrompt.js';
import { isSameOpenCodeDirectory, type OpenCodeSessionStore } from './OpenCodeAgentAdapter.js';
import {
  makeDefaultBinaryVersionReader,
  MIN_OPENCODE_VERSION,
  type OpenCodeProbeResult
} from './probeOpenCode.js';
import { compareOpenCodeVersions } from './openCodeParsers.js';

/** Structural slice of `AcpClient` a turn needs; fakes script this in tests. */
export interface AcpDriverClient {
  start(): Promise<unknown>;
  createSession(): Promise<AcpSessionInfo>;
  resumeSession(sessionId: string): Promise<AcpSessionInfo>;
  forkSession(sessionId: string, directory: string): Promise<AcpSessionInfo>;
  setModel(sessionId: string, value: string): Promise<AcpSessionInfo>;
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
}

export interface OpenCodeAcpAdapterDeps {
  readonly readSettings: () => OpenCodeSettings;
  /** One client per directory, owned and shut down by the controller. */
  readonly getClient: (directory: string) => AcpDriverClient;
  readonly sessions: OpenCodeSessionStore;
  readonly defaultDirectory: () => string;
}

function abortError(): Error {
  const error = new Error('The OpenCode turn was aborted.');
  error.name = 'AbortError';
  return error;
}

/** Split a `data:<mime>;base64,<payload>` URL; null for anything else. */
function parseDataUrl(url: string): { mime: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!match) {
    return null;
  }
  return { mime: match[1] ?? 'application/octet-stream', base64: match[2] ?? '' };
}

function toCatalogRows(session: AcpSessionInfo, customModels: readonly string[]): ModelSummary[] {
  const syncedAt = new Date().toISOString();
  const rows: ModelSummary[] = session.models.map((model) => ({
    id: model.value,
    providerId: OPENCODE_PROVIDER_ID,
    label: model.name,
    isFree: false,
    archived: false,
    lastSyncedAt: syncedAt,
    lastSeenFreeAt: null,
    reasoningEfforts: null,
    supportsTemperature: false,
    ...DEFAULT_OPENCODE_MODEL_CAPABILITIES
  }));
  const known = new Set(rows.map((row) => row.id));
  for (const raw of customModels) {
    const slug = parseOpenCodeModelSlug(raw);
    if (!slug) {
      continue;
    }
    const id = formatOpenCodeModelSlug(slug);
    if (known.has(id)) {
      continue;
    }
    known.add(id);
    rows.push({
      id,
      providerId: OPENCODE_PROVIDER_ID,
      label: slug.modelID,
      isFree: false,
      archived: false,
      lastSyncedAt: syncedAt,
      lastSeenFreeAt: null,
      reasoningEfforts: null,
      supportsTemperature: false,
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES
    });
  }
  return rows;
}

export class OpenCodeAcpAdapter implements ProviderAdapter {
  readonly providerId: ProviderId = OPENCODE_PROVIDER_ID;

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

  constructor(private readonly deps: OpenCodeAcpAdapterDeps) {}

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
      return toCatalogRows(session, settings.customModels);
    } finally {
      await client.closeSession(session.sessionId).catch(() => undefined);
    }
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
    const client = this.deps.getClient(directory);
    await client.start();

    let onAbort: (() => void) | null = null;
    let disposableSessionId: string | null = null;
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

      // Route permission asks into the turn so the UI can answer them instead
      // of the client auto-denying behind the turn's back.
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
          reason: 'OpenCode asked for tool permission.'
        });
      });

      // The model is selected per session: a resumed session may still point
      // at whatever the last turn chose, so every turn reasserts. An unknown
      // model fails loudly here rather than running on the server default.
      await client.setModel(sessionId, request.modelId);

      onAbort = () => {
        try {
          client.cancel(sessionId);
        } catch {
          // Local unwind continues regardless.
        }
      };
      if (request.signal.aborted) {
        throw abortError();
      }
      request.signal.addEventListener('abort', onAbort, { once: true });

      request.onNotice?.({
        code: 'opencode.toolsDelegated',
        level: 'info',
        message: 'OpenCode runs its own tools for this turn; Atlas shows them as they happen.'
      });

      const parts = buildOpenCodePromptParts({ messages: request.messages, seedHistory: seeded });
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
        throw abortError();
      }
      if (result.stopReason === 'cancelled') {
        throw abortError();
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
   * Resume rules, ACP edition: same-directory cursors resume cross-process
   * (verified live), confirmed misses recreate, anything else fails the turn.
   * A directory change forks the stored session there (verified live); a
   * forked 404 falls back to fresh, any other fork failure fails the turn.
   */
  private async resolveSession(input: {
    client: AcpDriverClient;
    conversationId: string | null;
    directory: string;
  }): Promise<{ sessionId: string; seeded: boolean; ephemeral: boolean }> {
    const stored = input.conversationId ? this.deps.sessions.get(input.conversationId) : null;

    if (stored && (await isSameOpenCodeDirectory(stored.directory, input.directory))) {
      try {
        const resumed = await input.client.resumeSession(stored.sessionId);
        return { sessionId: resumed.sessionId, seeded: false, ephemeral: false };
      } catch (error) {
        if (!isAcpNotFound(error)) {
          throw error;
        }
      }
    } else if (stored) {
      try {
        const forked = await input.client.forkSession(stored.sessionId, input.directory);
        if (input.conversationId) {
          this.deps.sessions.set({
            conversationId: input.conversationId,
            sessionId: forked.sessionId,
            directory: input.directory
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
      directory: input.directory
    });
    return { sessionId: created.sessionId, seeded: true, ephemeral: false };
  }
}

export interface ProbeOpenCodeAcpDeps {
  readonly readBinaryVersion?: (
    command: string
  ) => Promise<{ version: string | null; executableMissing: boolean }>;
  readonly createClient?: (directory: string) => {
    start(): Promise<unknown>;
    createSession(): Promise<AcpSessionInfo>;
    closeSession(sessionId: string): Promise<void>;
    shutdown(): Promise<void>;
  };
}

/**
 * "Test connection" for ACP mode: binary floor, then a real handshake plus a
 * throwaway session. Injectable like the SDK probe so tests stay offline.
 */
export async function probeOpenCodeAcp(input: {
  settings: OpenCodeSettings;
  directory: string;
  deps?: ProbeOpenCodeAcpDeps;
}): Promise<OpenCodeProbeResult> {
  const readBinaryVersion = input.deps?.readBinaryVersion ?? makeDefaultBinaryVersionReader();
  const binaryCommand = input.settings.binaryPath.trim() || 'opencode';
  const binary = await readBinaryVersion(binaryCommand);
  if (binary.executableMissing) {
    return {
      installed: false,
      version: null,
      status: 'error',
      auth: { status: 'unknown' },
      connectedProviders: [],
      modelCount: 0,
      message: 'OpenCode CLI (`opencode`) is not installed or not on PATH.'
    };
  }
  if (!binary.version) {
    return {
      installed: true,
      version: null,
      status: 'error',
      auth: { status: 'unknown' },
      connectedProviders: [],
      modelCount: 0,
      message: `Unable to determine OpenCode version from \`${binaryCommand} --version\`. Atlas requires OpenCode v${MIN_OPENCODE_VERSION} or newer.`
    };
  }
  if (compareOpenCodeVersions(binary.version, MIN_OPENCODE_VERSION) < 0) {
    return {
      installed: true,
      version: binary.version,
      status: 'error',
      auth: { status: 'unknown' },
      connectedProviders: [],
      modelCount: 0,
      message: `OpenCode v${binary.version} is too old. Upgrade to v${MIN_OPENCODE_VERSION} or newer.`
    };
  }

  const createClient =
    input.deps?.createClient ??
    ((directory: string) =>
      new AcpClient({
        cwd: directory,
        binaryPath: input.settings.binaryPath.trim() || undefined
      }));
  const client = createClient(input.directory);
  try {
    await client.start();
    const session = await client.createSession();
    try {
      return {
        installed: true,
        version: binary.version,
        status: 'ready',
        auth: { status: 'authenticated' },
        connectedProviders: [],
        modelCount: session.models.length,
        message: `${session.models.length} models available over ACP through OpenCode.`
      };
    } finally {
      await client.closeSession(session.sessionId).catch(() => undefined);
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause ?? '');
    if (/opencode auth login|not authenticated|not logged ?in|logged out/i.test(detail)) {
      return {
        installed: true,
        version: binary.version,
        status: 'warning',
        auth: { status: 'unknown' },
        connectedProviders: [],
        modelCount: 0,
        message: 'OpenCode is not signed in. Run `opencode auth login`, then test again.'
      };
    }
    return {
      installed: true,
      version: binary.version,
      status: 'error',
      auth: { status: 'unknown' },
      connectedProviders: [],
      modelCount: 0,
      message: detail || 'Failed to talk to OpenCode over ACP.'
    };
  } finally {
    await client.shutdown().catch(() => undefined);
  }
}
