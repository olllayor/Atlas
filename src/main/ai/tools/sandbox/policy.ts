import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { PROTECTED_PROJECT_PATH_NAMES } from '../../../../shared/workspaceModes';
import type { WritableRoot } from './types';

/**
 * Canonicalizes a directory, or returns null when it cannot be used as a
 * writable root.
 *
 * Seatbelt evaluates its rules against the vnode's real path, so a symlinked
 * project root (`/tmp` → `/private/tmp`, a home directory on an aliased volume)
 * would be granted under a name the kernel never sees. Dropping a root that has
 * vanished is the safe direction: the command runs with less access, not more.
 */
function canonicalizeDirectory(candidate: string): string | null {
  try {
    const real = realpathSync.native(candidate);
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

/**
 * Where a `.git` *file* points.
 *
 * Worktrees and submodules replace `.git` with a one-line `gitdir: <path>`
 * pointer. Protecting only the pointer file would leave the real repository
 * database writable, so the target is resolved and protected too.
 */
function resolveGitdirPointer(gitPath: string): string | null {
  try {
    if (!statSync(gitPath).isFile()) {
      return null;
    }

    const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitPath, 'utf8'));
    const target = match?.[1]?.trim();
    if (!target) {
      return null;
    }

    const absolute = isAbsolute(target) ? target : resolve(gitPath, '..', target);
    return canonicalizeDirectory(absolute) ?? resolve(absolute);
  } catch {
    return null;
  }
}

function isWithin(root: string, candidate: string) {
  const relativePath = relative(root, candidate);
  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

/**
 * The directories a sandboxed shell command may write to, and the paths inside
 * them that stay read-only.
 *
 * The project root is joined by `/tmp` and `$TMPDIR` because build tools,
 * compilers and test runners write scratch files there as a matter of course,
 * and a sandbox that breaks `npm test` gets turned off. This is deliberately
 * wider than `resolveWritablePath`, which still confines `write_file` and
 * `edit_file` to the project root alone — same split as Codex.
 *
 * Protected names are attached to every root that contains them rather than to
 * the project root alone, because a project living under `$TMPDIR` (which is
 * where every test fixture lives) would otherwise have its `.git` made writable
 * by the scratch root that encloses it.
 */
export function computeWritableRoots(projectRoot: string): WritableRoot[] {
  const canonicalProjectRoot = canonicalizeDirectory(projectRoot);

  if (!canonicalProjectRoot) {
    return [];
  }

  const protectedPaths: string[] = [];

  for (const name of PROTECTED_PROJECT_PATH_NAMES) {
    const protectedPath = resolve(canonicalProjectRoot, name);
    protectedPaths.push(protectedPath);

    if (name === '.git') {
      const gitdir = resolveGitdirPointer(protectedPath);
      if (gitdir) {
        protectedPaths.push(gitdir);
      }
    }
  }

  const tmpdirEnv = process.env.TMPDIR?.trim();
  const candidates = [canonicalProjectRoot, '/tmp', tmpdirEnv && isAbsolute(tmpdirEnv) ? tmpdirEnv : null];

  const roots: WritableRoot[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const root = canonicalizeDirectory(candidate);
    if (!root || seen.has(root)) {
      continue;
    }

    seen.add(root);
    roots.push({
      root,
      readOnlySubpaths: protectedPaths.filter((protectedPath) => isWithin(root, protectedPath))
    });
  }

  return roots;
}
