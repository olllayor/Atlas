import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PERMISSION_PRESETS,
  matchPermissionPreset,
} from '../src/shared/permissionPresets';
import type { ToolPermissionMode } from '../src/shared/chatParameters';
import type { WorkspaceMode } from '../src/shared/workspaceModes';

test('PERMISSION_PRESETS ships exactly the three approved postures', () => {
  assert.deepEqual(
    PERMISSION_PRESETS.map((preset) => [preset.id, preset.workspaceMode, preset.toolPermissionMode]),
    [
      ['research', 'work', 'read-only'],
      ['code-ask', 'code', 'ask'],
      ['code-full-access', 'code', 'full-access'],
    ]
  );

  // Every row must carry a label and a hint — the menu renders both, and an
  // empty one would render as a broken row rather than a missing one.
  for (const preset of PERMISSION_PRESETS) {
    assert.ok(preset.label.length > 0, `${preset.id} needs a label`);
    assert.ok(preset.hint.length > 0, `${preset.id} needs a hint`);
  }
});

test('preset ids are unique', () => {
  const ids = PERMISSION_PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('matchPermissionPreset finds each shipped combination', () => {
  for (const preset of PERMISSION_PRESETS) {
    const match = matchPermissionPreset(preset.workspaceMode, preset.toolPermissionMode);
    assert.equal(match?.id, preset.id);
  }
});

test('matchPermissionPreset returns null for non-preset combinations', () => {
  const modes: WorkspaceMode[] = ['work', 'code'];
  const permissions: ToolPermissionMode[] = ['read-only', 'ask', 'full-access'];

  const presetPairs = new Set(
    PERMISSION_PRESETS.map((preset) => `${preset.workspaceMode}:${preset.toolPermissionMode}`)
  );

  for (const mode of modes) {
    for (const permission of permissions) {
      if (presetPairs.has(`${mode}:${permission}`)) continue;
      // work+ask (the default state), work+full-access, code+read-only: all
      // stay reachable through the individual controls, none is a preset.
      assert.equal(matchPermissionPreset(mode, permission), null, `${mode}+${permission}`);
    }
  }
});
