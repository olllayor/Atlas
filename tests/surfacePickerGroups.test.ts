import assert from 'node:assert/strict';
import test from 'node:test';

import type { RightPanelKind } from '../src/renderer/components/workbench/rightPanelModel.js';
import { groupPickerActions } from '../src/renderer/components/workbench/surfaceRegistry.js';

type Action = { kind: RightPanelKind; available: boolean };

const action = (kind: RightPanelKind, available: boolean): Action => ({ kind, available });

// Registry order in Code mode today: diff, git, tasks, terminal, browser,
// pullRequests, agents.
const codeOrder: Action[] = [
  action('diff', true),
  action('git', true),
  action('tasks', true),
  action('terminal', true),
  action('browser', true),
  action('pullRequests', true),
  action('agents', false),
];

test('code mode keeps the single registry-ordered grid', () => {
  const { primary, secondary } = groupPickerActions(codeOrder, 'code');
  assert.deepEqual(
    primary.map((entry) => entry.kind),
    ['diff', 'git', 'tasks', 'terminal', 'browser', 'pullRequests', 'agents']
  );
  assert.deepEqual(secondary, []);
});

test('work mode leads with browser, terminal, tasks — not diff', () => {
  const actions: Action[] = [
    action('diff', false),
    action('git', false),
    action('tasks', true),
    action('terminal', true),
    action('browser', true),
    action('pullRequests', false),
    action('agents', false),
  ];

  const { primary, secondary } = groupPickerActions(actions, 'work');
  assert.deepEqual(
    primary.map((entry) => entry.kind),
    ['browser', 'terminal', 'tasks']
  );
  assert.deepEqual(
    secondary.map((entry) => entry.kind),
    ['diff', 'git', 'pullRequests', 'agents']
  );
});

test('work mode with nothing gated renders one group, not an empty section', () => {
  const actions: Action[] = [action('browser', true), action('terminal', true)];
  const { primary, secondary } = groupPickerActions(actions, 'work');
  assert.deepEqual(
    primary.map((entry) => entry.kind),
    ['browser', 'terminal']
  );
  assert.deepEqual(secondary, []);
});

test('kinds outside the lead order keep their relative place at the end', () => {
  const actions: Action[] = [
    action('git', true),
    action('browser', true),
    action('tasks', true),
    action('diff', false),
  ];
  const { primary } = groupPickerActions(actions, 'work');
  assert.deepEqual(
    primary.map((entry) => entry.kind),
    ['browser', 'tasks', 'git']
  );
});
