/**
 * Minimal Agent Client Protocol driver over stdio — Atlas' ACP spike.
 *
 * Speaks NDJSON JSON-RPC to `opencode acp` (verified live against 1.18.27):
 * `initialize`, `session/new`, `session/prompt`, `session/cancel` as an
 * id-less notification, `session/close`. Answers the agent's `fs/read_text_file`
 * inside one workspace root and denies everything else by default.
 *
 * Status: experimental, not wired into `OpenCodeController`. The V1 SDK driver
 * stays the only production path until this graduates. Deliberate limits:
 *
 * - `fs/write_text_file` and `terminal/*` are denied, not implemented;
 * - permission asks resolve to the offered reject option, never allow, unless
 *   a turn installed a handler via `setPermissionHandler`;
 * - no `session/get`: existence is proven by `resume`/`fork`, whose 404 means
 *   a confirmed miss.
 *
 * Blueprint: pingdotgg/t3code `packages/effect-acp` (framing, sliding update
 * buffer, termination failing pending calls), ported to plain TS per Atlas
 * convention: injectable child factory, zero real processes under tests.
 */

import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { normalize, resolve, sep } from 'node:path';

export const ACP_PROTOCOL_VERSION = 1;
const CLIENT_NAME = 'atlas';
const MAX_BUFFERED_UPDATES = 32;
const DEFAULT_SPAWN_TIMEOUT_MS = 10_000;
/** Mirror of the SDK driver's per-file ceiling: bigger files travel as paths. */
const MAX_FILE_BYTES = 20_000_000;
/**
 * Framing guard: one JSON-RPC line bigger than this is pathology, not
 * protocol — a runaway agent streaming megabytes without a newline would
 * otherwise grow `buffer` without bound until the main process OOMs. Failing
 * the client is loud and recoverable (the turn errors, the user retries);
 * silently accumulating is neither.
 */
const MAX_BUFFERED_LINE_BYTES = 16_777_216;

export class AcpError extends Error {
  constructor(
    public readonly operation: string,
    message: string,
    public readonly method?: string,
    public readonly requestId?: number,
    public readonly cause?: unknown,
    public readonly code?: number,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = 'AcpError';
  }
}

/**
 * A miss means "that session is gone". JSON-RPC code first — prose is a
 * fallback, since agents may reword the message while keeping the code.
 */
export function isAcpNotFound(error: unknown): boolean {
  if (error instanceof AcpError && error.code !== undefined) {
    if (error.code === 404) {
      return true;
    }
    const dataText = JSON.stringify(error.data ?? '').toLowerCase();
    if (/\b404\b/.test(dataText) || /not ?found/.test(dataText)) {
      return true;
    }
  }
  const text = error instanceof Error ? error.message : String(error ?? '');
  return /\b404\b/.test(text) || /not ?found/i.test(text);
}

export interface AcpModelOption {
  readonly value: string;
  readonly name: string;
}

export interface AcpSessionInfo {
  readonly sessionId: string;
  readonly models: readonly AcpModelOption[];
  readonly currentModel: string | null;
}

export interface AcpUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedReadTokens?: number;
}

export interface AcpPromptResult {
  readonly stopReason: string;
  readonly text: string;
  readonly thought: string;
  readonly usage: AcpUsage;
}

export interface AcpPermissionOption {
  readonly optionId: string;
  readonly kind: string;
  readonly name: string;
}

export interface AcpPermissionAsk {
  readonly approvalId: string;
  readonly toolCallId: string | null;
  readonly title?: string;
  readonly options: readonly AcpPermissionOption[];
}

export type AcpPermissionDecision = 'approve' | 'approve_always' | 'deny';

export type AcpSessionUpdate =
  | {
      readonly sessionId: string;
      readonly kind: 'agent_message_chunk' | 'agent_thought_chunk';
      readonly text?: string;
    }
  | {
      readonly sessionId: string;
      readonly kind: 'tool_call' | 'tool_call_update';
      readonly toolCallId: string;
      readonly title?: string;
      readonly toolKind?: string;
      readonly status?: string;
      readonly input?: unknown;
      readonly outputText?: string;
      readonly errorText?: string;
    }
  | { readonly sessionId: string; readonly kind: 'unknown'; readonly rawKind: string };

