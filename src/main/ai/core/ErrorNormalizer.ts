export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string
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

export type NormalizedError = {
  code: string;
  message: string;
  retryable: boolean;
};

function isAIError(error: unknown): error is { statusCode?: number; message: string; isRetryable?: boolean; data?: unknown } {
  if (error == null || typeof error !== 'object') return false;
  const symbols = Object.getOwnPropertySymbols(error);
  return symbols.some((s) => s.description === 'vercel.ai.error' && (error as Record<string | symbol, unknown>)[s] === true);
}

export function normalizeError(error: unknown, providerId?: string): NormalizedError {
  const providerName = providerId ? providerId.charAt(0).toUpperCase() + providerId.slice(1) : 'The provider';

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

  if (error instanceof HttpStatusError) {
    if (error.status === 401 || error.status === 403) {
      return {
        code: 'auth_error',
        message: `${providerName} rejected the API key. Revalidate it in settings.`,
        retryable: false
      };
    }

    if (error.status === 429) {
      return {
        code: 'rate_limited',
        message: 'The selected free model is rate limited right now. Pick another model or try again shortly.',
        retryable: true
      };
    }

    if (error.status >= 500) {
      return {
        code: 'upstream_unavailable',
        message: `${providerName} is temporarily unavailable.`,
        retryable: true
      };
    }

    return {
      code: 'provider_error',
      message: error.message,
      retryable: false
    };
  }

  if (isAIError(error)) {
    const status = error.statusCode;

    if (status === 401 || status === 403) {
      return {
        code: 'auth_error',
        message: `${providerName} rejected the API key. Revalidate it in settings.`,
        retryable: false
      };
    }

    if (status === 429) {
      return {
        code: 'rate_limited',
        message: 'The selected free model is rate limited right now. Pick another model or try again shortly.',
        retryable: true
      };
    }

    if (status === 404) {
      return {
        code: 'model_unavailable',
        message: error.message || 'This model is not available right now. Try a different model.',
        retryable: false
      };
    }

    if (status && status >= 500) {
      return {
        code: 'upstream_unavailable',
        message: `${providerName} is temporarily unavailable.`,
        retryable: true
      };
    }

    return {
      code: 'provider_error',
      message: error.message || 'The model provider returned an error.',
      retryable: error.isRetryable ?? false
    };
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return {
      code: 'aborted',
      message: 'Generation stopped.',
      retryable: false
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

export function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
