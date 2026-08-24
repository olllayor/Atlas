import type { ChatMessagePart, ProviderId } from '../../shared/contracts';

export type DraftStateLike = {
  requestId: string;
  modelId: string;
  providerId: ProviderId;
  parts: ChatMessagePart[];
  status: 'queued' | 'streaming' | 'error' | 'aborted';
  errorMessage?: string;
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
  } | null;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  latencyMs?: number;
  startedAt: string;
  /** Transient status for the attempt in flight; cleared by the next token. */
  notice?: { code: string; message: string; level: 'info' | 'warning' } | null;
};
