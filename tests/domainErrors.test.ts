import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect, Schedule } from 'effect';

import {
  AuthError,
  RateLimitError,
  TimeoutError,
  fromAiDomainError,
  makeAiRetrySchedule,
} from '../src/main/ai/core/domainErrors.js';
import { asAiEffect, toAiDomainError } from '../src/main/ai/core/ErrorNormalizer.js';

test('AiDomainError tagged classes have correct tags and serialization', () => {
  const rateLimit = new RateLimitError({
    message: 'Too many requests',
    retryAfterMs: 5000,
    retryable: true,
  });

  assert.equal(rateLimit._tag, 'RateLimitError');
  assert.equal(rateLimit.retryAfterMs, 5000);
  assert.equal(rateLimit.retryable, true);

  const normalized = fromAiDomainError(rateLimit);
  assert.equal(normalized.code, 'rate_limited');
  assert.equal(normalized.retryAfterMs, 5000);
  assert.equal(normalized.retryable, true);
});

test('Effect.catchTags allows exhaustive typed branching over domain errors', async () => {
  const failingEffect = asAiEffect(async () => {
    const error = new Error('invalid api key');
    (error as { status?: number }).status = 401;
    throw error;
  });

  const handled = failingEffect.pipe(
    Effect.catchTags({
      AuthError: (err) => Effect.succeed(`Handled auth: ${err.message}`),
      RateLimitError: () => Effect.succeed('Handled rate limit'),
      TimeoutError: () => Effect.succeed('Handled timeout'),
      InsufficientCreditsError: () => Effect.succeed('Handled credits'),
      ModelUnavailableError: () => Effect.succeed('Handled model'),
      UpstreamUnavailableError: () => Effect.succeed('Handled upstream'),
      StreamStalledError: () => Effect.succeed('Handled stalled'),
      NetworkError: () => Effect.succeed('Handled network'),
      AbortedError: () => Effect.succeed('Handled abort'),
      MissingCredentialError: () => Effect.succeed('Handled credential'),
      ProviderError: () => Effect.succeed('Handled provider'),
      UnknownAiError: () => Effect.succeed('Handled unknown'),
    })
  );

  const message = await Effect.runPromise(handled);
  assert.match(message, /Handled auth/);
});

test('makeAiRetrySchedule retries on retryable errors and succeeds when recovering', async () => {
  let attempts = 0;
  const flakeyService = Effect.gen(function* () {
    attempts++;
    if (attempts < 3) {
      return yield* Effect.fail(
        new RateLimitError({ message: '429', retryAfterMs: null, retryable: true })
      );
    }
    return 'recovered';
  });

  const scheduled = flakeyService.pipe(
    Effect.retry({
      schedule: makeAiRetrySchedule({ maxRetries: 4, initialDelayMs: 5, maxDelayMs: 20 }),
      while: (err) => err._tag === 'RateLimitError',
    })
  );

  const result = await Effect.runPromise(scheduled);
  assert.equal(result, 'recovered');
  assert.equal(attempts, 3);
});
