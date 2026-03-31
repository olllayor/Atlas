import type { ChatMessagePart } from '../../shared/contracts';

export type DraftStateLike = {
  requestId: string;
  modelId: string;
  providerId: string;
  parts: ChatMessagePart[];
  status: 'streaming' | 'error' | 'aborted';
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  latencyMs?: number;
  startedAt: string;
};
