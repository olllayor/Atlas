import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import type { GitStateService } from './GitStateService';

/**
 * Minimum gap between background-pull attempts for one root. Status reads
 * fire on panel opens and branch operations; without this an opted-in
 * project would fetch the remote on every one of them.
 */
export const AUTO_PULL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export type AutoPullSkipReason =
  | 'not-a-repository'
  | 'worktree-checkout'
  | 'not-on-default-branch'
  | 'unknown-default-branch'
  | 'no-upstream'
  | 'working-tree-changes'
  | 'local-commits'
  | 'up-to-date'
  | 'fetch-failed'
  | 'pull-failed';

export type AutoPullOutcome =
  | { readonly root: string; readonly pulled: true }
  | { readonly root: string; readonly pulled: false; readonly reason: AutoPullSkipReason };

/**
 * A linked worktree holds `.git` as a pointer file, not a directory. Pulling
 * there would move the base under a running turn, so only plain checkouts
 * are eligible — the agent's worktrees are never pull targets.
 */
function isWorktreeCheckout(root: string): boolean {
  try {
    return !statSync(resolve(root, '.git')).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Pulls one checkout when every guard holds: a plain repository, on the
 * remote default branch, tracking an upstream, a clean tree, no local
 * commits ahead, and behind by at least one. Anything else resolves to a
 * skip reason — never a throw — so one bad checkout cannot fail the batch.
 *
 * `fetchFirst` refreshes the upstream refs before measuring behind-ness.
 * Porcelain drift is measured against the last fetch, so without it a stale
 * zero would skip a checkout the remote has already moved past. Pass it at
 * boot and on status refresh; leave it off when the caller just fetched.
 */
export async function autoPullProject(
  root: string,
  git: GitStateService,
  options?: { readonly fetchFirst?: boolean }
): Promise<AutoPullOutcome> {
  const skip = (reason: AutoPullSkipReason): AutoPullOutcome => ({ root, pulled: false, reason });

  if (!git.isGitRepo(root)) return skip('not-a-repository');
  if (isWorktreeCheckout(root)) return skip('worktree-checkout');

  let state = await git.getState(root);
  if (state.branch === null || state.branch === 'HEAD (detached)') {
    return skip('not-on-default-branch');
  }
  if (state.files.length > 0) return skip('working-tree-changes');
  if (state.ahead === null || state.behind === null) return skip('no-upstream');
  if (state.ahead > 0) return skip('local-commits');

  // Fetching touches no working-tree file, so the cleanliness verdict above
  // still holds; only the behind count is re-read.
  if (options?.fetchFirst) {
    try {
      await git.fetchRemote(root);
    } catch {
      return skip('fetch-failed');
    }
    state = await git.getState(root);
  }
  if ((state.behind ?? 0) <= 0) return skip('up-to-date');

  const defaultBranch = await git.getDefaultBranch(root);
  if (defaultBranch === null) return skip('unknown-default-branch');
  if (state.branch !== defaultBranch) return skip('not-on-default-branch');

  try {
    await git.pullCurrentBranch(root);
    return { root, pulled: true };
  } catch {
    return skip('pull-failed');
  }
}

/**
 * Status-refresh entry point: after a state read shows a behind count, pull
 * when the project opted in. Fire-and-forget by design — the caller already
 * answered with the pre-pull state, and the next read converges. Resolves to
 * the outcome only for tests; production callers must not await it.
 */
export async function maybeAutoPullAfterState(input: {
  readonly root: string;
  readonly behind: number | null;
  readonly isEnabled: boolean;
  readonly fetchFirst?: boolean;
  readonly git: GitStateService;
  readonly onPulled?: (root: string) => void;
}): Promise<AutoPullOutcome | null> {
  if (!input.isEnabled) return null;
  // A stale zero skips the fetch; anything else (behind, or unknown because
  // nothing fetched yet) goes through so the fresh read decides.
  if (input.behind !== null && input.behind <= 0 && !input.fetchFirst) return null;
  const outcome = await autoPullProject(input.root, input.git, { fetchFirst: input.fetchFirst });
  if (outcome.pulled) input.onPulled?.(input.root);
  return outcome;
}

/**
 * Pulls every eligible root with bounded concurrency. Roots dedupe first —
 * two projects can point at the same folder — and per-checkout failures are
 * already folded into skip outcomes, so this resolves rather than rejects.
 */
export async function autoPullProjects(
  roots: ReadonlyArray<string>,
  git: GitStateService,
  options?: { readonly concurrency?: number; readonly fetchFirst?: boolean }
): Promise<AutoPullOutcome[]> {
  const unique = [...new Set(roots)];
  const concurrency = Math.max(1, Math.floor(options?.concurrency ?? 4));
  const outcomes: AutoPullOutcome[] = new Array(unique.length);

  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, async () => {
    while (next < unique.length) {
      const index = next;
      next += 1;
      outcomes[index] = await autoPullProject(unique[index]!, git, {
        fetchFirst: options?.fetchFirst,
      });
    }
  });
  await Promise.all(workers);
  return outcomes;
}
