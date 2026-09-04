import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SESSION_TITLE_MAX_LENGTH,
  deriveTitleFromUserMessage,
  isPlaceholderSessionTitle,
  sanitizeGeneratedTitle
} from '../src/shared/sessionTitles';

test('placeholder detection matches only the create() shape', () => {
  assert.equal(isPlaceholderSessionTitle('Session · Jul 30, 01:22 AM'), true);
  assert.equal(isPlaceholderSessionTitle('Fixing the auth flow'), false);
  assert.equal(isPlaceholderSessionTitle('My Session · notes'), false);
  assert.equal(isPlaceholderSessionTitle(null), false);
  assert.equal(isPlaceholderSessionTitle(undefined), false);
});

test('clean titles pass through unchanged', () => {
  assert.equal(sanitizeGeneratedTitle('Fixing the auth flow'), 'Fixing the auth flow');
});

test('strips quotes, labels, markdown, and trailing punctuation', () => {
  assert.equal(sanitizeGeneratedTitle('"Debugging CSS Grid."'), 'Debugging CSS Grid');
  assert.equal(sanitizeGeneratedTitle('Title: Electron IPC basics'), 'Electron IPC basics');
  assert.equal(sanitizeGeneratedTitle('**Refactor plan**'), 'Refactor plan');
  assert.equal(sanitizeGeneratedTitle('“Модель не отвечает”'), 'Модель не отвечает');
});

test('keeps only the first non-empty line', () => {
  assert.equal(
    sanitizeGeneratedTitle('\n\nRate limiter design\n\nThis title reflects the discussion about…'),
    'Rate limiter design'
  );
});

test('rejects empty results', () => {
  assert.equal(sanitizeGeneratedTitle(''), null);
  assert.equal(sanitizeGeneratedTitle('   '), null);
  assert.equal(sanitizeGeneratedTitle('"…"'), null);
  assert.equal(sanitizeGeneratedTitle(null), null);
});

test('local fallback names a session from the opening message', () => {
  assert.equal(
    deriveTitleFromUserMessage('tell me diff between atlas chat and atlas work?'),
    'tell me diff between atlas chat and atlas work'
  );
});

test('local fallback converts citations to quote text and drops href bytes', () => {
  const link =
    '[Assistant quote](atlas-citation://v1/conv-1/msg-1?text=Database%20connection%20timeout&start=0&end=27&prefix=&suffix=)';
  assert.equal(
    deriveTitleFromUserMessage(`Investigate: ${link}`),
    'Investigate: Database connection timeout'
  );
});

test('local fallback takes the first sentence when it stands alone', () => {
  assert.equal(
    deriveTitleFromUserMessage('Fix the login bug. It throws on expired tokens and I cannot reproduce it.'),
    'Fix the login bug'
  );
});

test('local fallback drops code blocks and survives code-only messages', () => {
  assert.equal(
    deriveTitleFromUserMessage('Why does this fail?\n```ts\nconst x: number = "a";\n```'),
    'Why does this fail'
  );
  assert.equal(deriveTitleFromUserMessage('```\njust code\n```'), null);
  assert.equal(deriveTitleFromUserMessage('   '), null);
  assert.equal(deriveTitleFromUserMessage(null), null);
});

test('local fallback respects the length cap', () => {
  const result = deriveTitleFromUserMessage(
    'I need help understanding how the virtualized transcript measures rows during streaming updates'
  );
  assert.ok(result != null && result.length <= SESSION_TITLE_MAX_LENGTH);
});

test('long output truncates on a word boundary within the cap', () => {
  const long = 'Investigating the intermittent websocket reconnect failures in production clusters';
  const result = sanitizeGeneratedTitle(long);
  assert.ok(result != null && result.length <= SESSION_TITLE_MAX_LENGTH);
  assert.ok(!result!.endsWith(' '));
  assert.ok(long.startsWith(result!));
  // Cut lands between words, not mid-word.
  assert.notEqual(long[result!.length], undefined);
  assert.equal(long[result!.length], ' ');
});
