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

  if (error instanceof HttpStatusError) {
    if (error.status === 401 || error.status === 403) {
      return {
        code: 'auth_error',
        message: 'OpenRouter rejected the API key. Revalidate it in settings.',
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
        message: 'OpenRouter is temporarily unavailable.',
        retryable: true
      };
    }

    return {
      code: 'provider_error',
      message: error.message,
      retryable: false
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
