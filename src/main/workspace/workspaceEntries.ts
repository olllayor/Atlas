/**
 * The pure half of the workspace listing: path normalization, directory
 * derivation and ordering.
 *
 * Split out from `WorkspaceIndex` so it can be tested without dragging the
 * agent's command runner — and everything that imports — into a unit test.
 */

import type { WorkspaceEntriesResult, WorkspaceEntry } from '../../shared/contracts';

/**
 * Workspace-relative, forward-slashed, and provably not an escape. Anything
 * absolute, empty, or carrying a `..` segment is rejected outright rather
 * than normalized into something that looks safe.
 */
export function normalizeRelativePath(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!trimmed || trimmed.startsWith('/')) return null;
  // A Windows drive letter is absolute even without a leading slash.
  if (/^[a-zA-Z]:/.test(trimmed)) return null;
  if (trimmed.split('/').some((segment) => segment === '..')) return null;
  return trimmed;
}

/**
 * Files plus every directory on the way to one, sorted so the renderer can
 * fold them into a tree without sorting again: directories before files,
 * case-insensitive within each.
 *
 * `rg --files` lists files only, so an empty directory never appears. That is
 * the right answer for a panel about code: a folder with nothing in it is not
 * somewhere the reader is going.
 */
export function buildEntries(files: readonly string[], cap: number): WorkspaceEntriesResult {
  const capped = files.slice(0, cap);
  const directories = new Set<string>();

  for (const file of capped) {
    const segments = file.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
    }
  }

  const entries: WorkspaceEntry[] = [
    ...[...directories].map((path): WorkspaceEntry => ({ path, kind: 'directory' })),
    ...capped.map((path): WorkspaceEntry => ({ path, kind: 'file' })),
  ];

  entries.sort(compareEntries);
  return { entries, truncated: files.length > cap };
}

/** Directories first inside each folder, then case-insensitive by name. */
function compareEntries(left: WorkspaceEntry, right: WorkspaceEntry): number {
  const leftSegments = left.path.split('/');
  const rightSegments = right.path.split('/');
  const shared = Math.min(leftSegments.length, rightSegments.length);

  for (let index = 0; index < shared; index += 1) {
    const leftSegment = leftSegments[index];
    const rightSegment = rightSegments[index];
    if (leftSegment === rightSegment) continue;

    // The last segment of a path is the entry itself; anything before it is a
    // directory whichever kind the entry is.
    const leftIsDirectory = index < leftSegments.length - 1 || left.kind === 'directory';
    const rightIsDirectory = index < rightSegments.length - 1 || right.kind === 'directory';
    if (leftIsDirectory !== rightIsDirectory) return leftIsDirectory ? -1 : 1;

    return leftSegment.localeCompare(rightSegment, undefined, { sensitivity: 'base' });
  }

  return leftSegments.length - rightSegments.length;
}
