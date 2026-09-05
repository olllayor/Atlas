import assert from 'node:assert/strict';
import test from 'node:test';

import { createTerminalTools } from '../src/main/ai/tools/terminalTools.js';
import type { TerminalReadback } from '../src/main/ai/tools/toolWorkspace.js';

type ReadResult = {
  alive: boolean;
  cwd: string | null;
  text: string;
};

function toolFor(snapshot: TerminalReadback['snapshot']) {
  const tools = createTerminalTools({ snapshot }, 'conv-1');
  return (tools.terminal_read as unknown as {
    execute: (input: { max_chars?: number }) => Promise<ReadResult>;
  }).execute;
}

test('terminal_read reports an absent session without throwing', async () => {
  const result = await toolFor(() => ({ alive: false, cwd: null, scrollback: '' }))({});
  assert.equal(result.alive, false);
  assert.equal(result.cwd, null);
  assert.match(result.text, /no terminal session/);
});

test('terminal_read strips ANSI styling and reports cwd', async () => {
  const raw = '\x1b[2m› git status\x1b[0m\r\n\x1b[1;32mon branch main\x1b[0m\r\n';
  const result = await toolFor(() => ({
    alive: true,
    cwd: '/repo/.atlas-worktrees/c',
    scrollback: raw,
  }))({});
  assert.equal(result.alive, true);
  assert.equal(result.cwd, '/repo/.atlas-worktrees/c');
  assert.equal(result.text.includes('\x1b'), false);
  assert.match(result.text, /on branch main/);
});

test('terminal_read keeps only the trailing window within the budget', async () => {
  const line = 'x'.repeat(100) + '\n';
  const raw = line.repeat(200); // 20_200 chars
  const result = await toolFor(() => ({ alive: true, cwd: '/repo', scrollback: raw }))({
    max_chars: 500,
  });
  // Tail is kept exactly, so the final whole line survives intact.
  assert.ok(result.text.length <= 500);
  assert.ok(result.text.endsWith('x'.repeat(100) + '\n'));
});
