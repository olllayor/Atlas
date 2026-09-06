import {
  type AiDomainError,
  AbortedError,
  AuthError,
  fromAiDomainError,
  InsufficientCreditsError,
  MissingCredentialError as TaggedMissingCredentialError,
  ModelUnavailableError,
  NetworkError,
  ProviderError,
  RateLimitError,
  StreamStalledError,
  TimeoutError,
  UnknownAiError,
  UpstreamUnavailableError
} from './domainErrors';

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Milliseconds the provider asked us to wait, parsed from response headers. */
    readonly retryAfterMs: number | null = null
  ) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

export class MissingCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingCredentialError';
  }
}

export class RequestTimeoutError extends Error {
  constructor(message = 'The request timed out before the model responded.') {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

export class ProviderStalledError extends Error {
  constructor(message = 'The model stopped responding mid-answer.') {
    super(message);
    this.name = 'ProviderStalledError';
  }
}

export type NormalizedError = {
  code: string;
  message: string;
  retryable: boolean;
  /** Provider-requested backoff, when it supplied one. */
  retryAfterMs?: number | null;
};

function isAIError(
  error: unknown
): error is {
  statusCode?: number;
  message: string;
  isRetryable?: boolean;
  data?: unknown;
  responseHeaders?: Record<string, string>;
  cause?: unknown;
} {
  if (error == null || typeof error !== 'object') return false;
  const symbols = Object.getOwnPropertySymbols(error);
  return symbols.some((s) => s.description === 'vercel.ai.error' && (error as Record<string | symbol, unknown>)[s] === true);
}

/**
 * Retry-After is either delta-seconds or an HTTP date. OpenRouter also mirrors
 * the reset instant into `x-ratelimit-reset` as epoch milliseconds.
 */
export function parseRetryAfterMs(headers: Record<string, string | undefined> | undefined): number | null {
  if (!headers) {
    return null;
  }

  const lookup = (name: string) => {
    const direct = headers[name];
    if (typeof direct === 'string') {
      return direct;
    }

    const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
    return match ? headers[match] : undefined;
  };

  const retryAfter = lookup('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    }

    const asDate = Date.parse(retryAfter);
    if (Number.isFinite(asDate)) {
      return clampDelay(asDate - Date.now());
    }
  }

  const reset = lookup('x-ratelimit-reset');
  if (reset) {
    const resetAt = Number(reset);
    if (Number.isFinite(resetAt) && resetAt > 0) {
      // Values below the epoch-millisecond range are seconds.
      const resetMs = resetAt > 1e11 ? resetAt : resetAt * 1000;
      return clampDelay(resetMs - Date.now());
    }
  }

  return null;
}

const MAX_RETRY_AFTER_MS = 60_000;

function clampDelay(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.min(value, MAX_RETRY_AFTER_MS);
}

const TRANSIENT_NETWORK_PATTERNS = [
  'fetch failed',
  'network error',
  'socket hang up',
  'econnreset',
  'econnrefused',
  'econnaborted',
  'enotfound',
  'eai_again',
  'etimedout',
  'epipe',
  'terminated',
  'premature close',
  'other side closed',
  'connection closed',
  'stream closed',
  'headers timeout',
  'body timeout'
];

export function collectErrorText(error: unknown, depth = 0): string {
  if (depth > 4 || error == null) {
    return '';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error !== 'object') {
    return '';
  }

  const candidate = error as {
    message?: unknown;
    code?: unknown;
    cause?: unknown;
    errors?: unknown;
    lastError?: unknown;
  };
  const parts: string[] = [];

  if (typeof candidate.message === 'string') parts.push(candidate.message);
  if (typeof candidate.code === 'string') parts.push(candidate.code);
  if (candidate.lastError != null) parts.push(collectErrorText(candidate.lastError, depth + 1));
  if (candidate.cause != null) parts.push(collectErrorText(candidate.cause, depth + 1));
  if (Array.isArray(candidate.errors)) {
    for (const nested of candidate.errors) {
      parts.push(collectErrorText(nested, depth + 1));
    }
  }

  return parts.join(' ');
}

/**
 * Extracts HTTP status code recursively from various library error formats (e.g. AI SDK, Axios, fetch).
 */
export function extractStatusCode(error: unknown, depth = 0): number | undefined {
  if (depth > 4 || error == null || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    cause?: unknown;
    lastError?: unknown;
    errors?: unknown[];
  };

  if (typeof candidate.statusCode === 'number') return candidate.statusCode;
  if (typeof candidate.status === 'number') return candidate.status;

  if (candidate.lastError != null) {
    const code = extractStatusCode(candidate.lastError, depth + 1);
    if (code !== undefined) return code;
  }

  if (candidate.cause != null) {
    const code = extractStatusCode(candidate.cause, depth + 1);
    if (code !== undefined) return code;
  }

  if (Array.isArray(candidate.errors)) {
    for (const nested of candidate.errors) {
      const code = extractStatusCode(nested, depth + 1);
      if (code !== undefined) return code;
    }
  }

  return undefined;
}

/**
 * Extracts response headers from various wrapped error formats.
 */
export function extractResponseHeaders(error: unknown, depth = 0): Record<string, string | undefined> | undefined {
  if (depth > 4 || error == null || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as {
    responseHeaders?: Record<string, string | undefined>;
    headers?: Record<string, string | undefined>;
    cause?: unknown;
    lastError?: unknown;
  };

  if (candidate.responseHeaders && typeof candidate.responseHeaders === 'object') {
    return candidate.responseHeaders;
  }
  if (candidate.headers && typeof candidate.headers === 'object') {
    return candidate.headers;
  }

  if (candidate.lastError != null) {
    const headers = extractResponseHeaders(candidate.lastError, depth + 1);
    if (headers) return headers;
  }

  if (candidate.cause != null) {
    const headers = extractResponseHeaders(candidate.cause, depth + 1);
    if (headers) return headers;
  }

  return undefined;
}

const RATE_LIMIT_PATTERNS = [
  /too many requests/i,
  /rate[ -]?limit/i,
  /resource_exhausted/i,
  /quota exceeded/i,
  /exceeded your current quota/i,
  /requests per minute/i,
  /tokens per minute/i
];

export function isRateLimitError(error: unknown): boolean {
  const status = extractStatusCode(error);
  if (status === 429) {
    return true;
  }
  const text = collectErrorText(error);
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text));
}

const AUTH_PATTERNS = [
  /invalid[ _]?api[ _]?key/i,
  /incorrect[ _]?api[ _]?key/i,
  /unauthorized/i,
  /authentication failed/i,
  /permission_denied/i
];

export function isAuthError(error: unknown): boolean {
  const status = extractStatusCode(error);
  if (status === 401 || status === 403) {
    return true;
  }
  const text = collectErrorText(error);
  return AUTH_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * A capability the provider just told us this model does not have.
 */
export type RejectedCapability = 'image' | 'document' | 'tools';

const IMAGE_REJECTION_PATTERNS = [
  /does\s?n[o']?t\s+support\s+(image|vision|multimodal)/,
  /(image|vision)\s+(input|content)?\s*(is\s+)?not\s+supported/,
  /no\s+support\s+for\s+image/,
  /unsupported.{0,24}image_url/,
  /image_url.{0,24}(not\s+supported|unsupported|invalid_type)/,
  /model\s+does\s+not\s+have\s+vision/,
];

const DOCUMENT_REJECTION_PATTERNS = [
  /does\s?n[o']?t\s+support\s+(file|document|pdf)/,
  /(file|document|pdf)\s+(input|attachment)?\s*(is\s+)?not\s+supported/,
  /no\s+support\s+for\s+(file|document|pdf)/,
  /unsupported.{0,24}(file|document|pdf)/,
];

const TOOL_REJECTION_PATTERNS = [
  /does\s?n[o']?t\s+support\s+(tool|function)/,
  /(tool|function)[ _]?(call|calling|use)?s?\s+(is|are)?\s*not\s+supported/,
  /no\s+support\s+for\s+(tool|function)/,
  /unsupported\s+(parameter|field|value).{0,24}('|\\\\")?(tools|tool_choice|functions)/,
  /(tools|tool_choice|functions)\b.{0,24}(not\s+supported|unsupported|not\s+allowed)/,
];

export function detectRejectedCapability(error: unknown): RejectedCapability | null {
  const text = collectErrorText(error).toLowerCase();
  if (!text) {
    return null;
  }

  if (IMAGE_REJECTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'image';
  }

  if (DOCUMENT_REJECTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'document';
  }

  if (TOOL_REJECTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'tools';
  }

  return null;
}

export function isTransientNetworkError(error: unknown) {
  const text = collectErrorText(error).toLowerCase();
  if (!text) {
    return false;
  }

  return TRANSIENT_NETWORK_PATTERNS.some((pattern) => text.includes(pattern));
}

function isAbortError(error: unknown) {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return true;
  }

  if (error != null && typeof error === 'object') {
    const name = (error as { name?: unknown }).name;
    if (name === 'AbortError' || name === 'TimeoutError') {
      return true;
    }

    const cause = (error as { cause?: unknown }).cause;
    if (cause != null && cause !== error) {
      return isAbortError(cause);
    }
  }

  return false;
}

/**
 * Maps any unknown failure into a strongly typed Effect-TS domain error.
 */
export function toAiDomainError(error: unknown): AiDomainError {
  if (error instanceof MissingCredentialError) {
    return new TaggedMissingCredentialError({
      message: error.message,
      retryable: false,
    });
  }

  if (error instanceof RequestTimeoutError) {
    return new TimeoutError({
      message: error.message,
      retryable: true,
    });
  }

  if (error instanceof ProviderStalledError) {
    return new StreamStalledError({
      message: error.message,
      retryable: true,
    });
  }

  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown })?.message === 'string'
        ? String((error as { message: unknown }).message)
        : '';

  const headers = extractResponseHeaders(error);
  const retryAfterMs =
    error instanceof HttpStatusError && error.retryAfterMs != null
      ? error.retryAfterMs
      : parseRetryAfterMs(headers);

  const status =
    error instanceof HttpStatusError
      ? error.status
      : extractStatusCode(error);

  // 1. Rate limiting (429 or text pattern like "Too Many Requests")
  if (isRateLimitError(error)) {
    return new RateLimitError({
      message: retryAfterMs
        ? `The provider is rate limiting this model. Retrying in ${Math.ceil(retryAfterMs / 1000)}s.`
        : 'The provider is rate limiting this model right now. Pick another model or try again shortly.',
      retryAfterMs,
      retryable: true,
    });
  }

  // 2. Authentication failure (401, 403 or invalid API key pattern)
  if (isAuthError(error)) {
    return new AuthError({
      message: 'The provider rejected the API key. Revalidate it in settings.',
      retryable: false,
    });
  }

  // 3. Known HTTP status codes
  if (status === 402) {
    return new InsufficientCreditsError({
      message: 'The provider reports insufficient credits for this model.',
      retryable: false,
    });
  }

  if (status === 404) {
    return new ModelUnavailableError({
      message: rawMessage || 'This model is not available right now. Try a different model.',
      retryable: false,
    });
  }

  if (status === 408) {
    return new TimeoutError({
      message: 'The provider timed out before responding.',
      retryAfterMs,
      retryable: true,
    });
  }

  if (status != null && status >= 500) {
    return new UpstreamUnavailableError({
      message: 'The provider is temporarily unavailable.',
      retryAfterMs,
      retryable: true,
    });
  }

  // 4. Client-side Abort
  if (isAbortError(error)) {
    return new AbortedError({
      message: 'Generation stopped.',
      retryable: false,
    });
  }

  // 5. Transient transport failure
  if (isTransientNetworkError(error)) {
    return new NetworkError({
      message: 'The connection to the provider dropped. Retrying.',
      retryable: true,
    });
  }

  // 6. AI SDK Error with retryable flag
  if (isAIError(error)) {
    return new ProviderError({
      message: error.message || 'The model provider returned an error.',
      retryable: error.isRetryable ?? false,
    });
  }

  // 7. Generic / Unknown Error
  if (error instanceof Error) {
    return new UnknownAiError({
      message: error.message,
      retryable: false,
      cause: error,
    });
  }

  return new UnknownAiError({
    message: 'Unexpected error',
    retryable: false,
    cause: error,
  });
}

/**
 * Normalizes an unknown error into a NormalizedError.
 * Powered by Effect-TS domain error conversion under the hood.
 */
export function normalizeError(error: unknown): NormalizedError {
  return fromAiDomainError(toAiDomainError(error));
}

/**
 * Exponential backoff with full jitter, deferring to a provider-supplied Retry-After.
 */
export function computeRetryDelayMs(attempt: number, retryAfterMs?: number | null) {
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
  }

  const base = Math.min(500 * 2 ** attempt, 8_000);
  return base / 2 + Math.floor(Math.random() * (base / 2));
}

/**
 * Resolves after `ms`, or as soon as `signal` aborts. The signal-aware form
 * exists because a bare `setTimeout` is uninterruptible: a provider
 * `Retry-After` up to MAX_RETRY_AFTER_MS (60s) would otherwise park an
 * aborted turn with no way to observe the stop request until the timer
 * expired. Resolving (rather than rejecting) on abort keeps callers in
 * control of how to observe the stop.
 */
export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
