import { copyFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { runCommand } from '../ai/tools/toolRuntime';

/** `add -A` over a cold cache on a large repository outlasts the 20s tools use. */
const CAPTURE_TIMEOUT_MS = 120_000;
const READ_TIMEOUT_MS = 20_000;

export type CheckpointKind = 'pre' | 'post' | 'undo';

export type CapturedCheckpoint = {
  refName: string;
  commitSha: string;
  treeSha: string;
  headSha: string | null;
};

export type CheckpointDiffStat = {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

/**
 * Identity for the checkpoint commits.
 *
 * `commit-tree` refuses to run when the repository has no `user.name`, which is
 * a normal state on a fresh machine. These values never reach a branch — the
 * commits live under `refs/atlas/` and exist only to pin a tree.
 */
const CHECKPOINT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Atlas Checkpoint',
  GIT_AUTHOR_EMAIL: 'checkpoint@atlas.local',
  GIT_COMMITTER_NAME: 'Atlas Checkpoint',
  GIT_COMMITTER_EMAIL: 'checkpoint@atlas.local'
} as const;

export function checkpointRefName(conversationId: string, turnId: string, kind: CheckpointKind) {
  return `refs/atlas/checkpoints/${conversationId}/${turnId}/${kind}`;
}

/**
 * Snapshots a project folder per turn, without touching what the user sees.
 *
 * Every capture builds its tree in a throwaway index file, so `git add -A` here
 * never stages anything in the repository the user is working in, and the
 * commits land under `refs/atlas/` — outside `refs/heads`, `refs/tags` and
 * `refs/remotes`, so `git branch`, `git tag`, `git status` and a plain `git log`
 * say nothing about them, while gc still treats the objects as reachable.
 *
 * They are not invisible: `--all` means every ref under `refs/`, so `git log
 * --all` and `git for-each-ref` do list them. That is the price of keeping the
 * objects alive without a branch, and it is why the refs carry the conversation
 * and turn in their names — someone who goes looking can tell what they are.
 */
export class WorkspaceCheckpointService {
  private readonly run: CommandRunner;

  constructor(options: { run?: CommandRunner } = {}) {
    this.run =
      options.run ??
      ((command, args, opts) =>
        runCommand(command, args, {
          cwd: opts.cwd,
          timeoutMs: opts.timeoutMs,
          env: opts.env
        }));
  }

  private async git(
    args: string[],
    root: string,
    options: { env?: Record<string, string>; timeoutMs?: number } = {}
  ) {
    const result = await this.run('git', args, {
      cwd: root,
      timeoutMs: options.timeoutMs ?? READ_TIMEOUT_MS,
      env: options.env
    });

    if (result.code !== 0) {
      const message = result.stderr.trim() || result.stdout.trim();
      throw new Error(message || `git ${args[0]} exited with code ${result.code ?? 'unknown'}.`);
    }

    return result.stdout;
  }

  /** Whether `root` is inside a git work tree at all. */
  async isGitRepo(root: string): Promise<boolean> {
    const result = await this.run('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: root,
      timeoutMs: READ_TIMEOUT_MS
    }).catch(() => null);

    return result?.code === 0 && result.stdout.trim() === 'true';
  }

  private async gitDir(root: string): Promise<string> {
    const output = await this.git(['rev-parse', '--absolute-git-dir'], root);
    return output.trim();
  }

  /** The current commit, or null on an unborn branch. */
  private async headSha(root: string): Promise<string | null> {
    const result = await this.run('git', ['rev-parse', '--verify', '-q', 'HEAD'], {
      cwd: root,
      timeoutMs: READ_TIMEOUT_MS
    }).catch(() => null);

    if (!result || result.code !== 0) {
      return null;
    }

    return result.stdout.trim() || null;
  }

  /**
   * Builds a tree from the current working tree in a scratch index.
   *
   * The real index is copied in first rather than started from empty: it
   * carries git's stat cache, and without it `add -A` re-hashes every file in
   * the repository instead of the handful the turn touched.
   */
  private async buildTree(root: string, gitDir: string) {
    const indexPath = join(gitDir, `atlas-checkpoint-index-${randomUUID()}`);
    await copyFile(join(gitDir, 'index'), indexPath).catch(() => undefined);

    const env = { ...CHECKPOINT_IDENTITY, GIT_INDEX_FILE: indexPath };

    await this.git(['add', '-A', '--'], root, { env, timeoutMs: CAPTURE_TIMEOUT_MS });
    const treeSha = (await this.git(['write-tree'], root, { env, timeoutMs: CAPTURE_TIMEOUT_MS })).trim();

    return { treeSha, indexPath, env };
  }

  /**
   * Records the working tree as `kind` for this turn.
   *
   * Returns the scratch index alongside the commit so a revert can reuse it:
   * `read-tree -m -u` only agrees to rewrite files when its index already
   * matches what is on disk, which is exactly what this index now describes.
   */
  async capture(
    root: string,
    input: { conversationId: string; turnId: string; kind: CheckpointKind }
  ): Promise<CapturedCheckpoint & { indexPath: string }> {
    const gitDir = await this.gitDir(root);
    const { treeSha, indexPath, env } = await this.buildTree(root, gitDir);

    try {
      const headSha = await this.headSha(root);
      const commitArgs = ['commit-tree', treeSha];

      if (headSha) {
        commitArgs.push('-p', headSha);
      }

      commitArgs.push('-m', `atlas checkpoint ${input.kind} ${input.turnId}`);

      const commitSha = (
        await this.git(commitArgs, root, { env, timeoutMs: CAPTURE_TIMEOUT_MS })
      ).trim();

      const refName = checkpointRefName(input.conversationId, input.turnId, input.kind);
      await this.git(['update-ref', refName, commitSha], root, { env });

      return { refName, commitSha, treeSha, headSha, indexPath };
    } catch (error) {
      await rm(indexPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Capture, then drop the scratch index — the normal per-turn path. */
  async captureAndRelease(
    root: string,
    input: { conversationId: string; turnId: string; kind: CheckpointKind }
  ): Promise<CapturedCheckpoint> {
    const captured = await this.capture(root, input);
    await rm(captured.indexPath, { force: true }).catch(() => undefined);

    const { indexPath: _indexPath, ...rest } = captured;
    return rest;
  }

  /** A unified diff between two checkpoint commits. Reads trees only. */
  async diff(root: string, fromSha: string, toSha: string): Promise<string> {
    return this.git(['--no-pager', 'diff', '--no-color', '-U3', fromSha, toSha], root, {
      timeoutMs: CAPTURE_TIMEOUT_MS
    });
  }

  async diffStat(root: string, fromSha: string, toSha: string): Promise<CheckpointDiffStat> {
    const output = await this.git(['diff', '--numstat', fromSha, toSha], root, {
      timeoutMs: CAPTURE_TIMEOUT_MS
    });

    return parseNumstat(output);
  }

  /**
   * Puts the working tree back to `preSha`, recording an undo point first.
   *
   * The two-tree `read-tree -m -u` is what makes this exact rather than a
   * blanket overwrite: files the turn created are deleted, files it changed are
   * restored, files it never touched are left alone, and emptied directories
   * are pruned. The real index is then pointed back at HEAD so `git status`
   * describes the restored files the way it did before the turn ran.
   */
  async revertTo(
    root: string,
    input: { conversationId: string; turnId: string; preTreeSha: string }
  ): Promise<{ undo: CapturedCheckpoint }> {
    const undo = await this.capture(root, {
      conversationId: input.conversationId,
      turnId: input.turnId,
      kind: 'undo'
    });

    try {
      const env = { ...CHECKPOINT_IDENTITY, GIT_INDEX_FILE: undo.indexPath };

      await this.git(['read-tree', '-m', '-u', undo.treeSha, input.preTreeSha], root, {
        env,
        timeoutMs: CAPTURE_TIMEOUT_MS
      });

      // The scratch index now describes the restored tree; the repository's own
      // index still describes the turn's edits, so it is reset to HEAD. On an
      // unborn branch there is no HEAD to reset to and the index is left alone.
      const headSha = await this.headSha(root);
      if (headSha) {
        await this.git(['reset', '-q', '--mixed', 'HEAD'], root, { timeoutMs: CAPTURE_TIMEOUT_MS });
      }

      const { indexPath: _indexPath, ...rest } = undo;
      return { undo: rest };
    } finally {
      await rm(undo.indexPath, { force: true }).catch(() => undefined);
    }
  }

  /** Removes a checkpoint ref. Objects are left for gc to reclaim. */
  async deleteRef(root: string, refName: string): Promise<void> {
    await this.run('git', ['update-ref', '-d', refName], {
      cwd: root,
      timeoutMs: READ_TIMEOUT_MS
    }).catch(() => undefined);
  }

  /** Every checkpoint ref this conversation owns. */
  async listRefs(root: string, conversationId: string): Promise<string[]> {
    const result = await this.run(
      'git',
      ['for-each-ref', '--format=%(refname)', `refs/atlas/checkpoints/${conversationId}`],
      { cwd: root, timeoutMs: READ_TIMEOUT_MS }
    ).catch(() => null);

    if (!result || result.code !== 0) {
      return [];
    }

    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  }
}

export function parseNumstat(output: string): CheckpointDiffStat {
  let filesChanged = 0;
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [added, removed] = trimmed.split('\t');
    filesChanged += 1;

    // A binary file reports `-` for both counts; it still changed.
    linesAdded += Number.parseInt(added ?? '', 10) || 0;
    linesRemoved += Number.parseInt(removed ?? '', 10) || 0;
  }

  return { filesChanged, linesAdded, linesRemoved };
}
