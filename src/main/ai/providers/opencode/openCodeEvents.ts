/**
 * Translates opencode's event stream into Atlas' `ProviderStreamRequest`
 * callbacks. Pure state machine: no SDK types, no IO, so the full table runs
 * off canned event fixtures.
 *
 * Blueprint: pingdotgg/t3code `Layers/OpenCodeAdapter.ts` (event translation
 * table, one-shot guards). Transport-agnostic on purpose — the planned ACP
 * driver (plan T10) feeds the same translator from stdio notifications.
 *
 * opencode ships two overlapping event vocabularies:
 *
 *   - `session.next.*` — explicit deltas (text/reasoning/tool phases);
 *   - `message.part.updated` / `message.part.delta` — the older whole-part
 *     snapshots t3code consumes.
 *
 * A server can emit both for the same content, which would double every
 * token, so the translator latches onto whichever family speaks first and
 * ignores the other for the rest of the turn.
 */

export type OpenCodeEventFamily = 'next' | 'legacy';

export interface OpenCodeStreamCallbacks {
  onChunk: (event: { id: string; delta: string }) => void;
  onReasoningChunk?: (event: { id: string; delta: string }) => void;
  onToolInputStart?: (event: {
    toolCallId: string;
    toolName: string;
    dynamic?: boolean;
    providerExecuted?: boolean;
    title?: string;
  }) => void;
  onToolInputDelta?: (event: { toolCallId: string; delta: string }) => void;
  onToolInputAvailable?: (event: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    dynamic?: boolean;
    providerExecuted?: boolean;
    title?: string;
  }) => void;
  onToolOutputAvailable?: (event: {
    toolCallId: string;
    toolName: string;
    input?: unknown;
    output: unknown;
    dynamic?: boolean;
    providerExecuted?: boolean;
    title?: string;
  }) => void;
  onToolOutputError?: (event: {
    toolCallId: string;
    toolName: string;
    input?: unknown;
    errorText: string;
    dynamic?: boolean;
    providerExecuted?: boolean;
    title?: string;
  }) => void;
  onToolApprovalRequested?: (event: {
    approvalId: string;
    toolCallId: string;
    toolName?: string;
    reason?: string;
  }) => void;
  onNotice?: (event: { code: string; level: 'info' | 'warning'; message: string }) => void;
}

/** A pending permission ask, surfaced so the adapter can answer opencode. */
export interface OpenCodePermissionAsk {
  readonly approvalId: string;
  readonly toolCallId: string;
  readonly toolName?: string;
  readonly reason?: string;
}

interface OpenCodeEventLike {
  readonly type?: unknown;
  readonly properties?: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * opencode reports tool failures as either a string or a structured error
 * object; the transcript wants one sentence either way.
 */
function describeToolError(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  const record = asRecord(value);
  const nested = asRecord(record.data);
  return (
    asString(record.message) ??
    asString(nested.message) ??
    asString(record.name) ??
    'The tool failed without reporting a reason.'
  );
}

/**
 * `session.next.tool.success` carries both a structured result and rendered
 * content blocks; prefer whichever is actually populated, since ToolCell
 * renders strings verbatim and objects as JSON.
 */
function describeToolOutput(properties: Record<string, unknown>): unknown {
  const content = properties.content;
  if (Array.isArray(content) && content.length > 0) {
    const text = content
      .map((entry) => asString(asRecord(entry).text))
      .filter((entry): entry is string => entry !== undefined)
      .join('\n');
    if (text.length > 0) {
      return text;
    }
  }

  const structured = asRecord(properties.structured);
  if (Object.keys(structured).length > 0) {
    return structured;
  }

  return properties.result ?? '';
}

interface ToolRecord {
  name: string;
  input?: unknown;
  title?: string;
  /** Set once an output/error was reported, so a late snapshot cannot repeat it. */
  settled: boolean;
}

/**
 * Consumes opencode events for one session and drives the Atlas callbacks.
 *
 * Every tool event is marked `providerExecuted` — during an opencode turn the
 * agent runs its own tools and Atlas only renders them (plan D4).
 */
export class OpenCodeEventTranslator {
  private family: OpenCodeEventFamily | null = null;
  private text = '';
  private reasoning = '';
  private idle = false;
  private failure: string | null = null;
  private aborted = false;

