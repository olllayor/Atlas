import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_TERMINAL_PANES,
  activatePane,
  canSplit,
  closePane,
  singlePaneGroup,
  splitPane,
} from '../src/renderer/components/workbench/terminalSplitModel.js';

test('an unsplit tab is one pane, and that pane is the active one', () => {
  assert.deepEqual(singlePaneGroup('term-2'), {
    terminalIds: ['term-2'],
    activeTerminalId: 'term-2',
    direction: 'row',
  });
});

test('a split lands beside the pane the user was in, not at the end', () => {
  const three = splitPane(
    splitPane(singlePaneGroup('term-1'), 'term-2', 'row'),
    'term-3',
    'row'
  );
  // term-2 was active, so term-3 goes after it, not after term-1.
  assert.deepEqual(three.terminalIds, ['term-1', 'term-2', 'term-3']);

  const fromFirst = splitPane(activatePane(three, 'term-1'), 'term-4', 'row');
  assert.deepEqual(fromFirst.terminalIds, ['term-1', 'term-4', 'term-2', 'term-3']);
});

test('the new pane takes focus, because splitting is wanting to type in it', () => {
  const group = splitPane(singlePaneGroup('term-1'), 'term-2', 'row');
  assert.equal(group.activeTerminalId, 'term-2');
});

test('the first split picks the direction and later ones follow it', () => {
  const down = splitPane(singlePaneGroup('term-1'), 'term-2', 'column');
  assert.equal(down.direction, 'column');

  // Asking for a row now would mean a nested layout, which this does not do.
  const third = splitPane(down, 'term-3', 'row');
  assert.equal(third.direction, 'column');
});

test('a group stops splitting at the cap', () => {
  let group = singlePaneGroup('term-1');
  for (let index = 2; index <= MAX_TERMINAL_PANES; index += 1) {
    group = splitPane(group, `term-${index}`, 'row');
  }

  assert.equal(group.terminalIds.length, MAX_TERMINAL_PANES);
  assert.equal(canSplit(group), false);
  assert.equal(splitPane(group, 'term-9', 'row'), group);
});

test('the same shell cannot be two panes of one tab', () => {
  const group = splitPane(singlePaneGroup('term-1'), 'term-2', 'row');
  assert.equal(splitPane(group, 'term-2', 'row'), group);
});

test('activating a pane the group does not hold does nothing', () => {
  const group = singlePaneGroup('term-1');
  assert.equal(activatePane(group, 'term-9'), group);
  assert.equal(activatePane(group, 'term-1'), group);
});

test('closing the active pane hands focus to the one that took its place', () => {
  const group = splitPane(
    splitPane(singlePaneGroup('term-1'), 'term-2', 'row'),
    'term-3',
    'row'
  );

  const closed = closePane(activatePane(group, 'term-2'), 'term-2');
  assert.deepEqual(closed?.terminalIds, ['term-1', 'term-3']);
  assert.equal(closed?.activeTerminalId, 'term-3');
});

test('closing the last pane in the row falls back to the new last', () => {
  const group = splitPane(singlePaneGroup('term-1'), 'term-2', 'row');
  const closed = closePane(group, 'term-2');

  assert.equal(closed?.activeTerminalId, 'term-1');
});

test('closing an inactive pane leaves focus alone', () => {
  const group = activatePane(splitPane(singlePaneGroup('term-1'), 'term-2', 'row'), 'term-1');
  const closed = closePane(group, 'term-2');

  assert.equal(closed?.activeTerminalId, 'term-1');
});

test('closing the only pane empties the group, so the caller closes the tab', () => {
  assert.equal(closePane(singlePaneGroup('term-1'), 'term-1'), null);
});

test('closing a pane the group does not hold changes nothing', () => {
  const group = singlePaneGroup('term-1');
  assert.equal(closePane(group, 'term-9'), group);
});
