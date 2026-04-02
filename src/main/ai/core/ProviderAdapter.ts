import type { ModelMessage, ToolSet } from 'ai';

import type { ModelSummary, ProviderId } from '../../../shared/contracts';

export type ProviderStreamRequest = {
  apiKey: string;
  modelId: string;
  messages: ModelMessage[];
  system?: string;
  tools?: ToolSet;
  temperature?: number;
  maxOutputTokens?: number;
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
  }) => void;
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

export interface ProviderAdapter {
  readonly providerId: ProviderId;
  validateCredential(apiKey: string): Promise<void>;
  listModels(apiKey: string | null): Promise<ModelSummary[]>;
  streamChat(request: ProviderStreamRequest): Promise<ProviderStreamResult>;
}
