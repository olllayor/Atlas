import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HttpStatusError,
  ProviderStalledError,
  computeRetryDelayMs,
  isTransientNetworkError,
  normalizeError,
  parseRetryAfterMs
} from '../src/main/ai/core/ErrorNormalizer.js';

test('normalizeError treats dropped connections as retryable', () => {
  for (const message of ['fetch failed', 'socket hang up', 'terminated', 'ECONNRESET']) {
    const normalized = normalizeError(new Error(message));
    assert.equal(normalized.code, 'network_error', message);
    assert.equal(normalized.retryable, true, message);
  }
});

test('normalizeError unwraps a nested transport cause', () => {
  const error = new Error('request failed', { cause: new Error('ECONNRESET') });

  assert.equal(normalizeError(error).retryable, true);
});

test('normalizeError leaves genuine application errors non-retryable', () => {
  const normalized = normalizeError(new Error('Tool schema is invalid'));

  assert.equal(normalized.code, 'unknown_error');
  assert.equal(normalized.retryable, false);
});

test('normalizeError surfaces the provider backoff for rate limits', () => {
  const normalized = normalizeError(new HttpStatusError(429, 'slow down', 4_000));

  assert.equal(normalized.code, 'rate_limited');
  assert.equal(normalized.retryable, true);
  assert.equal(normalized.retryAfterMs, 4_000);
  assert.match(normalized.message, /4s/);
});

test('normalizeError maps gateway failures to a retryable upstream code', () => {
  for (const status of [500, 502, 503, 504]) {
    const normalized = normalizeError(new HttpStatusError(status, 'bad gateway'));
    assert.equal(normalized.code, 'upstream_unavailable', String(status));
    assert.equal(normalized.retryable, true, String(status));
  }
});

test('normalizeError distinguishes a stalled stream from a cold timeout', () => {
  const normalized = normalizeError(new ProviderStalledError());

  assert.equal(normalized.code, 'stream_stalled');
  assert.equal(normalized.retryable, true);
});

test('normalizeError recognises an abort raised through a cause chain', () => {
  const abort = new Error('aborted');
  abort.name = 'AbortError';

  assert.equal(normalizeError(new Error('stream failed', { cause: abort })).code, 'aborted');
});

test('parseRetryAfterMs reads delta-seconds, dates, and the ratelimit reset header', () => {
  assert.equal(parseRetryAfterMs({ 'retry-after': '3' }), 3_000);
  assert.equal(parseRetryAfterMs({ 'Retry-After': '2' }), 2_000);

  const inFive = new Date(Date.now() + 5_000).toUTCString();
  const parsed = parseRetryAfterMs({ 'retry-after': inFive });
  assert.ok(parsed !== null && parsed > 1_000 && parsed <= 6_000);

  const reset = parseRetryAfterMs({ 'x-ratelimit-reset': String(Date.now() + 7_000) });
  assert.ok(reset !== null && reset > 3_000 && reset <= 8_000);

  assert.equal(parseRetryAfterMs(undefined), null);
  assert.equal(parseRetryAfterMs({}), null);
});

test('parseRetryAfterMs caps absurd backoff requests', () => {
  assert.equal(parseRetryAfterMs({ 'retry-after': '99999' }), 60_000);
});

test('computeRetryDelayMs backs off exponentially and honours Retry-After', () => {
  assert.equal(computeRetryDelayMs(0, 2_500), 2_500);

  const first = computeRetryDelayMs(0);
  const third = computeRetryDelayMs(2);

  assert.ok(first >= 250 && first <= 500);
  assert.ok(third >= 1_000 && third <= 2_000);
  // Never unbounded, no matter how many attempts.
  assert.ok(computeRetryDelayMs(20) <= 8_000);
});

test('isTransientNetworkError ignores unrelated messages', () => {
  assert.equal(isTransientNetworkError(new Error('invalid model id')), false);
});
