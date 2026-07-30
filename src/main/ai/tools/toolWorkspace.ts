import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { WorkspaceMode } from '../../../shared/workspaceModes';
import { DEFAULT_WORKSPACE_MODE, PROTECTED_PROJECT_PATH_NAMES } from '../../../shared/workspaceModes';

/**
 * Where a turn's tools run, resolved in the main process from the conversation
 * row. It is never accepted from the renderer: `root` is a writable boundary,
 * and a boundary the client can name is not a boundary.
 */
export type ToolWorkspace = {
  mode: WorkspaceMode;
  /** Absolute project root; null when no project is attached. */
  root: string | null;
};

export const DEFAULT_TOOL_WORKSPACE: ToolWorkspace = {
  mode: DEFAULT_WORKSPACE_MODE,
  root: null
};

/**
 * The working directory for shell commands and for relative search paths.
 *
 * Falls back to the user's home directory rather than `process.cwd()`, which in
 * a packaged Electron app is wherever the OS happened to launch the binary from
 * — a path no user chose and none can predict.
 */
export function resolveWorkspaceCwd(workspace: ToolWorkspace | undefined): string {
  return workspace?.root ?? homedir();
}

/** Reads are unrestricted (as in Codex); only writes are confined to the root. */
export function canWriteFiles(workspace: ToolWorkspace | undefined): workspace is ToolWorkspace & { root: string } {
  return workspace?.mode === 'code' && typeof workspace.root === 'string' && workspace.root.length > 0;
}

export class WorkspaceWriteError extends Error {}

/**
 * Resolves a write target, or explains why it is refused.
 *
 * Three refusals, in the order a caller hits them: wrong mode, no project, and
 * outside the project. The last one also covers Codex's escalation guard —
 * `.git` and friends stay read-only even though they sit inside a writable
 * root, because a writable `.git/hooks` turns one file edit into arbitrary code
 * execution on the user's next commit.
 */
export function resolveWritablePath(filePath: string, workspace: ToolWorkspace | undefined): string {
  if (workspace?.mode !== 'code') {
    throw new WorkspaceWriteError(
      'File writes are only available in Code mode. This conversation is in Work mode, which can read files but not change them.'
    );
  }

  if (!workspace.root) {
    throw new WorkspaceWriteError(
      'Code mode has no project folder attached, so there is nowhere to write. Ask the user to choose a folder first.'
    );
  }

  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new WorkspaceWriteError('Expected a file path.');
  }

  const root = resolve(workspace.root);
  const target = isAbsolute(trimmed) ? resolve(trimmed) : resolve(root, trimmed);
  const relativePath = relative(root, target);

  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new WorkspaceWriteError(
      `Path is outside the project folder (${root}). Writes are confined to the attached project.`
    );
  }

  const [firstSegment] = relativePath.split(sep);
  if (firstSegment && (PROTECTED_PROJECT_PATH_NAMES as readonly string[]).includes(firstSegment)) {
    throw new WorkspaceWriteError(
      `${firstSegment} is read-only: repository and Atlas metadata cannot be modified by tools.`
    );
  }

  return target;
}
