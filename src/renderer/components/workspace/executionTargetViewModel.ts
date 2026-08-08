import type { ExecutionTarget } from '../../../shared/workspaceModes';
import { EXECUTION_TARGETS } from '../../../shared/workspaceModes';

/**
 * One row of the chip's target menu. `tagline` is already rewritten for the
 * disabled state, so the component never branches on why a row is off.
 */
export type ExecutionTargetRow = {
  value: ExecutionTarget;
  label: string;
  tagline: string;
  disabled: boolean;
  /** Cloud's off state links somewhere instead of just refusing the click. */
  needsSettings: boolean;
};

/**
 * The disabled rules used to live inline in the mode-switch menu, which made
 * them untestable without mounting Radix. They are a pure function of repo
 * shape and the beta flag, so that is where they stay.
 */
export function executionTargetRows(options: {
  isGitRepo: boolean;
  cloudSandboxEnabled: boolean;
}): ExecutionTargetRow[] {
  return EXECUTION_TARGETS.map((entry) => {
    const worktreeDisabled = entry.value === 'worktree' && !options.isGitRepo;
    const cloudDisabled = entry.value === 'cloud' && !options.cloudSandboxEnabled;

    return {
      value: entry.value,
      label: entry.label,
      tagline:
        worktreeDisabled
          ? 'Requires a git repository attached'
          : cloudDisabled
            ? 'Enable in Settings → Beta'
            : entry.tagline,
      disabled: worktreeDisabled || cloudDisabled,
      needsSettings: cloudDisabled,
    };
  });
}

/**
 * The worktree branch is deterministic: `atlas/<first 8 of conversation id>`
 * (see WorktreeService.provisionWorktree). The chip shows a short form so the
 * strip carries which isolation the conversation is in without a tooltip.
 */
export function worktreeBranchShort(conversationId: string | undefined): string | null {
  if (!conversationId || conversationId.length < 8) return null;
  // Must match WorktreeService.provisionWorktree exactly (`atlas/<id.slice(0,8)>`):
  // the chip's branch label is the same string git checks out, so it can never
  // silently diverge from the backend by editorializing the id (e.g. dropping
  // hyphens).
  return `atlas/${conversationId.slice(0, 8)}`;
}

/**
 * Chip copy in one place: the word on the strip, the aria announcement, and
 * the tooltip are three phrasings of one fact and should change together.
 */
export function executionTargetChipText(options: {
  target: ExecutionTarget;
  worktreeBranch?: string | null;
}): { label: string; aria: string; tooltip: string } {
  if (options.target === 'cloud') {
    return {
      label: 'Cloud',
      aria: 'Runs in Cloudflare Cloud Sandbox — click to change execution target',
      tooltip: 'Runs in Cloudflare Cloud Sandbox — change or configure',
    };
  }

  if (options.target === 'worktree') {
    const label = options.worktreeBranch ? `Worktree · ${options.worktreeBranch}` : 'Worktree';
    return {
      label,
      aria: `Runs in isolated git worktree${options.worktreeBranch ? ` ${options.worktreeBranch}` : ''} — click to change execution target`,
      tooltip: 'Runs in isolated git worktree branch — change or manage',
    };
  }

  return {
    // The menu's row says "Work locally"; the chip stays a bare noun like its
    // neighbours (the folder name, the branch name).
    label: 'Local',
    aria: 'Runs on this machine — click to change execution target',
    tooltip: 'Runs on this machine — change execution target',
  };
}

/**
 * Which folder "Reveal in file manager" opens for the chip.
 *
 * Only an actual worktree target (a worktree root exists) reveals the worktree;
 * every other state — local with a leftover worktree on disk, a "worktree"
 * target whose root is missing (fork, stale row) — reveals the attached project
 * root, which always exists for the chip to be visible at all. This keeps the
 * reveal from erroring in main when there is no worktree to show.
 */
export function revealTargetForChip(options: {
  executionTarget: ExecutionTarget;
  hasWorktree: boolean;
}): 'project' | 'worktree' {
  return options.executionTarget === 'worktree' && options.hasWorktree ? 'worktree' : 'project';
}
