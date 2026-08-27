import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTerminalContextBlock,
  composerHasTerminalContext,
  stripTerminalContextBlocks,
} from '../src/renderer/lib/terminalContext.js';

test('buildTerminalContextBlock fences a selection with the shell label', () => {
  const block = buildTerminalContextBlock({ shell: 'zsh', selection: 'npm test\n 3 passing' });
  assert.equal(
    block,
    '<terminal_context>\n- zsh:\n  npm test\n   3 passing\n</terminal_context>'
  );
});

test('buildTerminalContextBlock falls back to a generic label and rejects empty input', () => {
  assert.equal(buildTerminalContextBlock({ selection: 'ls' }), '<terminal_context>\n- terminal:\n  ls\n</terminal_context>');
  assert.equal(buildTerminalContextBlock({ selection: '   \n  ' }), '');
});

test('buildTerminalContextBlock truncates runaway output with an ellipsis notice', () => {
  const block = buildTerminalContextBlock({ selection: 'x'.repeat(10_000) });
  assert.ok(block.length < 10_000);
  assert.ok(block.includes('… (truncated)'));
});

test('composerHasTerminalContext detects a present block', () => {
  const text = `fix this${buildTerminalContextBlock({ selection: 'err' })}`;
  assert.equal(composerHasTerminalContext(text), true);
  assert.equal(composerHasTerminalContext('plain prompt'), false);
});

test('stripTerminalContextBlocks removes blocks and trailing whitespace, keeps prose', () => {
  const text = `why failing?\n${buildTerminalContextBlock({ shell: 'zsh', selection: 'ECONNREFUSED' })}`;
  assert.equal(stripTerminalContextBlocks(text), 'why failing?');
});
