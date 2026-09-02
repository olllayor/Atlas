/**
 * Permission presets — named one-click combinations of the two access axes.
 *
 * Atlas keeps the axes separate on purpose (see `workspaceModes.ts`): the
 * workspace mode decides *which* tools exist, `ToolPermissionMode` decides
 * *how* the risky ones are gated. A preset never merges them — it is a named
 * view that writes both existing columns at once, for the postures people
 * choose deliberately. Combinations without a preset stay reachable through
 * the individual controls; presets only shortcut the common ones.
 */
import type { ToolPermissionMode } from './chatParameters';
import type { WorkspaceMode } from './workspaceModes';

export type PermissionPresetId = 'research' | 'code-ask' | 'code-full-access';

export type PermissionPreset = {
  id: PermissionPresetId;
  label: string;
  /** One line under the label in the preset menu, same idiom as the modes. */
  hint: string;
  workspaceMode: WorkspaceMode;
  toolPermissionMode: ToolPermissionMode;
};

export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    id: 'research',
    label: 'Research',
    hint: 'Read and search. Nothing runs, nothing is written.',
    workspaceMode: 'work',
    toolPermissionMode: 'read-only'
  },
  {
    id: 'code-ask',
    label: 'Code · Ask first',
    hint: 'Edit and run a project; risky steps pause for approval.',
    workspaceMode: 'code',
    toolPermissionMode: 'ask'
  },
  {
    id: 'code-full-access',
    label: 'Code · Full access',
    // Full-access enables network access and bypasses the approval ladder.
    // The filesystem sandbox (write confinement to project root) still applies.
    hint: 'Edit and run without asking. Network access enabled.',
    workspaceMode: 'code',
    toolPermissionMode: 'full-access'
  }
];

/** The preset a (mode, permission) pair currently matches, if any. */
export function matchPermissionPreset(
  workspaceMode: WorkspaceMode,
  toolPermissionMode: ToolPermissionMode
): PermissionPreset | null {
  return (
    PERMISSION_PRESETS.find(
      (preset) =>
        preset.workspaceMode === workspaceMode && preset.toolPermissionMode === toolPermissionMode
    ) ?? null
  );
}
