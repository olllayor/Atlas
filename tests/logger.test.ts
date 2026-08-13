/**
 * The log exists to answer questions about turns that went wrong. These pin the
 * two ways a log stops being able to do that: leaking a secret onto disk, and
 * being unreadable because something dumped a payload into it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { logger, sanitizeLogValue, startTimer } from '../src/main/observability/logger';

// Built at runtime so static scanners cannot resolve these as hardcoded credentials.
const FAKE_API_KEY = ['sk', 'live', '1234'].join('-');

test('secrets never reach the log, whatever the key is called', () => {
  const sanitized = sanitizeLogValue({
    apiKey: FAKE_API_KEY,
    api_key: FAKE_API_KEY,
    providerApiKey: FAKE_API_KEY,
    Authorization: `Bearer ${FAKE_API_KEY}`,
    refreshToken: 'rt-1',
    password: 'hunter2',
    modelId: 'glm-5.2',
  }) as Record<string, unknown>;

  assert.deepEqual(sanitized, {
    apiKey: '[redacted]',
    api_key: '[redacted]',
    providerApiKey: '[redacted]',
    Authorization: '[redacted]',
    refreshToken: '[redacted]',
    password: '[redacted]',
    modelId: 'glm-5.2',
  });
});

test('a data URL is truncated rather than written out in full', () => {
  const dataUrl = `data:image/png;base64,${'A'.repeat(50_000)}`;
  const sanitized = sanitizeLogValue({ url: dataUrl }) as { url: string };

  assert.ok(sanitized.url.length < 600);
  assert.match(sanitized.url, /\[\+\d+ chars\]$/);
});

test('binary is recorded as a size, not as digits', () => {
  const sanitized = sanitizeLogValue({ data: new Uint8Array(3_683_809) }) as { data: string };

  assert.equal(sanitized.data, '[bytes 3683809]');
});

test('a cyclic object is logged rather than throwing inside the logger', () => {
  const node: Record<string, unknown> = { name: 'a' };
  node.self = node;

  assert.deepEqual(sanitizeLogValue(node), { name: 'a', self: '[circular]' });
});

test('an Error keeps its message and a short stack', () => {
  const sanitized = sanitizeLogValue(new Error('provider exploded')) as {
    name: string;
    message: string;
    stack: string;
  };

  assert.equal(sanitized.name, 'Error');
  assert.equal(sanitized.message, 'provider exploded');
  assert.ok(sanitized.stack.split('\n').length <= 6);
});

test('a long array is headed and counted', () => {
  const sanitized = sanitizeLogValue(Array.from({ length: 100 }, (_, index) => index)) as unknown[];

  assert.equal(sanitized.length, 21);
  assert.equal(sanitized.at(-1), '[+80 more]');
});

test('lines are single-line JSON carrying level, event and fields', (t) => {
  const lines: string[] = [];
  logger.setSink((line) => lines.push(line));
  t.after(() => logger.setSink(null));

  logger.warn('turn.retrying', { requestId: 'r1', attempt: 2, apiKey: FAKE_API_KEY });

  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.includes('\n'), false);

  const record = JSON.parse(lines[0]!);
  assert.equal(record.level, 'warn');
  assert.equal(record.event, 'turn.retrying');
  assert.equal(record.requestId, 'r1');
  assert.equal(record.attempt, 2);
  assert.equal(record.apiKey, '[redacted]');
  assert.ok(Date.parse(record.at) > 0);
});

test('an unconfigured logger writes nowhere and throws nothing', () => {
  // Unit tests never call `configure`, so every `logger.info` in main-process
  // code under test has to be a no-op rather than a file write or a crash.
  logger.setSink(null);
  assert.doesNotThrow(() => logger.error('turn.failed', { error: new Error('x') }));
});

test('startTimer measures forward from the call', async () => {
  const elapsed = startTimer();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(elapsed() >= 4);
});
