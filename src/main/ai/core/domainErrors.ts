import { Data } from 'effect';
import type { NormalizedError } from './ErrorNormalizer';

/**
 * Domain-level error types modeled with Effect-TS Data.TaggedError.
 * These provide strongly typed error channels with compile-time exhaustiveness,
 * pattern matching, and declarative retry schedules.
 */

export class RateLimitError extends Data.TaggedError('RateLimitError')<{
  readonly message: string;
  readonly retryAfterMs?: number | null;
  readonly retryable: true;
}> {}

export class AuthError extends Data.TaggedError('AuthError')<{
  readonly message: string;
  readonly retryable: false;
}> {}

export class InsufficientCreditsError extends Data.TaggedError('InsufficientCreditsError')<{
  readonly message: string;
  readonly retryable: false;
}> {}

export class ModelUnavailableError extends Data.TaggedError('ModelUnavailableError')<{
  readonly message: string;
  readonly retryable: false;
}> {}

export class TimeoutError extends Data.TaggedError('TimeoutError')<{
  readonly message: string;
  readonly retryAfterMs?: number | null;
  readonly retryable: true;
}> {}

export class UpstreamUnavailableError extends Data.TaggedError('UpstreamUnavailableError')<{
  readonly message: string;
  readonly retryAfterMs?: number | null;
  readonly retryable: true;
}> {}

export class StreamStalledError extends Data.TaggedError('StreamStalledError')<{
  readonly message: string;
  readonly retryable: true;
}> {}

export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly message: string;
  readonly retryable: true;
}> {}

export class AbortedError extends Data.TaggedError('AbortedError')<{
  readonly message: string;
  readonly retryable: false;
}> {}

export class MissingCredentialError extends Data.TaggedError('MissingCredentialError')<{
  readonly message: string;
  readonly retryable: false;
}> {}

export class ProviderError extends Data.TaggedError('ProviderError')<{
  readonly message: string;
  readonly retryable: boolean;
}> {}

export class UnknownAiError extends Data.TaggedError('UnknownAiError')<{
  readonly message: string;
  readonly retryable: false;
  readonly cause?: unknown;
}> {}

export type AiDomainError =
  | RateLimitError
  | AuthError
  | InsufficientCreditsError
  | ModelUnavailableError
  | TimeoutError
  | UpstreamUnavailableError
  | StreamStalledError
  | NetworkError
  | AbortedError
  | MissingCredentialError
  | ProviderError
  | UnknownAiError;

/**
 * Maps an AiDomainError to a serializable NormalizedError for IPC and UI display.
 */
export function fromAiDomainError(error: AiDomainError): NormalizedError {
  switch (error._tag) {
    case 'RateLimitError':
      return {
        code: 'rate_limited',
        message: error.message,
        retryable: true,
        retryAfterMs: error.retryAfterMs ?? null,
      };
    case 'AuthError':
      return {
        code: 'auth_error',
        message: error.message,
        retryable: false,
      };
    case 'InsufficientCreditsError':
      return {
        code: 'insufficient_credits',
        message: error.message,
        retryable: false,
      };
    case 'ModelUnavailableError':
      return {
        code: 'model_unavailable',
        message: error.message,
        retryable: false,
      };
    case 'TimeoutError':
      return {
        code: 'timeout',
        message: error.message,
        retryable: true,
        retryAfterMs: error.retryAfterMs ?? null,
      };
    case 'UpstreamUnavailableError':
      return {
        code: 'upstream_unavailable',
        message: error.message,
        retryable: true,
        retryAfterMs: error.retryAfterMs ?? null,
      };
    case 'StreamStalledError':
      return {
        code: 'stream_stalled',
        message: error.message,
        retryable: true,
      };
    case 'NetworkError':
      return {
        code: 'network_error',
        message: error.message,
        retryable: true,
      };
    case 'AbortedError':
      return {
        code: 'aborted',
        message: error.message,
        retryable: false,
      };
    case 'MissingCredentialError':
      return {
        code: 'missing_credential',
        message: error.message,
        retryable: false,
      };
    case 'ProviderError':
      return {
        code: 'provider_error',
        message: error.message,
        retryable: error.retryable,
      };
    case 'UnknownAiError':
      return {
        code: 'unknown_error',
        message: error.message,
        retryable: false,
      };
  }
}