export type AcpPromptBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'file'; readonly mime: string; readonly path: string }
  | { readonly type: 'file-bytes'; readonly mime: string; readonly base64: string; readonly name?: string };

export interface AcpSkippedFile {
  readonly path: string;
  readonly reason: string;
}

type ChildFactory = (
  command: string,
  args: readonly string[],
  options: {
    stdio: ['pipe', 'pipe', 'pipe'];
    env?: NodeJS.ProcessEnv;
    windowsHide?: boolean;
    detached?: boolean;
    shell?: boolean;
    cwd?: string;
  }
) => ChildProcess;

export interface AcpClientOptions {
  /** Workspace the agent runs in; also the root `fs/read_text_file` may touch. */
  readonly cwd: string;
  readonly binaryPath?: string;
  /** Appended after the `acp` subcommand, before `--cwd`. */
  readonly extraArgs?: readonly string[];
  /**
   * Full argv, replacing the default `['acp', ...extraArgs, '--cwd', cwd]`.
   *
   * opencode speaks ACP behind its own `acp` subcommand; a bridge like
   * `claude-code-acp` *is* the ACP server and takes neither. `session/new`
   * carries the working directory either way, so the flag is not load-bearing.
   */
  readonly spawnArgs?: readonly string[];
  /** Run the child in `cwd` instead of inheriting the app's directory. */
  readonly spawnCwd?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly spawnTimeoutMs?: number;
  readonly childFactory?: ChildFactory;
  readonly readTextFile?: (path: string) => Promise<string>;
  readonly readFileBytes?: (path: string) => Promise<Buffer>;
  readonly logger?: (direction: 'in' | 'out', payload: unknown) => void;
  /**
   * Sink for tool permission asks. When set, asks wait for `resolvePermission`;
   * when absent, every ask auto-denies. Either way the turn never hangs.
   */
  readonly onPermissionRequest?: (ask: AcpPermissionAsk) => void;
  /**
   * Fired once when the child exits. Owners use it to evict the client so the
   * next use spawns fresh instead of throwing a cached death forever.
   */
  readonly onExit?: () => void;
  /** Extra sink for every session update, besides the prompt collector. */
  readonly onSessionUpdate?: (update: AcpSessionUpdate) => void;
}

