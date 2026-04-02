import type { ChatMessagePart, ProviderId } from '../../shared/contracts';

export type DraftStateLike = {
  requestId: string;
  modelId: string;
  providerId: ProviderId;
  parts: ChatMessagePart[];
  status: 'streaming' | 'error' | 'aborted';
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  latencyMs?: number;
  startedAt: string;
};
