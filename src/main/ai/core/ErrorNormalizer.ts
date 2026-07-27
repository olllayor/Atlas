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

function collectErrorText(error: unknown, depth = 0): string {
  if (depth > 4 || error == null) {
    return '';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error !== 'object') {
    return '';
  }

  const candidate = error as { message?: unknown; code?: unknown; cause?: unknown; errors?: unknown };
  const parts: string[] = [];

  if (typeof candidate.message === 'string') parts.push(candidate.message);
  if (typeof candidate.code === 'string') parts.push(candidate.code);
  if (candidate.cause != null) parts.push(collectErrorText(candidate.cause, depth + 1));
  if (Array.isArray(candidate.errors)) {
    for (const nested of candidate.errors) {
      parts.push(collectErrorText(nested, depth + 1));
    }
  }

  return parts.join(' ');
}

/**
 * Transport-level failures are the most common way a long stream dies and they
 * are always worth another attempt — the previous build classified them as
 * `unknown_error` and gave up immediately.
 */
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

function normalizeStatus(status: number | undefined, message: string, retryAfterMs: number | null): NormalizedError | null {
  if (status === 401 || status === 403) {
    return {
      code: 'auth_error',
      message: 'The provider rejected the API key. Revalidate it in settings.',
      retryable: false
    };
  }

  if (status === 402) {
    return {
      code: 'insufficient_credits',
      message: 'The provider reports insufficient credits for this model.',
      retryable: false
    };
  }

  if (status === 404) {
    return {
      code: 'model_unavailable',
      message: message || 'This model is not available right now. Try a different model.',
      retryable: false
    };
  }

  if (status === 408) {
    return {
      code: 'timeout',
      message: 'The provider timed out before responding.',
      retryable: true,
      retryAfterMs
    };
  }

  if (status === 429) {
    return {
      code: 'rate_limited',
      message: retryAfterMs
        ? `The provider is rate limiting this model. Retrying in ${Math.ceil(retryAfterMs / 1000)}s.`
        : 'The provider is rate limiting this model right now. Pick another model or try again shortly.',
      retryable: true,
      retryAfterMs
    };
  }

  if (status === 502 || status === 503 || status === 504) {
    return {
      code: 'upstream_unavailable',
      message: 'The provider is temporarily unavailable.',
      retryable: true,
      retryAfterMs
    };
  }

  if (status != null && status >= 500) {
    return {
      code: 'upstream_unavailable',
      message: 'The provider is temporarily unavailable.',
      retryable: true,
      retryAfterMs
    };
  }

  return null;
}

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof MissingCredentialError) {
    return {
      code: 'missing_credential',
      message: error.message,
      retryable: false
    };
  }

  if (error instanceof RequestTimeoutError) {
    return {
      code: 'timeout',
      message: error.message,
      retryable: true
    };
  }

  if (error instanceof ProviderStalledError) {
    return {
      code: 'stream_stalled',
      message: error.message,
      retryable: true
    };
  }

  if (error instanceof HttpStatusError) {
    return (
      normalizeStatus(error.status, error.message, error.retryAfterMs) ?? {
        code: 'provider_error',
        message: error.message,
        retryable: false
      }
    );
  }

  if (isAIError(error)) {
    const retryAfterMs = parseRetryAfterMs(error.responseHeaders);
    const byStatus = normalizeStatus(error.statusCode, error.message, retryAfterMs);
    if (byStatus) {
      return byStatus;
    }

    // A wrapped transport failure carries no status but is still worth a retry.
    if (error.statusCode == null && isTransientNetworkError(error)) {
      return {
        code: 'network_error',
        message: 'The connection to the provider dropped. Retrying.',
        retryable: true
      };
    }

    return {
      code: 'provider_error',
      message: error.message || 'The model provider returned an error.',
      retryable: error.isRetryable ?? false
    };
  }

  if (isAbortError(error)) {
    return {
      code: 'aborted',
      message: 'Generation stopped.',
      retryable: false
    };
  }

  if (isTransientNetworkError(error)) {
    return {
      code: 'network_error',
      message: 'The connection to the provider dropped. Retrying.',
      retryable: true
    };
  }

  if (error instanceof Error) {
    return {
      code: 'unknown_error',
      message: error.message,
      retryable: false
    };
  }

  return {
    code: 'unknown_error',
    message: 'Unexpected error',
    retryable: false
  };
}

/**
 * Exponential backoff with full jitter, deferring to a provider-supplied
 * Retry-After when there is one.
 */
export function computeRetryDelayMs(attempt: number, retryAfterMs?: number | null) {
  if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
  }

  const base = Math.min(500 * 2 ** attempt, 8_000);
  return base / 2 + Math.floor(Math.random() * (base / 2));
}

export function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