  /** Text already emitted per part id — legacy snapshots arrive cumulative. */
  private readonly emittedText = new Map<string, string>();
  private readonly emittedReasoning = new Map<string, string>();
  /**
   * Messages opencode reported as the user's. Their parts are echoed back over
   * the same stream, and rendering them would replay the prompt as the
   * assistant's answer. Announced before their parts, so an unknown message id
   * is safely treated as the assistant's.
   */
  private readonly userMessages = new Set<string>();
  /**
   * Part id → kind, learned from `message.part.updated`. `message.part.delta`
   * names a field, not a kind, and a reasoning part's field is also "text" —
   * without this every thought is streamed as the answer.
   */
  private readonly partKinds = new Map<string, 'text' | 'reasoning'>();
  private readonly tools = new Map<string, ToolRecord>();
  private readonly pendingPermissions = new Map<string, OpenCodePermissionAsk>();

  constructor(
    private readonly sessionId: string,
    private readonly callbacks: OpenCodeStreamCallbacks
  ) {}

  get assistantText(): string {
    return this.text;
  }

  get assistantReasoning(): string {
    return this.reasoning;
  }

  /** True once opencode said the session went idle — the turn is over. */
  get isIdle(): boolean {
    return this.idle;
  }

  /** Session-level failure text, if opencode reported one. */
  get errorText(): string | null {
    return this.failure;
  }

  /** True when the failure was an abort we asked for. */
  get wasAborted(): boolean {
    return this.aborted;
  }

  /** Permission asks seen so far, keyed by opencode's request id. */
  takePendingPermissions(): OpenCodePermissionAsk[] {
    const asks = [...this.pendingPermissions.values()];
    this.pendingPermissions.clear();
    return asks;
  }

  handle(event: unknown): void {
    const envelope = asRecord(event) as OpenCodeEventLike;
    const type = asString(envelope.type);
    if (!type) {
      return;
    }

    const properties = asRecord(envelope.properties);
    if (!this.belongsToSession(type, properties)) {
      return;
    }

    switch (type) {
      case 'session.next.text.delta':
        if (this.claim('next')) {
          this.pushText(asString(properties.textID) ?? 'text', String(properties.delta ?? ''));
        }
        return;
      case 'session.next.text.ended':
        // Only meaningful when the server skipped deltas entirely.
        if (this.claim('next')) {
          this.completeText(asString(properties.textID) ?? 'text', String(properties.text ?? ''));
        }
        return;
      case 'session.next.reasoning.delta':
        if (this.claim('next')) {
          this.pushReasoning(asString(properties.reasoningID) ?? 'reasoning', String(properties.delta ?? ''));
        }
        return;
      case 'session.next.tool.input.started':
        if (this.claim('next')) {
          this.startTool(asString(properties.callID), asString(properties.name));
        }
        return;
      case 'session.next.tool.input.delta':
        if (this.claim('next')) {
          const callId = asString(properties.callID);
          if (callId) {
            this.callbacks.onToolInputDelta?.({ toolCallId: callId, delta: String(properties.delta ?? '') });
          }
        }
        return;
      case 'session.next.tool.called':
        if (this.claim('next')) {
          this.toolInputAvailable(asString(properties.callID), asString(properties.tool), properties.input);
        }
        return;
      case 'session.next.tool.success':
        if (this.claim('next')) {
          this.toolSucceeded(asString(properties.callID), describeToolOutput(properties));
        }
        return;
      case 'session.next.tool.failed':
        if (this.claim('next')) {
          this.toolFailed(asString(properties.callID), describeToolError(properties.error));
        }
        return;
      case 'session.next.step.failed':
        this.recordFailure(describeToolError(properties.error));
        return;
      case 'message.updated': {
        const info = asRecord(properties.info);
        const messageId = asString(info.id);
        if (messageId && info.role === 'user') {
          this.userMessages.add(messageId);
        }
        return;
      }
      case 'message.part.updated':
        if (this.claim('legacy')) {
          this.applyPartSnapshot(asRecord(properties.part));
        }
        return;
      case 'message.part.delta':
        if (this.claim('legacy')) {
          this.applyPartDelta(properties);
        }
        return;
      case 'permission.asked':
      case 'permission.v2.asked':
        this.recordPermissionAsk(properties);
        return;
      case 'session.error':
        this.recordFailure(describeToolError(asRecord(properties.error)));
        return;
      case 'session.idle':
        this.idle = true;
        return;
      default:
    }
  }