interface Pending {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function contentText(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const texts = value
    .map(asRecord)
    .filter((entry) => entry.type === 'content')
    .map((entry) => asString(asRecord(entry.content).text))
    .filter((text): text is string => text !== undefined);
  return texts.length > 0 ? texts.join('\n') : undefined;
}


/**
 * Cap tool output text stream chunks to 8,000 characters tail (t3code pattern).
 * Interactive CLI tools that re-stream full progress bars or terminal output
 * on every update can easily flood the IPC pipe and UI state without this bound.
 */
export const MAX_ACP_TOOL_OUTPUT_CHARS = 8_000;

export function boundToolOutput(text: string | undefined): string | undefined {
  if (text === undefined || text.length <= MAX_ACP_TOOL_OUTPUT_CHARS) {
    return text;
  }
  return "[Earlier output truncated]\n\n" + text.slice(-MAX_ACP_TOOL_OUTPUT_CHARS);
}

function nonEmptyRecord(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  return Object.keys(record).length > 0 ? record : undefined;
}

function parseSessionUpdate(params: unknown): AcpSessionUpdate | null {
  const record = asRecord(params);
  const sessionId = asString(record.sessionId);
  const update = asRecord(record.update);
  const kind = asString(update.sessionUpdate);
  if (!sessionId || !kind) {
    return null;
  }
  if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
    const content = asRecord(update.content);
    const text = asString(content.text);
    return { sessionId, kind, ...(text !== undefined ? { text } : {}) };
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const toolCallId = asString(update.toolCallId);
    if (!toolCallId) {
      return null;
    }
    const title = asString(update.title);
    const toolKind = asString(update.kind);
    const status = asString(update.status);
    const input = nonEmptyRecord(update.rawInput);
    const output = asRecord(update.rawOutput);
    const text = contentText(update.content);
    const outputText = boundToolOutput(text ?? asString(output.output));
    const rawError = asString(output.error);
    return {
      sessionId,
      kind,
      toolCallId,
      ...(title !== undefined ? { title } : {}),
      ...(toolKind !== undefined ? { toolKind } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(input !== undefined ? { input } : {}),
      ...(outputText !== undefined ? { outputText } : {}),
      ...(status === 'failed'
        ? { errorText: rawError ?? outputText ?? 'The tool failed without reporting a reason.' }
        : {})
    };
  }
  return { sessionId, kind: 'unknown', rawKind: kind };
}

function parsePermissionRequest(params: unknown): {
  toolCallId: string | null;
  title?: string;
  options: AcpPermissionOption[];
} | null {
  const record = asRecord(params);
  if (!asString(record.sessionId)) {
    return null;
  }
  const toolCall = asRecord(record.toolCall);
  const options = Array.isArray(record.options)
    ? record.options
        .map(asRecord)
        .filter((option) => typeof option.optionId === 'string')
        .map((option) => ({
          optionId: option.optionId as string,
          kind: typeof option.kind === 'string' ? option.kind : '',
          name: typeof option.name === 'string' ? option.name : ''
        }))
    : [];
  const title = asString(toolCall.title);
  return {
    toolCallId: asString(toolCall.toolCallId) ?? null,
    ...(title !== undefined ? { title } : {}),
    options
  };
}

/** The offered option matching the decision wins; deny falls back to cancel. */
function permissionReply(
  options: readonly AcpPermissionOption[],
  decision: AcpPermissionDecision
): unknown {
  if (decision === 'deny') {
    const reject =
      options.find((option) => option.kind === 'reject_once') ??
      options.find((option) => option.kind.startsWith('reject'));
    if (reject) {
      return { outcome: { outcome: 'selected', optionId: reject.optionId } };
    }
    return { outcome: { outcome: 'cancelled' } };
  }
  const allow =
    (decision === 'approve_always'
      ? options.find((option) => option.kind === 'allow_always')
      : undefined) ??
    options.find((option) => option.kind === 'allow_once') ??
    options.find((option) => option.kind.startsWith('allow'));
  if (allow) {
    return { outcome: { outcome: 'selected', optionId: allow.optionId } };
  }
  return permissionReply(options, 'deny');
}

export class AcpClient {
  private child: ChildProcess | null = null;
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private dead: AcpError | null = null;
  /** In-flight turns by session: JSON-RPC ids already disambiguate the wire. */
  private readonly activePrompts = new Set<string>();
  private readonly promptAccum = new Map<string, { text: string; thought: string }>();
  private readonly updateHandlers: Array<(update: AcpSessionUpdate) => void> = [];
  private readonly updateBacklog: AcpSessionUpdate[] = [];
  private stderrTail = '';
  private exitFired = false;

  private readonly binaryPath: string;
  private readonly extraArgs: readonly string[];
  private readonly spawnArgs: readonly string[] | null;
  private readonly spawnCwd: boolean;
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly spawnTimeoutMs: number;
  private readonly childFactory: ChildFactory;
  private readonly readTextFile: (path: string) => Promise<string>;
  private readonly readFileBytes: (path: string) => Promise<Buffer>;
  private permissionHandler: ((ask: AcpPermissionAsk) => void) | null = null;
  private readonly permissionPending = new Map<
    string,
    { id: number; options: AcpPermissionOption[]; sessionId: string }
  >();
  private readonly logger?: (direction: 'in' | 'out', payload: unknown) => void;
  private readonly onExit?: () => void;
  private readonly fsRoot: string;

  capabilities: unknown = null;
  authMethods: unknown = null;

  constructor(options: AcpClientOptions) {
    this.cwd = options.cwd;
    this.binaryPath = options.binaryPath?.trim() || 'opencode';
    this.extraArgs = options.extraArgs ?? [];
    this.spawnArgs = options.spawnArgs ?? null;
    this.spawnCwd = options.spawnCwd ?? false;
    this.env = options.env;
    this.spawnTimeoutMs = options.spawnTimeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS;
    this.childFactory =
      options.childFactory ?? ((command, args, opts) => defaultSpawn(command, [...args], opts));
    this.readTextFile = options.readTextFile ?? ((path) => readFile(path, 'utf8'));
    this.readFileBytes = options.readFileBytes ?? ((path) => readFile(path));
    this.permissionHandler = options.onPermissionRequest ?? null;
    this.logger = options.logger;
    this.onExit = options.onExit;
    if (options.onSessionUpdate) {
      this.updateHandlers.push(options.onSessionUpdate);
    }
    this.fsRoot = resolve(normalize(options.cwd)) + sep;
  }

