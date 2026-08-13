import assert from 'node:assert/strict';
import test from 'node:test';

import { TOOL_PERMISSION_MODES } from '../src/shared/chatParameters.js';
import { WORKSPACE_MODES } from '../src/shared/workspaceModes.js';
import {
  UNREADY_HINT,
  describeAccessState,
  modeTitle,
} from '../src/renderer/components/workspace/workspaceAccessViewModel.js';

test('only full access earns a standing warning', () => {
  const flag = (permissionMode: 'read-only' | 'ask' | 'full-access') =>
    describeAccessState({ mode: 'code', permissionMode, ready: true }).showFullAccessWarning;

  assert.equal(flag('full-access'), true);
  assert.equal(flag('ask'), false);
  assert.equal(flag('read-only'), false);
});

test('an unready Code mode swaps the tooltip for the folder hint', () => {
  const state = describeAccessState({ mode: 'code', permissionMode: 'ask', ready: false });

  assert.equal(state.showUnreadyWarning, true);
  assert.equal(state.tooltip, UNREADY_HINT);
});

test('Work mode is never unready, because it never needed a folder', () => {
  const state = describeAccessState({ mode: 'work', permissionMode: 'ask', ready: false });

  assert.equal(state.showUnreadyWarning, false);
  assert.notEqual(state.tooltip, UNREADY_HINT);
});

test('the two warnings are independent and can both be raised', () => {
  const state = describeAccessState({ mode: 'code', permissionMode: 'full-access', ready: false });

  assert.equal(state.showUnreadyWarning, true);
  assert.equal(state.showFullAccessWarning, true);
});

test('a ready tooltip names the access rung beside the mode hint', () => {
  const state = describeAccessState({ mode: 'work', permissionMode: 'read-only', ready: true });

  assert.equal(state.tooltip, `${WORKSPACE_MODES[0]!.hint} · Access: Read only`);
});

test('both aria labels announce both axes for every mode and rung', () => {
  for (const workspace of WORKSPACE_MODES) {
    for (const access of TOOL_PERMISSION_MODES) {
      const state = describeAccessState({
        mode: workspace.value,
        permissionMode: access.value,
        ready: true,
      });
      const title = modeTitle(workspace.label);

      for (const label of [state.headingAriaLabel, state.chipAriaLabel]) {
        assert.ok(label.includes(title), `${label} is missing ${title}`);
        assert.ok(label.includes(access.label), `${label} is missing ${access.label}`);
      }
    }
  }
});

test('the ladder is three rungs and no mode filters any of them out', () => {
  assert.equal(TOOL_PERMISSION_MODES.length, 3);

  // No mode × rung pair is meaningless, so the menu never hides a rung — the
  // proof is that the view model reads the same ladder whatever the mode is.
  for (const workspace of WORKSPACE_MODES) {
    const labels = TOOL_PERMISSION_MODES.map(
      (access) =>
        describeAccessState({ mode: workspace.value, permissionMode: access.value, ready: true })
          .chipAriaLabel
    );

    assert.equal(new Set(labels).size, TOOL_PERMISSION_MODES.length);
  }
});
