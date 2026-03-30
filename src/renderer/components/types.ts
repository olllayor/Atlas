export type DraftStateLike = {
  requestId: string;
  modelId: string;
  providerId: string;
  content: string;
  status: 'streaming' | 'error' | 'aborted';
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  startedAt: string;
};
