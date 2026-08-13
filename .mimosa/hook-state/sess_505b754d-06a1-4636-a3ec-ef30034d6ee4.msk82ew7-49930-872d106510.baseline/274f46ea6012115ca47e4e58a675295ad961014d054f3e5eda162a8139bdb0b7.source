import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MESSAGE_OVERHEAD_TOKENS,
  estimateImageTokens,
  estimateJsonTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateTextTokens,
} from '../src/shared/tokenEstimate.js';

test('prose lands near the familiar chars-per-token figure', () => {
  // ~60 chars of ordinary English: the chars/4 reading is ~15 tokens.
  const prose = 'The quick brown fox jumps over the lazy dog and keeps going.';
  const tokens = estimateTextTokens(prose);

  assert.ok(tokens >= 12 && tokens <= 22, `expected 12..22, got ${tokens}`);
});

test('punctuation-dense text costs more per character than prose', () => {
  // Same length, wildly different tokenization. The old chars/4 rule scored
  // these identically and under-counted every code block in a transcript.
  const code = 'const a=[1,2,3].map((x)=>{return x*2;});if(a[0]!==2){throw 0}';
  const prose = 'we should probably rewrite this part of the code later on ok';

  const codeDensity = estimateTextTokens(code) / code.length;
  const proseDensity = estimateTextTokens(prose) / prose.length;

  assert.ok(
    codeDensity > proseDensity,
    `dense text must cost more per character (code ${codeDensity}, prose ${proseDensity})`
  );
});

test('empty and whitespace-only text is free', () => {
  assert.equal(estimateTextTokens(''), 0);
  assert.equal(estimateTextTokens('   \n\t '), 0);
});

test('a message costs its content plus a fixed role overhead', () => {
  const empty = estimateMessageTokens({ role: 'user', content: '' });
  assert.equal(empty, MESSAGE_OVERHEAD_TOKENS);

  // Overhead is per message, so many short turns are not free.
  const many = estimateMessagesTokens(
    Array.from({ length: 10 }, () => ({ role: 'user' as const, content: 'ok' }))
  );
  assert.ok(many >= 10 * MESSAGE_OVERHEAD_TOKENS);
});

test('images are priced by area, with a cap and a sane unknown-size fallback', () => {
  assert.equal(estimateImageTokens({ width: 750, height: 1000 }), 1_000);
  // Downscaling means cost stops growing with pixels.
  assert.equal(estimateImageTokens({ width: 10_000, height: 10_000 }), 2_400);
  // Unknown dimensions must not read as free.
  assert.ok(estimateImageTokens() > 0);
  assert.ok(estimateImageTokens({ width: 0, height: 0 }) > 0);
});

test('tool calls are measured from their payloads, not their labels', () => {
  const withBigOutput = estimateMessageTokens({
    role: 'assistant',
    content: [
      {
        type: 'tool-result',
        toolName: 'bash',
        input: { command: 'ls' },
        output: { text: 'x'.repeat(4_000) },
      },
    ],
  });

  // A 4K-char tool result is the largest thing in most transcripts; counting
  // only the tool name would report it as nearly free.
  assert.ok(withBigOutput > 800, `expected >800, got ${withBigOutput}`);
});

test('image parts inside a message body are counted', () => {
  const text = estimateMessageTokens({ role: 'user', content: [{ type: 'text', text: 'look' }] });
  const withImage = estimateMessageTokens({
    role: 'user',
    content: [
      { type: 'text', text: 'look' },
      { type: 'image', width: 750, height: 750 },
    ],
  });

  assert.ok(withImage - text >= 700);
});

test('unserialisable values degrade instead of throwing', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  assert.doesNotThrow(() => estimateJsonTokens(cyclic));
});
