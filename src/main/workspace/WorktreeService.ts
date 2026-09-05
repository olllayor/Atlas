import { existsSync } from 'node:fs';
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import { runCommand } from '../ai/tools/toolRuntime';
import type { CommandRunner } from './GitReviewService';

export type WorktreeInfo = {
  path: string;
  head: string;
  branch: string | null;
  isMain: boolean;
  isBare?: boolean;
  isLocked?: boolean;
  lockReason?: string | null;
  isPrunable?: boolean;
  pruneReason?: string | null;
};

export type AddWorktreeOptions = {
  path: string;
  branch?: string;
  createBranch?: boolean;
  commitish?: string;
  force?: boolean;
};

export type RemoveWorktreeOptions = {
  path: string;
  force?: boolean;
};

/** Directory name that marks a worktree as Atlas-managed (and so GC-eligible). */
export const MANAGED_WORKTREE_DIR = '.atlas-worktrees';
/** Unreferenced managed worktrees kept before the oldest is collected. */
export const WORKTREE_RETENTION_DEFAULT = 15;

export type WorktreeGcResult = {
  /** Managed checkout directories removed. */
  removedPaths: string[];
  /** Snapshot branches created before removal (`atlas/wt-snapshot/<id>`). */
  snapshotBranches: string[];
};

export class WorktreeService {
  private readonly run: CommandRunner;

  constructor(options: { run?: CommandRunner } = {}) {
    this.run =
      options.run ??
      ((command, args, opts) =>
        runCommand(command, args, { cwd: opts.cwd, timeoutMs: opts.timeoutMs }));
  }

