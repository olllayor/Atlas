import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelMessage } from 'ai';

import { buildClaudePrompt } from '../src/main/ai/providers/claude/claudePrompt.js';
import { resolveEffortForModel } from '../src/main/ai/providers/claude/ClaudeAgentAdapter.js';

const text = (content: string): ModelMessage[] => [{ role: 'user', content }];

test('prompt: plain text stays a string', () => {
  const built = buildClaudePrompt({ messages: text('hello') });
  assert.equal(built.prompt, 'hello');
  assert.deepEqual(built.deferredPaths, []);
});

test('prompt: image bytes become a native block, unknown files defer to paths', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image', image: bytes, mediaType: 'image/png' },
        { type: 'file', data: bytes, mediaType: 'application/zip', filename: 'a.zip' }
      ]
    }
  ];
  const built = buildClaudePrompt({ messages });
  assert.equal(typeof built.prompt, 'object');
  const blocks = (built.prompt as { message: { content: unknown[] } }).message.content;
  assert.equal(blocks.length, 2);
  assert.equal((blocks[0] as { type: string }).type, 'image');
  assert.equal((blocks[1] as { type: string }).type, 'text');
  assert.deepEqual(built.deferredPaths, ['a.zip']);
});

test('prompt: pdf bytes become a document block', () => {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [{ type: 'file', data: new Uint8Array([4]), mediaType: 'application/pdf' }]
    }
  ];
  const built = buildClaudePrompt({ messages });
  const blocks = (built.prompt as { message: { content: unknown[] } }).message.content;
  assert.equal((blocks[0] as { type: string }).type, 'document');
  assert.deepEqual(built.deferredPaths, []);
});

test('prompt: $skill mention dispatches to a trailing command', () => {
  const built = buildClaudePrompt({ messages: text('please $review this'), skillNames: new Set(['review']) });
  const blocks = (built.prompt as { message: { content: unknown[] } }).message.content;
  assert.equal(blocks.length, 2);
  assert.equal((blocks[0] as { text: string }).text, 'please');
  assert.equal((blocks[1] as { text: string }).text, '/review this');
});

test('effort gating: unknown models keep the level, unsupported models drop it', () => {
  assert.deepEqual(resolveEffortForModel('high', 'whatever', null), { effort: 'high', dropped: false });
  assert.deepEqual(
    resolveEffortForModel('high', 'm', [{ id: 'm', label: 'm', supportsEffort: false }]),
    { effort: null, dropped: true }
  );
  assert.deepEqual(
    resolveEffortForModel('max', 'm', [{ id: 'm', label: 'm', supportsEffort: true, supportedEffortLevels: ['low'] }]),
    { effort: null, dropped: true }
  );
  assert.deepEqual(resolveEffortForModel('minimal', 'm', null), { effort: null, dropped: false });
  assert.deepEqual(resolveEffortForModel(undefined, 'm', null), { effort: null, dropped: false });
});