  get started(): boolean {
    return this.child !== null;
  }

  /** True while any prompt is in flight; owners use it to defer idle reaps. */
  hasInflight(): boolean {
    return this.activePrompts.size > 0;
  }

  /** Last stretch of agent stderr: protocol travels on stdout, but failures
   * explain themselves on stderr. Bounded, safe to attach to errors. */
  getStderrTail(): string {
    return this.stderrTail;
  }

  /**
   * Register an update sink; replays whatever arrived before registering.
   * Returns an unsubscribe for per-turn sinks so they never outlive the turn.
   */
  handleSessionUpdate(handler: (update: AcpSessionUpdate) => void): () => void {
    this.updateHandlers.push(handler);
    const backlog = this.updateBacklog.splice(0, this.updateBacklog.length);
    for (const update of backlog) {
      handler(update);
    }
    return () => {
      const index = this.updateHandlers.indexOf(handler);
      if (index >= 0) {
        this.updateHandlers.splice(index, 1);
      }
    };
  }

  /** Spawn `opencode acp` and finish the `initialize` handshake. */
  async start(): Promise<{ capabilities: unknown; authMethods: unknown }> {
    if (this.child) {
      return { capabilities: this.capabilities, authMethods: this.authMethods };
    }
    const isWindows = process.platform === 'win32';
    const args = this.spawnArgs ?? ['acp', ...this.extraArgs, '--cwd', this.cwd];
    const child = this.childFactory(this.binaryPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(this.spawnCwd ? { cwd: this.cwd } : {}),
      // Own process group on POSIX so shutdown can signal the whole tree
      // without touching Atlas itself (mirrors OpenCodeRuntime).
      detached: !isWindows,
      windowsHide: true,
      shell: isWindows,
      ...(this.env ? { env: this.env } : {})
    });
    this.child = child;
    // A respawn starts clean: a cached death must never poison the new child.
    this.dead = null;
    this.buffer = '';
    this.stderrTail = '';
    this.exitFired = false;

    child.stdout?.on('data', (chunk: Buffer | string) => {
      void this.onStdout(chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4096);
    });
    // A spawn that never happens (bad binary path, missing ACP bridge) emits
    // `error` and no `exit`. Unhandled, that is an uncaught exception in the
    // main process — a mistyped path must fail this call, not the app.
    child.once('error', (error: NodeJS.ErrnoException) => {
      const missing = error.code === 'ENOENT';
      this.failAll(
        new AcpError(
          'transport',
          missing
            ? `The ACP agent could not be started: ${this.binaryPath} was not found.`
            : `The ACP agent could not be started: ${error.message}`,
          undefined,
          undefined,
          error
        )
      );
      this.child = null;
      if (!this.exitFired) {
        this.exitFired = true;
        try {
          this.onExit?.();
        } catch {
          // Eviction must never throw into the failure handler.
        }
      }
    });