  /**
   * Parses `git worktree list --porcelain` to return all attached worktrees.
   */
  async listWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
    const result = await this.run('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
      timeoutMs: 20_000,
    });

    if (result.code !== 0) {
      throw new Error(
        `Failed to list worktrees: ${result.stderr.trim() || result.stdout.trim()}`
      );
    }

    const blocks = result.stdout.split(/\n\n+/).filter(Boolean);
    const worktrees: WorktreeInfo[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const lines = blocks[i]!.split('\n').filter(Boolean);
      let path = '';
      let head = '';
      let branch: string | null = null;
      let isBare = false;
      let isLocked = false;
      let lockReason: string | null = null;
      let isPrunable = false;
      let pruneReason: string | null = null;

      for (const line of lines) {
        if (line.startsWith('worktree ')) path = line.slice(9).trim();
        else if (line.startsWith('HEAD ')) head = line.slice(5).trim();
        else if (line.startsWith('branch ')) {
          const ref = line.slice(7).trim();
          branch = ref.replace(/^refs\/heads\//, '');
        } else if (line === 'bare') isBare = true;
        else if (line.startsWith('locked')) {
          isLocked = true;
          lockReason = line.slice(6).trim() || null;
        } else if (line.startsWith('prunable')) {
          isPrunable = true;
          pruneReason = line.slice(8).trim() || null;
        }
      }

      if (path) {
        worktrees.push({
          path,
          head,
          branch,
          isMain: i === 0,
          isBare,
          isLocked,
          lockReason,
          isPrunable,
          pruneReason,
        });
      }
    }

    return worktrees;
  }

  /**
   * Provision a standard conversation worktree under `<repoRoot>/.atlas-worktrees/<conversationId>`
   *
   * `baseBranch` starts the worktree from a named commitish (Codex's "from
   * develop" flow) instead of HEAD. After creation, files named in the repo's
   * `.worktreeinclude` are copied across, so gitignored secrets and local
   * config a turn will need do not have to be rediscovered.
   */
  async provisionWorktree(
    repoRoot: string,
    conversationId: string,
    options: { baseBranch?: string } = {}
  ): Promise<WorktreeInfo> {
    const worktreeDir = join(repoRoot, MANAGED_WORKTREE_DIR, conversationId);
    // Full UUID prevents 8-char prefix collisions across conversations.
    // Git refnames handle hyphenated IDs without issue (see WorkspaceCheckpointService).
    const branchName = `atlas/${conversationId}`;

    const existing = await this.listWorktrees(repoRoot);
    const found = existing.find((wt) => resolve(wt.path) === resolve(worktreeDir));
    if (found) {
      return found;
    }

    const addOptions: AddWorktreeOptions = {
      path: worktreeDir,
      branch: branchName,
      createBranch: true,
      ...(options.baseBranch ? { commitish: options.baseBranch } : {}),
    };

    // Attempt to create worktree with a dedicated branch; fallback if branch already exists
    let created: WorktreeInfo;
    try {
      created = await this.addWorktree(repoRoot, addOptions);
    } catch (err: any) {
      const msg = String(err.message || err);
      if (msg.includes('already exists') || msg.includes('already checked out')) {
        // Reuse existing branch without -b
        created = await this.addWorktree(repoRoot, {
          path: worktreeDir,
          branch: branchName,
          createBranch: false,
        });
      } else {
        throw err;
      }
    }

    // Best effort by design: a missing or unreadable include must never block
    // provisioning — the worktree is usable without it, just less convenient.
    try {
      await this.copyWorktreeIncludes(repoRoot, created.path);
    } catch {
      // Ignored on purpose.
    }

    return created;
  }

  /**
   * Copy gitignored files named by `<repoRoot>/.worktreeinclude` into a fresh
   * worktree. One pathspec per line; `#` comments and blank lines allowed.
   * Only *ignored untracked* files are copied — tracked content is already in
   * the checkout — which is exactly the `.env`-shaped hole this exists for.
   *
   * @returns the relative paths copied, for logging/tests.
   */
  async copyWorktreeIncludes(repoRoot: string, worktreePath: string): Promise<string[]> {
    const includeFile = join(repoRoot, '.worktreeinclude');
    if (!existsSync(includeFile)) {
      return [];
    }

    const patterns = readFileSync(includeFile, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    const copied: string[] = [];

    for (const pattern of patterns) {
      let result;
      try {
        result = await this.run(
          'git',
          ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', pattern],
          { cwd: repoRoot, timeoutMs: 20_000 }
        );
      } catch {
        continue;
      }
      if (result.code !== 0) continue;

      for (const relPath of result.stdout.split('\0').filter(Boolean)) {
        const from = join(repoRoot, relPath);
        const to = join(worktreePath, relPath);
        if (!existsSync(from) || statSync(from).isDirectory()) continue;

        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
        copied.push(relPath);
      }
    }

    return copied;
  }

  /**
   * Collect Atlas-managed worktrees nothing points at anymore.
   *
   * Codex semantics: disposable checkouts are kept up to a retention window so
   * recent work stays recoverable; everything older is snapshotted to a branch
   * before deletion, then removed. Only directories under
   * `<repoRoot>/.atlas-worktrees/` are ever touched — user-created worktrees
   * elsewhere in the repository are permanent by definition.
   *
   * Snapshot naming is deterministic per conversation (`atlas/wt-snapshot/<id>`),
   * so re-running GC over the same stale checkout cannot stack duplicates.
   */
  async gcManagedWorktrees(
    repoRoot: string,
    options: { activePaths: string[]; retention?: number }
  ): Promise<WorktreeGcResult> {
    const retention = Math.max(0, options.retention ?? WORKTREE_RETENTION_DEFAULT);
    const activeSet = new Set(options.activePaths.map((path) => resolve(path)));
    const managedRoot = resolve(join(repoRoot, MANAGED_WORKTREE_DIR));

    const all = await this.listWorktrees(repoRoot);
    const managed = all.filter(
      (wt) => !wt.isMain && resolve(wt.path).startsWith(managedRoot + '/')
    );

    const stale = managed.filter((wt) => !activeSet.has(resolve(wt.path)));

    // Newest first by directory mtime; the freshest `retention` survive.
    const ordered = stale
      .map((wt) => {
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(wt.path).mtimeMs;
        } catch {
          // A vanished directory is the coldest possible entry.
        }
        return { wt, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const doomed = ordered.slice(retention).map((entry) => entry.wt);
    const result: WorktreeGcResult = { removedPaths: [], snapshotBranches: [] };

    for (const wt of doomed) {
      const id = basename(wt.path);

      // Snapshot before removal when there is a commit to point at. The worktree
      // branch itself may already hold the work, but it shares the fate of the
      // checkout in the next step, so a dedicated ref is what survives.
      if (wt.head) {
        const snapshotBranch = `atlas/wt-snapshot/${id}`;
        const exists = await this.run('git', ['rev-parse', '--verify', '--quiet', snapshotBranch], {
          cwd: repoRoot,
          timeoutMs: 10_000,
        });
        if (exists.code !== 0) {
          const created = await this.run('git', ['branch', snapshotBranch, wt.head], {
            cwd: repoRoot,
            timeoutMs: 10_000,
          });
          if (created.code === 0) {
            result.snapshotBranches.push(snapshotBranch);
          }
        }
      }

      try {
        await this.removeWorktree(repoRoot, { path: wt.path, force: true });
        result.removedPaths.push(wt.path);
      } catch {
        // Unremovable (locked by another process): keep it, keep everything
        // consistent, and let a later GC retry.
        continue;
      }

      // The per-conversation branch has been superseded by the snapshot ref.
      // `-D` because unmerged agent work is exactly what we expect here, and
      // failure is harmless — an orphan branch is not worth dying over.
      if (wt.branch) {
        await this.run('git', ['branch', '-D', wt.branch], { cwd: repoRoot, timeoutMs: 10_000 });
      }
    }

    if (result.removedPaths.length > 0) {
      await this.pruneWorktrees(repoRoot);
    }

    return result;
  }

  async addWorktree(repoRoot: string, options: AddWorktreeOptions): Promise<WorktreeInfo> {
    const targetPath = resolve(options.path);
    const args = ['worktree', 'add'];

    if (options.force) args.push('-f');

    if (options.createBranch && options.branch) {
      args.push('-b', options.branch, targetPath);
      if (options.commitish) args.push(options.commitish);
    } else {
      args.push(targetPath);
      if (options.branch) args.push(options.branch);
      else if (options.commitish) args.push(options.commitish);
    }

    const result = await this.run('git', args, { cwd: repoRoot, timeoutMs: 30_000 });
    if (result.code !== 0) {
      const err = result.stderr.trim() || result.stdout.trim();
      throw new Error(`Failed to add worktree: ${err}`);
    }

    const list = await this.listWorktrees(repoRoot);
    const created = list.find((wt) => resolve(wt.path) === targetPath);
    if (!created) {
      throw new Error(`Worktree created at ${targetPath} but not found in git worktree list.`);
    }
    return created;
  }

  async removeWorktree(repoRoot: string, options: RemoveWorktreeOptions): Promise<void> {
    const targetPath = resolve(options.path);
    const list = await this.listWorktrees(repoRoot);
    const target = list.find((wt) => resolve(wt.path) === targetPath);

    if (target?.isMain) {
      throw new Error('Cannot remove the main worktree repository root.');
    }

    if (!target) {
      // The checkout is no longer an attached worktree. Prune git's stale
      // bookkeeping so a directory that only the lock/metadata keeps registered
      // can still go; a path that is simply gone needs no action beyond the
      // caller clearing its stored row.
      await this.pruneWorktrees(repoRoot);
    }

    const args = ['worktree', 'remove'];
    if (options.force) args.push('--force');
    args.push(targetPath);

    const result = await this.run('git', args, { cwd: repoRoot, timeoutMs: 30_000 });
    if (result.code !== 0) {
      const err = result.stderr.trim() || result.stdout.trim();
      // `git worktree remove` refuses an unknown path. A checkout that no
      // longer exists on disk is already removed, so that refusal is a success
      // — the caller should clear its row rather than surface an error.
      if (!existsSync(targetPath)) {
        return;
      }
      throw new Error(`Failed to remove worktree: ${err}`);
    }
  }

  async pruneWorktrees(repoRoot: string): Promise<void> {
    const result = await this.run('git', ['worktree', 'prune'], { cwd: repoRoot, timeoutMs: 20_000 });
    if (result.code !== 0) {
      throw new Error(`Failed to prune worktrees: ${result.stderr.trim() || result.stdout.trim()}`);
    }
  }
}

export const worktreeService = new WorktreeService();
