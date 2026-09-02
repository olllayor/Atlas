import assert from 'node:assert/strict';
import test from 'node:test';

import type { TerminalSummary } from '../src/shared/contracts.js';
import {
  PRIMARY_TERMINAL_ID,
  isTerminalId,
  nextTerminalId,
  terminalLabelFromId,
} from '../src/shared/terminalIds.js';
import {
  inspectSubprocess,
  normalizeChildCommandName,
  parseProcessTable,
} from '../src/main/terminal/processTree.js';
import {
  applyTerminalMetadata,
  terminalLabel,
} from '../src/renderer/components/workbench/terminalsModel.js';

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

test('the lowest unused id wins, so closing a middle tab reuses its number', () => {
  assert.equal(nextTerminalId([]), 'term-1');
  assert.equal(nextTerminalId(['term-1']), 'term-2');
  assert.equal(nextTerminalId(['term-1', 'term-3']), 'term-2');
  assert.equal(nextTerminalId(['term-2', 'term-1']), 'term-3');
});

test('only well-formed ids are accepted, because an id is a map key', () => {
  assert.equal(isTerminalId(PRIMARY_TERMINAL_ID), true);
  assert.equal(isTerminalId('term-12'), true);
  assert.equal(isTerminalId('term-'), false);
  assert.equal(isTerminalId('../../etc'), false);
  assert.equal(isTerminalId(''), false);
  assert.equal(isTerminalId(7), false);
});

test('an idle shell falls back to its ordinal', () => {
  assert.equal(terminalLabelFromId('term-2'), 'Terminal 2');
  assert.equal(terminalLabelFromId('weird'), 'weird');
});

// ---------------------------------------------------------------------------
// Process table
// ---------------------------------------------------------------------------

const PS_OUTPUT = [
  '    1     0 /sbin/launchd',
  '  501     1 /bin/zsh',
  '  733   501 /usr/local/bin/pnpm',
  '  801   733 /usr/bin/node',
  '  920     1 /Applications/Some App.app/Contents/MacOS/Some App',
  'garbage line',
  '',
].join('\n');

test('ps output folds into a parent/child table', () => {
  const table = parseProcessTable(PS_OUTPUT);

  assert.deepEqual(table.childrenByParent.get(1), [501, 920]);
  assert.deepEqual(table.childrenByParent.get(501), [733]);
  assert.equal(table.commandById.get(801), '/usr/bin/node');
});

test('a command containing spaces survives parsing', () => {
  const table = parseProcessTable(PS_OUTPUT);
  assert.equal(table.commandById.get(920), '/Applications/Some App.app/Contents/MacOS/Some App');
});

test('an idle shell reports no subprocess', () => {
  const table = parseProcessTable(PS_OUTPUT);
  assert.deepEqual(inspectSubprocess(table, 801), {
    hasRunningSubprocess: false,
    childCommand: null,
  });
});

test('a busy shell is named after its first child', () => {
  const table = parseProcessTable(PS_OUTPUT);
  assert.deepEqual(inspectSubprocess(table, 501), {
    hasRunningSubprocess: true,
    childCommand: 'pnpm',
  });
});

test('the label is a basename, without a login shell dash', () => {
  assert.equal(normalizeChildCommandName('/bin/zsh'), 'zsh');
  assert.equal(normalizeChildCommandName('-zsh'), 'zsh');
  assert.equal(normalizeChildCommandName('  /usr/bin/node  '), 'node');
  assert.equal(normalizeChildCommandName(''), null);
  assert.equal(normalizeChildCommandName('-'), null);
});

test('a long command name is truncated rather than pushing the strip wide', () => {
  const label = normalizeChildCommandName('/bin/' + 'a'.repeat(80));
  assert.equal(label?.length, 32);
  assert.ok(label?.endsWith('…'));
});

// ---------------------------------------------------------------------------
// The renderer's fold
// ---------------------------------------------------------------------------

function summary(overrides: Partial<TerminalSummary> = {}): TerminalSummary {
  return {
    conversationId: 'c1',
    terminalId: 'term-1',
    cwd: '/repo',
    status: 'running',
    pid: 100,
    exitCode: null,
    hasRunningSubprocess: false,
    label: 'Terminal 1',
    ...overrides,
  };
}

test('a snapshot replaces the list for its own conversation only', () => {
  const current = [summary()];
  const mine = applyTerminalMetadata(
    current,
    { type: 'snapshot', conversationId: 'c1', terminals: [summary({ terminalId: 'term-2' })] },
    'c1'
  );
  assert.deepEqual(
    mine.map((terminal) => terminal.terminalId),
    ['term-2']
  );

  const theirs = applyTerminalMetadata(
    current,
    { type: 'snapshot', conversationId: 'c2', terminals: [] },
    'c1'
  );
  assert.deepEqual(theirs, current);
});

test('an upsert appends a new shell and keeps spawn order', () => {
  const next = applyTerminalMetadata(
    [summary()],
    { type: 'upsert', terminal: summary({ terminalId: 'term-2' }) },
    'c1'
  );

  assert.deepEqual(
    next.map((terminal) => terminal.terminalId),
    ['term-1', 'term-2']
  );
});

test('an upsert to a known shell replaces it in place, so the tab does not move', () => {
  const next = applyTerminalMetadata(
    [summary(), summary({ terminalId: 'term-2' })],
    { type: 'upsert', terminal: summary({ label: 'pnpm', hasRunningSubprocess: true }) },
    'c1'
  );

  assert.deepEqual(
    next.map((terminal) => terminal.terminalId),
    ['term-1', 'term-2']
  );
  assert.equal(next[0].label, 'pnpm');
});

test("another conversation's events are ignored", () => {
  const current = [summary()];
  const next = applyTerminalMetadata(
    current,
    { type: 'upsert', terminal: summary({ conversationId: 'c2', terminalId: 'term-9' }) },
    'c1'
  );

  assert.deepEqual(next, current);
});

test('remove drops the shell it names', () => {
  const next = applyTerminalMetadata(
    [summary(), summary({ terminalId: 'term-2' })],
    { type: 'remove', conversationId: 'c1', terminalId: 'term-1' },
    'c1'
  );

  assert.deepEqual(
    next.map((terminal) => terminal.terminalId),
    ['term-2']
  );
});

test('a tab shows what its shell is running, else the fallback', () => {
  const terminals = [summary({ terminalId: 'term-2', label: 'vitest' })];

  assert.equal(terminalLabel(terminals, 'term-2', 'Terminal 2'), 'vitest');
  assert.equal(terminalLabel(terminals, 'term-3', 'Terminal 3'), 'Terminal 3');
  assert.equal(
    terminalLabel([summary({ terminalId: 'term-4', label: '   ' })], 'term-4', 'Terminal 4'),
    'Terminal 4'
  );
});
