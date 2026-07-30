import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpStatusError } from '../src/main/ai/core/ErrorNormalizer.js';
import { toUserFacingMessage, withUserFacingErrors } from '../src/main/ipc/errors.js';
import { logger } from '../src/main/observability/logger.js';
import { CustomProviderValidationError } from '../src/shared/customProviders.js';

/** Capture what the wrapper logged, since the logger writes nothing by default. */
function captureLogs(run: () => Promise<void>) {
  const lines: Array<Record<string, unknown>> = [];
  logger.setSink((line) => lines.push(JSON.parse(line) as Record<string, unknown>));

  return run().finally(() => {
    logger.setSink(null);
  });
}

function makeAbortError() {
  const error = new Error('The user aborted a request.');
  error.name = 'AbortError';
  return error;
}

test('toUserFacingMessage replaces internal invariants with copy a user can act on', () => {
  const cases: Array<[string, RegExp]> = [
    ['Attachments must be sent as data URLs.', /attach it again/i],
    ['Too many attachments were provided.', /up to 8 files/i],
    ['Attachments are too large to send together.', /too large to send together/i],
    ['Chat requests must end with a user message.', /write a message/i],
    ['Blocked IPC from untrusted sender: https://evil.example', /blocked for security/i],
    ['Project abc-123 not found.', /no longer attached/i],
    ['Invalid site file path: ../../etc/passwd', /not valid for this site/i]
  ];

  for (const [raw, expected] of cases) {
    const message = toUserFacingMessage(new Error(raw));
    assert.match(message, expected, raw);
    assert.notEqual(message, raw, raw);
  }
});

test('toUserFacingMessage never leaks the blocked origin', () => {
  const message = toUserFacingMessage(new Error('Blocked IPC from untrusted sender: https://evil.example'));

  assert.equal(message.includes('evil.example'), false);
});

test('toUserFacingMessage passes through messages already written for the user', () => {
  assert.equal(
    toUserFacingMessage(new CustomProviderValidationError('Enter a base URL.', 'baseUrl')),
    'Enter a base URL.'
  );
  assert.equal(toUserFacingMessage(new Error('Save an API key first.')), 'Save an API key first.');
  assert.equal(
    toUserFacingMessage(new Error('The selected model does not support image attachments.')),
    'The selected model does not support image attachments.'
  );
  assert.equal(
    toUserFacingMessage(new Error('budget.pdf exceeds the attachment size limit.')),
    'budget.pdf exceeds the attachment size limit.'
  );
});

test('toUserFacingMessage keeps the classifier copy for a provider auth failure', () => {
  assert.equal(
    toUserFacingMessage(new HttpStatusError(401, 'invalid_api_key')),
    'The provider rejected the API key. Revalidate it in settings.'
  );
});

test('toUserFacingMessage falls back to a generic sentence for unlisted internals', () => {
  for (const value of [
    new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed'),
    new Error(''),
    'a thrown string',
    { message: 'a thrown object' },
    null,
    undefined
  ]) {
    const message = toUserFacingMessage(value);
    assert.equal(message, 'Something went wrong. Try again.');
  }
});

test('toUserFacingMessage reports a stopped generation as a cancellation', () => {
  assert.equal(toUserFacingMessage(makeAbortError()), 'Generation stopped.');
});

test('withUserFacingErrors calls through and returns the handler result', async () => {
  const handler = withUserFacingErrors('test:ok', async (_event: unknown, value: number) => value * 2);

  assert.equal(await handler({}, 21), 42);
});

test('withUserFacingErrors re-throws with user copy and keeps a code to branch on', async () => {
  await captureLogs(async () => {
    const handler = withUserFacingErrors('test:fail', () => {
      throw new Error('Attachments must be sent as data URLs.');
    });

    await assert.rejects(async () => handler(), (error: Error & { code?: string }) => {
      assert.match(error.message, /attach it again/i);
      assert.equal(error.code, 'unknown_error');
      return true;
    });
  });
});

test('withUserFacingErrors logs the raw error against the channel', async () => {
  const lines: Array<Record<string, unknown>> = [];
  logger.setSink((line) => lines.push(JSON.parse(line) as Record<string, unknown>));

  try {
    const handler = withUserFacingErrors('test:logged', () => {
      throw new Error('Attachments must be sent as data URLs.');
    });

    await assert.rejects(async () => handler());
  } finally {
    logger.setSink(null);
  }

  assert.equal(lines.length, 1);
  assert.equal(lines[0].event, 'ipc.handler_failed');
  assert.equal(lines[0].channel, 'test:logged');
  assert.deepEqual((lines[0].error as { message?: string })?.message, 'Attachments must be sent as data URLs.');
});

test('withUserFacingErrors treats a cancellation as cancelled, not failed', async () => {
  const lines: Array<Record<string, unknown>> = [];
  logger.setSink((line) => lines.push(JSON.parse(line) as Record<string, unknown>));

  try {
    const handler = withUserFacingErrors('test:aborted', () => {
      throw makeAbortError();
    });

    await assert.rejects(async () => handler(), (error: Error & { code?: string }) => {
      assert.equal(error.message, 'Generation stopped.');
      assert.equal(error.code, 'aborted');
      return true;
    });
  } finally {
    logger.setSink(null);
  }

  assert.equal(lines.length, 1);
  assert.equal(lines[0].event, 'ipc.handler_cancelled');
  assert.equal(lines[0].level, 'info');
});

test('withUserFacingErrors handles a non-Error thrown value', async () => {
  await captureLogs(async () => {
    const handler = withUserFacingErrors('test:string', () => {
      throw 'boom';
    });

    await assert.rejects(async () => handler(), (error: Error) => {
      assert.equal(error.message, 'Something went wrong. Try again.');
      return true;
    });
  });
});
