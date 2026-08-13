import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
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
   */
  async provisionWorktree(repoRoot: string, conversationId: string): Promise<WorktreeInfo> {
    const worktreeDir = join(repoRoot, '.atlas-worktrees', conversationId);
    // Full UUID prevents 8-char prefix collisions across conversations.
    // Git refnames handle hyphenated IDs without issue (see WorkspaceCheckpointService).
    const branchName = `atlas/${conversationId}`;

    const existing = await this.listWorktrees(repoRoot);
    const found = existing.find((wt) => resolve(wt.path) === resolve(worktreeDir));
    if (found) {
      return found;
    }

    // Attempt to create worktree with a dedicated branch; fallback if branch already exists
    try {
      return await this.addWorktree(repoRoot, {
        path: worktreeDir,
        branch: branchName,
        createBranch: true,
      });
    } catch (err: any) {
      const msg = String(err.message || err);
      if (msg.includes('already exists') || msg.includes('already checked out')) {
        // Reuse existing branch without -b
        return await this.addWorktree(repoRoot, {
          path: worktreeDir,
          branch: branchName,
          createBranch: false,
        });
      }
      throw err;
    }
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