    child.once('exit', (code, signal) => {
      const tail = this.stderrTail.trim();
      this.failAll(
        new AcpError(
          'transport',
          `The ACP agent exited (code=${code ?? 'null'} signal=${signal ?? 'null'})` +
            (tail ? `: ${tail.slice(-300)}` : '.')
        )
      );
      this.child = null;
      if (!this.exitFired) {
        this.exitFired = true;
        try {
          this.onExit?.();
        } catch {
          // Eviction must never throw into the exit handler.
        }
      }
    });

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new AcpError(
              'initialize',
              `Timed out after ${this.spawnTimeoutMs}ms waiting for the ACP handshake.`
            )
          ),
        this.spawnTimeoutMs
      );
    });

    try {
      const result = (await Promise.race([
        this.request('initialize', {
          protocolVersion: ACP_PROTOCOL_VERSION,
          // Honest advertisement: reads are served, writes and terminals are
          // denied until implemented. The agent executes its own tools
          // natively (permission-gated); these flags only cover client-side
          // execution, which must not be promised and then refused mid-turn.
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: false },
            terminal: false
          },
          clientInfo: { name: CLIENT_NAME, version: '0.0.0' }
        }),
        timeout
      ])) as Record<string, unknown>;
      this.capabilities = (result as { agentCapabilities?: unknown }).agentCapabilities ?? null;
      this.authMethods = (result as { authMethods?: unknown }).authMethods ?? null;
      return { capabilities: this.capabilities, authMethods: this.authMethods };
    } catch (error) {
      await this.shutdown().catch(() => undefined);
      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /** Open a session; the response carries the model catalog as config options. */
  async createSession(): Promise<AcpSessionInfo> {
    const result = (await this.request('session/new', {
      cwd: this.cwd,
      mcpServers: []
    })) as Record<string, unknown>;
    return this.parseSessionInfo('session/new', result);
  }

  /**
   * Re-attach to a session owned by an earlier process. Verified live:
   * history survives across processes, response carries config options.
   */
  async resumeSession(sessionId: string): Promise<AcpSessionInfo> {
    const result = (await this.request('session/resume', {
      sessionId,
      cwd: this.cwd
    })) as Record<string, unknown>;
    return this.parseSessionInfo('session/resume', result, sessionId);
  }

  /**
   * Fork a session into a new directory carrying its history. Verified live:
   * `session/fork {sessionId, cwd}` answers with the new session plus config
   * options, and the fork recalls the source transcript.
   */
  async forkSession(sessionId: string, directory: string): Promise<AcpSessionInfo> {
    const result = (await this.request('session/fork', {
      sessionId,
      cwd: directory
    })) as Record<string, unknown>;
    return this.parseSessionInfo('session/fork', result);
  }

  /**
   * Select the session model. Verified live: `{configId: 'model'}` answers
   * with fresh config options. Unknown ids fail loudly, never silently.
   */
  async setModel(sessionId: string, value: string): Promise<AcpSessionInfo> {
    const result = (await this.request('session/set_config_option', {
      sessionId,
      configId: 'model',
      value
    })) as Record<string, unknown>;
    return this.parseSessionInfo('session/set_config_option', result, sessionId);
  }

  private parseSessionInfo(
    operation: string,
    result: Record<string, unknown>,
    fallbackSessionId?: string
  ): AcpSessionInfo {
    const sessionId = asString(result.sessionId) ?? fallbackSessionId;
    if (!sessionId) {
      throw new AcpError(operation, 'The ACP agent did not return a session id.');
    }
    const models: AcpModelOption[] = [];
    let currentModel: string | null = null;
    for (const entry of Array.isArray(result.configOptions) ? result.configOptions : []) {
      const option = asRecord(entry);
      if (option.id !== 'model' || !Array.isArray(option.options)) {
        continue;
      }
      if (typeof option.currentValue === 'string') {
        currentModel = option.currentValue;
      }
      for (const model of option.options) {
        const record = asRecord(model);
        if (typeof record.value === 'string') {
          models.push({
            value: record.value,
            name: typeof record.name === 'string' ? record.name : record.value
          });
        }
      }
    }
    return { sessionId, models, currentModel };
  }

  /**
   * Run one turn, collecting message and thought chunks. File blocks resolve
   * to image/resource wire blocks; unresolvable files come back in `skipped`
   * so the caller can fall back to paths. State is keyed by session: two
   * conversations sharing one client (one directory) run concurrently, each
   * collecting only its own updates. A second prompt on the *same* session
   * still rejects — replays would interleave one transcript.
   */
  async prompt(
    sessionId: string,
    blocks: readonly AcpPromptBlock[],
    onChunk?: (chunk: { kind: 'text' | 'thought'; delta: string }) => void
  ): Promise<AcpPromptResult & { skipped: readonly AcpSkippedFile[] }> {
    if (this.activePrompts.has(sessionId)) {
      throw new AcpError('session/prompt', 'A prompt is already in flight on this session.');
    }
    this.activePrompts.add(sessionId);
    this.promptAccum.set(sessionId, { text: '', thought: '' });
    const chunkHandler =
      onChunk !== undefined
        ? (update: AcpSessionUpdate) => {
            if (update.sessionId !== sessionId) {
              return;
            }
            if (update.kind === 'agent_message_chunk' && update.text !== undefined) {
              onChunk({ kind: 'text', delta: update.text });
            } else if (update.kind === 'agent_thought_chunk' && update.text !== undefined) {
              onChunk({ kind: 'thought', delta: update.text });
            }
          }
        : undefined;
    if (chunkHandler) {
      this.updateHandlers.push(chunkHandler);
    }
    try {
      const { wire, skipped } = await this.toWireBlocks(blocks);
      const result = (await this.request('session/prompt', {
        sessionId,
        prompt: wire
      })) as Record<string, unknown>;
      const usage = asRecord(result.usage);
      const inputTokens = usage.inputTokens;
      const outputTokens = usage.outputTokens;
      const cachedReadTokens = usage.cachedReadTokens;
      const accum = this.promptAccum.get(sessionId) ?? { text: '', thought: '' };
      return {
        stopReason: asString(result.stopReason) ?? 'unknown',
        text: accum.text,
        thought: accum.thought,
        skipped,
        usage: {
          ...(typeof inputTokens === 'number' ? { inputTokens } : {}),
          ...(typeof outputTokens === 'number' ? { outputTokens } : {}),
          ...(typeof cachedReadTokens === 'number' ? { cachedReadTokens } : {})
        }
      };
    } finally {
      if (chunkHandler) {
        const index = this.updateHandlers.indexOf(chunkHandler);
        if (index >= 0) {
          this.updateHandlers.splice(index, 1);
        }
      }
      // Stale asks die with the turn: answering one after the agent moved on
      // would grant permission to the wrong moment. Only this session's asks
      // clear — a concurrent turn keeps its own.
      for (const [approvalId, pending] of [...this.permissionPending]) {
        if (pending.sessionId === sessionId) {
          this.permissionPending.delete(approvalId);
        }
      }
      this.promptAccum.delete(sessionId);
      this.activePrompts.delete(sessionId);
    }
  }

  /** Answer a pending permission ask. One-shot: unknown or settled ids no-op. */
  resolvePermission(approvalId: string, decision: AcpPermissionDecision): void {
    const pending = this.permissionPending.get(approvalId);
    if (!pending) {
      return;
    }
    this.permissionPending.delete(approvalId);
    this.notifyResult(pending.id, permissionReply(pending.options, decision));
  }

  /**
   * Route permission asks to a handler for the duration of a turn; null
   * restores auto-deny. The adapter sets this per turn so asks surface in
   * the UI instead of dying silently.
   */
  setPermissionHandler(handler: ((ask: AcpPermissionAsk) => void) | null): void {
    this.permissionHandler = handler;
  }

  /**
   * Run the agent's auth flow for a known method id. Never called
   * automatically: real methods can open a browser login, so this stays an
   * explicit user action. Unknown ids fail loudly with the method echoed.
   */
  async authenticate(methodId: string): Promise<unknown> {
    return this.request('authenticate', { methodId });
  }

  /** Real `session/cancel`: a notification, no id, never treated as a request. */
  cancel(sessionId: string): void {
    this.ensureAlive('session/cancel');
    this.write({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
  }

  /**
   * Resolve prompt blocks to wire blocks. Images ride as base64, text files
   * as embedded resources (both shapes verified live). Anything else —
   * outside root, oversized, unreadable, unmapped mime — comes back skipped
   * so the caller can fall back to a path line, never failing the turn.
   */
  private async toWireBlocks(blocks: readonly AcpPromptBlock[]): Promise<{
    wire: unknown[];
    skipped: AcpSkippedFile[];
  }> {
    const wire: unknown[] = [];
    const skipped: AcpSkippedFile[] = [];
    for (const block of blocks) {
      if (block.type === 'text') {
        wire.push({ type: 'text', text: block.text });
        continue;
      }
      if (block.type === 'file-bytes') {
        const label = block.name ?? 'attachment';
        let bytes: Buffer;
        try {
          bytes = Buffer.from(block.base64, 'base64');
        } catch {
          skipped.push({ path: label, reason: 'undecodable content' });
          continue;
        }
        if (bytes.length > MAX_FILE_BYTES) {
          skipped.push({ path: label, reason: 'over the file size ceiling' });
          continue;
        }
        if (block.mime.startsWith('image/')) {
          wire.push({ type: 'image', mimeType: block.mime, data: block.base64 });
        } else if (block.mime.startsWith('text/') || block.mime === 'application/json') {
          wire.push({ type: 'text', text: `--- ${label} ---\n${bytes.toString('utf8')}` });
        } else {
          skipped.push({ path: label, reason: `mime ${block.mime} has no ACP mapping yet` });
        }
        continue;
      }
      if (!this.isInsideRoot(block.path)) {
        skipped.push({ path: block.path, reason: 'outside the workspace' });
        continue;
      }
      try {
        const bytes = await this.readFileBytes(block.path);
        if (bytes.length > MAX_FILE_BYTES) {
          skipped.push({ path: block.path, reason: 'over the file size ceiling' });
          continue;
        }
        if (block.mime.startsWith('image/')) {
          wire.push({
            type: 'image',
            mimeType: block.mime,
            data: bytes.toString('base64'),
            uri: `file://${block.path}`
          });
        } else if (block.mime.startsWith('text/') || block.mime === 'application/json') {
          wire.push({
            type: 'resource',
            resource: {
              uri: `file://${block.path}`,
              mimeType: block.mime,
              text: bytes.toString('utf8')
            }
          });
        } else {
          skipped.push({ path: block.path, reason: `mime ${block.mime} has no ACP mapping yet` });
        }
      } catch (error) {
        skipped.push({
          path: block.path,
          reason: error instanceof Error ? error.message.slice(0, 120) : 'unreadable'
        });
      }
    }
    // Skipped files degrade to path lines, the SDK driver's fallback: the
    // agent still learns each file exists and can pull it over fs.
    if (skipped.length > 0) {
      wire.push({
        type: 'text',
        text: skipped.map((entry) => `Attachment path (sent as a path: ${entry.reason}): ${entry.path}`).join('\n')
      });
    }
    return { wire, skipped };
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.request('session/close', { sessionId });
  }

  /**
   * TERM the process group, brief grace, KILL the group. POSIX signals the
   * group first (the agent may leave helpers in it), escalating only when
   * verified necessary — the compact form of `OpenCodeRuntime.teardown`.
   * Best-effort throughout; shutdown never rejects.
   */
  async shutdown(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.failAll(new AcpError('shutdown', 'The ACP client was shut down.'));
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    const groupSignal = (signal: NodeJS.Signals): void => {
      if (process.platform === 'win32' || typeof child.pid !== 'number') {
        try {
          child.kill(signal);
        } catch {
          // Already gone; nothing to signal.
        }
        return;
      }
      try {
        process.kill(-Number(child.pid), signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // Already gone; nothing to signal.
        }
      }
    };
    const hasExited = () => child.exitCode !== null || child.signalCode !== null;
    groupSignal('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 500))]);
    if (!hasExited()) {
      groupSignal('SIGKILL');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 500))]);
    }
  }

  private ensureAlive(operation: string): void {
    if (this.dead) {
      throw this.dead;
    }
    if (!this.child) {
      throw new AcpError(operation, 'The ACP client is not started.');
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    this.ensureAlive(method);
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private notifyResult(id: number, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  private notifyError(id: number, code: number, message: string): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message } });
  }

  private write(frame: unknown): void {
    const line = JSON.stringify(frame);
    this.logger?.('out', frame);
    this.child?.stdin?.write(line + '\n');
  }

  private failAll(error: AcpError): void {
    this.dead = this.dead ?? error;
    for (const [, pending] of [...this.pending]) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async onStdout(chunk: string): Promise<void> {
    this.buffer += chunk;
    if (this.buffer.length > MAX_BUFFERED_LINE_BYTES && this.buffer.indexOf('\n') < 0) {
      const bytes = this.buffer.length;
      this.buffer = '';
      this.failAll(
        new AcpError(
          'protocol',
          `The ACP agent sent a single output line over ${bytes} characters without a newline; the client was reset rather than buffering it unbounded.`
        )
      );
      return;
    }
    let index: number;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) {
        continue;
      }
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      this.logger?.('in', message);
      await this.onFrame(message);
    }
  }

  private async onFrame(message: unknown): Promise<void> {
    const record = asRecord(message);
    if (
      typeof record.id === 'number' &&
      (record.result !== undefined || record.error !== undefined)
    ) {
      const pending = this.pending.get(record.id);
      this.pending.delete(record.id);
      if (!pending) {
        return;
      }
      if (record.error !== undefined) {
        const detail = asRecord(record.error);
        const code = typeof detail.code === 'number' ? detail.code : undefined;
        pending.reject(
          new AcpError(
            pending.method,
            typeof detail.message === 'string' ? detail.message : 'The ACP agent reported an error.',
            pending.method,
            record.id,
            undefined,
            code,
            detail.data
          )
        );
      } else {
        pending.resolve(record.result);
      }
      return;
    }

    if (typeof record.method === 'string' && record.id === undefined) {
      if (record.method === 'session/update') {
        this.onSessionUpdate(record.params);
      }
      // Other notifications need no reply.
      return;
    }

    if (typeof record.method === 'string' && typeof record.id === 'number') {
      await this.onAgentRequest(record.id, record.method, record.params);
    }
  }

  private onSessionUpdate(params: unknown): void {
    const update = parseSessionUpdate(params);
    if (!update) {
      return;
    }
    const accum = this.promptAccum.get(update.sessionId);
    if (accum) {
      if (update.kind === 'agent_message_chunk' && update.text !== undefined) {
        accum.text += update.text;
      } else if (update.kind === 'agent_thought_chunk' && update.text !== undefined) {
        accum.thought += update.text;
      }
    }
    if (this.updateHandlers.length === 0) {
      this.updateBacklog.push(update);
      if (this.updateBacklog.length > MAX_BUFFERED_UPDATES) {
        this.updateBacklog.splice(0, this.updateBacklog.length - MAX_BUFFERED_UPDATES);
      }
      return;
    }
    for (const handler of [...this.updateHandlers]) {
      try {
        handler(update);
      } catch {
        // One bad sink must not break the turn or the other sinks.
      }
    }
  }

  private async onAgentRequest(id: number, method: string, params: unknown): Promise<void> {
    try {
      switch (method) {
        case 'session/request_permission': {
          const request = parsePermissionRequest(params);
          if (!request) {
            this.notifyError(id, -32602, 'Malformed permission request.');
            return;
          }
          const approvalId = request.toolCallId ?? `ask-${id}`;
          if (!this.permissionHandler) {
            this.notifyResult(id, permissionReply(request.options, 'deny'));
            return;
          }
          this.permissionPending.set(approvalId, {
            id,
            options: request.options,
            sessionId: asString(asRecord(params).sessionId) ?? ''
          });
          try {
            this.permissionHandler({
              approvalId,
              toolCallId: request.toolCallId,
              ...(request.title !== undefined ? { title: request.title } : {}),
              options: request.options
            });
          } catch {
            this.permissionPending.delete(approvalId);
            this.notifyResult(id, permissionReply(request.options, 'deny'));
          }
          return;
        }
        case 'fs/read_text_file': {
          const path = asString(asRecord(params).path);
          if (!path) {
            this.notifyError(id, -32602, 'Missing path.');
            return;
          }
          if (!this.isInsideRoot(path)) {
            this.notifyError(id, -32000, 'Reads outside the workspace are denied.');
            return;
          }
          try {
            const content = await this.readTextFile(path);
            this.notifyResult(id, { content });
          } catch (error) {
            this.notifyError(
              id,
              -32000,
              error instanceof Error ? error.message.slice(0, 200) : 'Read failed.'
            );
          }
          return;
        }
        case 'fs/write_text_file':
        case 'terminal/create':
        case 'terminal/output':
        case 'terminal/wait_for_exit':
        case 'terminal/kill':
        case 'terminal/release':
          this.notifyError(id, -32000, `${method} is denied by the spike client.`);
          return;
        default:
          this.notifyError(id, -32601, `Method not found: ${method}`);
          return;
      }
    } catch (error) {
      this.notifyError(
        id,
        -32603,
        error instanceof Error ? error.message.slice(0, 200) : 'Handler failed.'
      );
    }
  }

  /** Lexical containment under the workspace root. Symlink races are next-slice work. */
  private isInsideRoot(path: string): boolean {
    return resolve(normalize(path)).startsWith(this.fsRoot);
  }
}
