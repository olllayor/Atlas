import type { ModelMessage, ToolChoice, ToolSet } from 'ai';

import type { ReasoningEffort, ToolPermissionMode } from '../../../shared/chatParameters';
import type { ModelRuntimeHints, ModelSummary, ProviderId } from '../../../shared/contracts';

export type ProviderStreamRequest = {
  apiKey: string;
  modelId: string;
  messages: ModelMessage[];
  system?: string;
  tools?: ToolSet;
  toolChoice?: ToolChoice<ToolSet>;
  temperature?: number;
  maxOutputTokens?: number;
  /**
   * Catalog-derived facts about the target model. Lets an adapter size the
   * request to the model instead of applying one provider-wide ceiling.
   */
  modelHints?: ModelRuntimeHints;
  /**
   * Requested thinking budget. Each adapter maps it onto its own wire format;
   * models without a thinking mode ignore it.
   */
  reasoningEffort?: ReasoningEffort;
  /**
   * Which conversation and project this turn belongs to.
   *
   * Stateless adapters ignore it — a request carries its own history. Agent
   * providers that keep the transcript on their side (OpenCode) need it to
   * resume the right session, and to notice when the project changed under it.
   */
  toolPermissionMode?: ToolPermissionMode | string | null;
  agentContext?: {
    conversationId: string;
    /** Absolute directory the agent should work in; null when no project. */
    workspaceRoot?: string | null;
    toolPermissionMode?: ToolPermissionMode | string | null;
  };
  signal: AbortSignal;
  onChunk: (event: { id: string; delta: string }) => void;
  onReasoningChunk?: (event: { id: string; delta: string }) => void;
  onToolInputStart?: (event: {
    toolCallId: string;
    toolName: string;
    dynamic?: boolean;
    providerExecuted?: boolean;
    title?: string;
  }) => void;
  onToolInputDelta?: (event: {
    toolCallId: string;
    delta: string;
  }) => void;
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
    preliminary?: boolean;
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
  onToolOutputDenied?: (event: {
    toolCallId: string;
    toolName?: string;
    reason?: string;
  }) => void;
  onToolApprovalRequested?: (event: {
    approvalId: string;
    toolCallId: string;
    toolName?: string;
    reason?: string;
  }) => void;
  /**
   * Fired by adapters that answer approvals themselves (see
   * `ProviderAdapter.resolveApproval`), so the turn stops counting that
   * approval as pending while it keeps streaming.
   */
  onToolApprovalResolved?: (event: { approvalId: string }) => void;
  /**
   * Transient, user-facing status from the stream loop itself (not from the
   * model). Currently emitted by the repeat-tool-call guard when it nudges the
   * model. Mirrors the `notice` stream event shape minus requestId, which the
   * runtime stamps.
   */
  onNotice?: (event: { code: string; level: 'info' | 'warning'; message: string }) => void;
};

export type ProviderStreamResult = {
  content: string;
  reasoning?: string;
  responseMessages?: ModelMessage[];
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  /**
   * Provider-reported prompt-cache hit tokens, when the provider reports them.
   * Subset of `inputTokens` (the AI SDK reports the full prompt there, cache
   * hits included — the hit rate is cached over input, not input + cached).
   * Absent means the provider said nothing — never coerce to 0, that would
   * fake a 0% rate.
   */
  cachedInputTokens?: number;
  latencyMs: number;
};

export type ProviderCapabilities = {
  /**
   * When true the adapter cannot list models without a key, so a keyless
   * refresh skips it rather than burning a request that will 401.
   */
  requiresApiKeyForCatalog?: boolean;
  /**
   * When true `listModels` returns the provider's complete catalog, so models
   * missing from it can safely be archived.
   */
  returnsCompleteCatalog?: boolean;
  /**
   * When false `listModels` answers from local configuration and never
   * touches the endpoint, so its success proves nothing about reachability
   * or key validity — a refresh must not record a validation.
   */
  catalogRequiresNetwork?: boolean;
  /**
   * When true the provider holds its own credentials (OpenCode signs in with
   * `opencode auth login`) and Atlas stores nothing for it. Turns, titles and
   * summaries must not demand a key that will never exist.
   */
  authenticatesItself?: boolean;
};

/**
 * Whether a turn needs a key out of Atlas' keychain before it can run.
 *
 * Every provider needed one until OpenCode: it authenticates itself, so
 * gating on a stored secret failed every turn with `MissingCredentialError`
 * and silently skipped title and summary generation.
 */
export function requiresStoredCredential(
  adapter: Pick<ProviderAdapter, 'capabilities'> | null | undefined
): boolean {
  return adapter?.capabilities?.authenticatesItself !== true;
}

/**
 * What an agent provider does with an approval. `approve_always` is only
 * offered by providers that keep their own standing grants.
 */
export type ProviderApprovalDecision = 'approve' | 'approve_always' | 'deny';

export interface ProviderAdapter {
  readonly providerId: ProviderId;
  readonly capabilities?: ProviderCapabilities;
  validateCredential(apiKey: string): Promise<void>;
  listModels(apiKey: string | null): Promise<ModelSummary[]>;
  streamChat(request: ProviderStreamRequest): Promise<ProviderStreamResult>;
  /**
   * Present only on providers that execute their own tools (OpenCode). Their
   * turn stays open across an approval, so the decision is sent back over the
   * wire instead of the request being re-run with an approval message.
   */
  resolveApproval?(approvalId: string, decision: ProviderApprovalDecision): Promise<void>;
}
