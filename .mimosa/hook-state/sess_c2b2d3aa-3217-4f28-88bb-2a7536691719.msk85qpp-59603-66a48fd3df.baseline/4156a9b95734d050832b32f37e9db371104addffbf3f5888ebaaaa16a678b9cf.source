import type { ToolPermissionMode } from '../../../shared/chatParameters';
import { describeToolPermissionMode } from '../../../shared/chatParameters';
import type { WorkspaceMode } from '../../../shared/workspaceModes';
import { describeWorkspaceMode } from '../../../shared/workspaceModes';

export const UNREADY_HINT = 'Code mode needs a project folder — choose one to enable editing.';

/**
 * The mode reads as a product name, the way "ChatGPT Work" and "Codex" do —
 * this control took the wordmark's place in the sidebar header, so the app name
 * comes along with it rather than disappearing from the window.
 */
export const modeTitle = (label: string) => `Atlas ${label}`;

export type AccessState = {
  /** Sidebar-heading trigger: mode first, because that trigger *is* the mode. */
  headingAriaLabel: string;
  /** Composer chip: access first, because that is the word it shows. */
  chipAriaLabel: string;
  tooltip: string;
  showUnreadyWarning: boolean;
  showFullAccessWarning: boolean;
};

/**
 * What the two triggers say about the same pair of axes.
 *
 * Lives outside the component because both doors have to announce mode *and*
 * access, and a string built twice is a string that drifts. It is also the only
 * part of this control a node:test run can reach — there is no DOM harness.
 */
export function describeAccessState({
  mode,
  ready,
  permissionMode,
}: {
  mode: WorkspaceMode;
  ready: boolean;
  permissionMode: ToolPermissionMode;
}): AccessState {
  const workspace = describeWorkspaceMode(mode);
  const access = describeToolPermissionMode(permissionMode);
  const title = modeTitle(workspace.label);
  // A mode that never needed a folder cannot be unready, so it never wears the
  // warning — and never gets a hint sentence about a folder it does not want.
  const unready = !ready && workspace.requiresProject;

  return {
    headingAriaLabel: `Workspace mode: ${title}. Agent access: ${access.label}. Change.`,
    chipAriaLabel: `Agent access: ${access.label}, in ${title} mode. Change.`,
    tooltip: unready ? UNREADY_HINT : `${workspace.hint} · Access: ${access.label}`,
    showUnreadyWarning: unready,
    // Full access is the only rung that runs shell commands unprompted, so it is
    // the only one that earns a mark the user carries around with them.
    showFullAccessWarning: access.risk === 'high',
  };
}
