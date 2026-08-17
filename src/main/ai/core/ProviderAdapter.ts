import type { ModelMessage, ToolChoice, ToolSet } from 'ai';

import type { ReasoningEffort } from '../../../shared/chatParameters';
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
};

export interface ProviderAdapter {
  readonly providerId: ProviderId;
  readonly capabilities?: ProviderCapabilities;
  validateCredential(apiKey: string): Promise<void>;
  listModels(apiKey: string | null): Promise<ModelSummary[]>;
  streamChat(request: ProviderStreamRequest): Promise<ProviderStreamResult>;
}
