/**
 * Workspace modes — Atlas has exactly two, and chat is the substrate of both.
 *
 * `work`  — the general assistant. Reads, searches, the web, sites and visuals.
 *           A project folder is optional; without one the shell is anchored to
 *           the user's home directory and nothing on disk is writable.
 * `code`  — the coding agent. Requires a project folder, and inside that folder
 *           it may write files and run unrestricted shell commands (subject to
 *           the separate tool-permission ladder).
 *
 * The two axes stay separate on purpose, the way Codex separates its
 * collaboration mode from its sandbox policy: the mode decides *which* tools
 * exist, `ToolPermissionMode` decides *how* the risky ones are gated. A mode is
 * therefore a preset over capability, not a fourth permission level.
 */
export type WorkspaceMode = 'work' | 'code';

export const WORKSPACE_MODES: Array<{
  value: WorkspaceMode;
  label: string;
  /**
   * Three or four words under the label in the mode menu. Codex/ChatGPT put a
   * verb list there ("Build, debug, and ship") rather than a sentence — the
   * menu is picked from at a glance, and `hint` is the sentence for tooltips.
   */
  tagline: string;
  /** One line for the mode switcher tooltip. */
  hint: string;
  /** `code` cannot run without a project folder; `work` is happy without one. */
  requiresProject: boolean;
  /** Whether local files may be created or modified in this mode. */
  allowsFileWrites: boolean;
}> = [
  {
    value: 'work',
    label: 'Work',
    tagline: 'Create, learn, and explore',
    hint: 'Research, writing, sites and visuals. Reads anywhere, writes nothing on disk.',
    requiresProject: false,
    allowsFileWrites: false
  },
  {
    value: 'code',
    label: 'Code',
    tagline: 'Build, debug, and ship',
    hint: 'Edit and run a project. Needs a folder; writes and commands stay inside it.',
    requiresProject: true,
    allowsFileWrites: true
  }
];

export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = 'work';

/**
 * Tools that only exist once a project folder is attached in `code` mode.
 * Withholding them is stronger than a prompt instruction: the model cannot call
 * a tool that was never in its tool set.
 */
export const CODE_ONLY_TOOL_NAMES = [
  'write_file',
  'edit_file',
  'git_status',
  'git_diff',
  'git_push',
  'github_pr_status',
  'github_pr_create'
] as const;

export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return WORKSPACE_MODES.some((entry) => entry.value === value);
}

export function describeWorkspaceMode(mode: WorkspaceMode) {
  return WORKSPACE_MODES.find((entry) => entry.value === mode) ?? WORKSPACE_MODES[0]!;
}

/**
 * Whether the mode can actually run as configured.
 *
 * `code` without a project is a real state — the user switches the mode before
 * picking the folder — so the UI shows a gate rather than silently downgrading,
 * and the runtime refuses to hand out the code tools.
 */
export function isWorkspaceModeReady(mode: WorkspaceMode, hasProject: boolean) {
  return hasProject || !describeWorkspaceMode(mode).requiresProject;
}

/**
 * Whether switching to `mode` should immediately ask the user for a folder.
 *
 * Only the "no project at all" state prompts. A project that is attached but
 * missing on disk is a broken external fact (unmounted drive, deleted folder)
 * — that state is shown as a gate the user resolves deliberately, never with
 * an auto-opened dialog that invites re-pointing the conversation by accident.
 */
export function shouldPromptForProject(
  mode: WorkspaceMode,
  project: { exists: boolean } | null
): boolean {
  return describeWorkspaceMode(mode).requiresProject && project == null;
}

/** Directory names that stay read-only even inside a writable project root. */
export const PROTECTED_PROJECT_PATH_NAMES = ['.git', '.atlas', '.hg', '.svn'] as const;