  /**
   * Session scoping. Session-less envelopes (server-level notices) are dropped
   * rather than guessed at — a turn must never render another session's work.
   */
  private belongsToSession(type: string, properties: Record<string, unknown>): boolean {
    const sessionID = asString(properties.sessionID);
    if (sessionID) {
      return sessionID === this.sessionId;
    }
    return type === 'session.error';
  }

  /** First family to speak owns the turn; the other is ignored as a duplicate. */
  private claim(family: OpenCodeEventFamily): boolean {
    this.family ??= family;
    return this.family === family;
  }

  private pushText(partId: string, delta: string): void {
    if (delta.length === 0) return;
    this.text += delta;
    this.emittedText.set(partId, (this.emittedText.get(partId) ?? '') + delta);
    this.callbacks.onChunk({ id: partId, delta });
  }

  private completeText(partId: string, full: string): void {
    const already = this.emittedText.get(partId) ?? '';
    if (full.length > already.length && full.startsWith(already)) {
      this.pushText(partId, full.slice(already.length));
    }
  }

  private pushReasoning(partId: string, delta: string): void {
    if (delta.length === 0) return;
    this.reasoning += delta;
    this.emittedReasoning.set(partId, (this.emittedReasoning.get(partId) ?? '') + delta);
    this.callbacks.onReasoningChunk?.({ id: partId, delta });
  }

  private completeReasoning(partId: string, full: string): void {
    const already = this.emittedReasoning.get(partId) ?? '';
    if (full.length > already.length && full.startsWith(already)) {
      this.pushReasoning(partId, full.slice(already.length));
    }
  }

  private startTool(callId: string | undefined, toolName: string | undefined): void {
    if (!callId) return;
    const name = toolName ?? this.tools.get(callId)?.name ?? 'tool';
    if (!this.tools.has(callId)) {
      this.tools.set(callId, { name, settled: false });
      this.callbacks.onToolInputStart?.({
        toolCallId: callId,
        toolName: name,
        dynamic: true,
        providerExecuted: true
      });
    }
  }

  private toolInputAvailable(callId: string | undefined, toolName: string | undefined, input: unknown): void {
    if (!callId) return;
    this.startTool(callId, toolName);
    const record = this.tools.get(callId)!;
    record.name = toolName ?? record.name;
    record.input = input;
    this.callbacks.onToolInputAvailable?.({
      toolCallId: callId,
      toolName: record.name,
      input: input ?? {},
      dynamic: true,
      providerExecuted: true,
      ...(record.title ? { title: record.title } : {})
    });
  }

  private toolSucceeded(callId: string | undefined, output: unknown): void {
    if (!callId) return;
    const record = this.tools.get(callId);
    if (!record || record.settled) return;
    record.settled = true;
    this.callbacks.onToolOutputAvailable?.({
      toolCallId: callId,
      toolName: record.name,
      ...(record.input !== undefined ? { input: record.input } : {}),
      output,
      dynamic: true,
      providerExecuted: true,
      ...(record.title ? { title: record.title } : {})
    });
  }

  private toolFailed(callId: string | undefined, errorText: string): void {
    if (!callId) return;
    const record = this.tools.get(callId);
    if (!record || record.settled) return;
    record.settled = true;
    this.callbacks.onToolOutputError?.({
      toolCallId: callId,
      toolName: record.name,
      ...(record.input !== undefined ? { input: record.input } : {}),
      errorText,
      dynamic: true,
      providerExecuted: true,
      ...(record.title ? { title: record.title } : {})
    });
  }

  /**
   * Legacy vocabulary: parts arrive as cumulative snapshots, so the delta is
   * whatever the snapshot added since the last one.
   */
  private applyPartSnapshot(part: Record<string, unknown>): void {
    const partId = asString(part.id);
    const type = asString(part.type);
    if (!partId || !type) return;

    // The user's own message and opencode's internal filler are not the answer.
    const messageId = asString(part.messageID);
    if ((messageId && this.userMessages.has(messageId)) || part.synthetic === true) {
      return;
    }

    if (type === 'text' || type === 'reasoning') {
      this.partKinds.set(partId, type);
    }

    if (type === 'text') {
      this.completeText(partId, String(part.text ?? ''));
      return;
    }
    if (type === 'reasoning') {
      this.completeReasoning(partId, String(part.text ?? ''));
      return;
    }
    if (type !== 'tool') return;

    const callId = asString(part.callID) ?? partId;
    const toolName = asString(part.tool) ?? 'tool';
    const state = asRecord(part.state);
    const status = asString(state.status);
    const title = asString(state.title);

    this.startTool(callId, toolName);
    const record = this.tools.get(callId)!;
    if (title) record.title = title;

    if (status === 'running' || status === 'pending') {
      if (record.input === undefined && state.input !== undefined) {
        this.toolInputAvailable(callId, toolName, state.input);
      }
      return;
    }
    if (status === 'completed') {
      if (record.input === undefined && state.input !== undefined) {
        this.toolInputAvailable(callId, toolName, state.input);
      }
      this.toolSucceeded(callId, state.output ?? '');
      return;
    }
    if (status === 'error') {
      this.toolFailed(callId, describeToolError(state.error));
    }
  }

  private applyPartDelta(properties: Record<string, unknown>): void {
    const partId = asString(properties.partID);
    const delta = String(properties.delta ?? '');
    if (!partId || delta.length === 0) return;

    // Deltas carry their message id too, and the snapshot guard alone would
    // miss a server that streams the user's own message this way.
    const messageId = asString(properties.messageID);
    if (messageId && this.userMessages.has(messageId)) {
      return;
    }

    // Kind wins over field name; the field is only a fallback for a delta that
    // arrived before its part was announced.
    const kind = this.partKinds.get(partId);
    const field = asString(properties.field) ?? 'text';
    if (kind === 'reasoning' || (kind === undefined && field.startsWith('reasoning'))) {
      this.pushReasoning(partId, delta);
      return;
    }
    if (kind === 'text' || field === 'text') {
      this.pushText(partId, delta);
    }
  }

  /**
   * Permission asks reach Atlas' approval surface, and the id opencode wants
   * back is kept so the adapter can reply once the user decides (plan T6).
   */
  private recordPermissionAsk(properties: Record<string, unknown>): void {
    const approvalId = asString(properties.id);
    if (!approvalId || this.pendingPermissions.has(approvalId)) return;

    const tool = asRecord(properties.tool);
    const toolCallId = asString(tool.callID) ?? approvalId;
    const toolName = asString(properties.permission) ?? asString(properties.action);
    const resources = Array.isArray(properties.resources)
      ? properties.resources.filter((entry): entry is string => typeof entry === 'string')
      : Array.isArray(properties.patterns)
        ? properties.patterns.filter((entry): entry is string => typeof entry === 'string')
        : [];

    const ask: OpenCodePermissionAsk = {
      approvalId,
      toolCallId,
      ...(toolName ? { toolName } : {}),
      ...(resources.length > 0 ? { reason: resources.join(', ') } : {})
    };

    this.pendingPermissions.set(approvalId, ask);
    this.callbacks.onToolApprovalRequested?.(ask);
  }

  private recordFailure(message: string): void {
    if (/abort/i.test(message)) {
      this.aborted = true;
    }
    this.failure ??= message;
    this.idle = true;
  }
}
