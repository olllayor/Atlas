import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCommand } from '../ai/tools/toolRuntime';
import type { ReviewDiff, ReviewFile, ReviewScope } from '../../shared/review';
import { parseReviewDiff } from '../../shared/review';

/** A whole-repository diff over a cold cache outlasts the 20s tools use. */
const DIFF_TIMEOUT_MS = 120_000;
const READ_TIMEOUT_MS = 20_000;

/**
 * The branches a repository is compared against when nothing says otherwise,
 * in the order they are tried. `origin/HEAD` is asked first and is the only
 * one that is actually configured rather than guessed.
 */
const FALLBACK_BASE_BRANCHES = ['main', 'master', 'develop'];

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number }
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

/**
 * Reading and editing the repository's diff, one hunk at a time.
 *
 * Separate from `GitStateService`, which answers "what is the repository's
 * state"; this answers "what changed, and change what is staged". The split
 * matters because everything here writes: staging, unstaging and reverting are
 * the operations that can lose a user's work, and they are worth keeping in one
 * place with one set of rules about how a patch reaches `git apply`.
 *
 * Patches are written to a temp file rather than piped, because the shared
 * command runner deliberately gives its children no stdin.
 */
export class GitReviewService {
  private readonly run: CommandRunner;

  constructor(options: { run?: CommandRunner } = {}) {
    this.run =
      options.run ??
      ((command, args, opts) =>
        runCommand(command, args, { cwd: opts.cwd, timeoutMs: opts.timeoutMs }));
  }

  private async git(args: string[], root: string, timeoutMs = READ_TIMEOUT_MS): Promise<string> {
    const result = await this.run('git', args, { cwd: root, timeoutMs });

    if (result.code !== 0) {
      const message = result.stderr.trim() || result.stdout.trim();
      throw new Error(message || `git ${args[0]} exited with code ${result.code ?? 'unknown'}.`);
    }

    return result.stdout;
  }

  /** Same call, but a non-zero exit means "nothing", not "broken". */
  private async gitOrNull(args: string[], root: string): Promise<string | null> {
    const result = await this.run('git', args, { cwd: root, timeoutMs: READ_TIMEOUT_MS }).catch(
      () => null
    );

    return result && result.code === 0 ? result.stdout.trim() : null;
  }

  /**
   * The branch this one is measured against.
   *
   * `origin/HEAD` is the repository's own answer, so it is asked first. The
   * fallbacks only apply when the remote never set one, and each is checked for
   * existence rather than assumed — a repository whose trunk is `develop`
   * should not be diffed against a `main` that is not there.
   */
  async resolveBaseBranch(root: string): Promise<string | null> {
    const symbolic = await this.gitOrNull(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root);

    if (symbolic) {
      return symbolic;
    }

    const current = await this.gitOrNull(['branch', '--show-current'], root);

    for (const candidate of FALLBACK_BASE_BRANCHES) {
      if (candidate === current) {
        continue;
      }

      const exists = await this.gitOrNull(['rev-parse', '--verify', '-q', candidate], root);

      if (exists) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * The diff for one scope.
   *
   * `lastTurn` is not resolved here: it is a pair of checkpoint commits the
   * caller looks up, because this service knows about repositories and not
   * about conversations.
   */
  async review(
    root: string,
    scope: ReviewScope,
    options: { commit?: string | null; range?: { from: string; to: string } | null } = {}
  ): Promise<ReviewDiff> {
    const common = ['--no-pager', 'diff', '--no-color', '--no-ext-diff', '-U3'];

    if (scope === 'unstaged') {
      // `--` with no paths keeps a file named like a revision from being read
      // as one.
      const output = await this.git([...common, '--'], root, DIFF_TIMEOUT_MS);
      const files = parseReviewDiff(output);

      return {
        scope,
        files: await this.withUntracked(root, files),
        subject: null,
        emptyReason: null
      };
    }

    if (scope === 'staged') {
      const output = await this.git([...common, '--cached', '--'], root, DIFF_TIMEOUT_MS);

      return { scope, files: parseReviewDiff(output), subject: null, emptyReason: null };
    }

    if (scope === 'branch') {
      const base = await this.resolveBaseBranch(root);

      if (!base) {
        return {
          scope,
          files: [],
          subject: null,
          emptyReason:
            'No base branch to compare with. This repository has no `origin/HEAD`, and no `main`, `master` or `develop`.'
        };
      }

      // Three dots: the merge base, not the tip. Comparing with the tip shows
      // everything that landed on the base since this branch started, which is
      // not what this branch changed.
      const output = await this.git([...common, `${base}...HEAD`, '--'], root, DIFF_TIMEOUT_MS);

      return { scope, files: parseReviewDiff(output), subject: base, emptyReason: null };
    }

    if (scope === 'commit') {
      const commit = options.commit?.trim();

      if (!commit) {
        return { scope, files: [], subject: null, emptyReason: 'Pick a commit to see its changes.' };
      }

      const output = await this.git(
        ['--no-pager', 'show', '--no-color', '--no-ext-diff', '-U3', '--format=', commit, '--'],
        root,
        DIFF_TIMEOUT_MS
      );

      const short = await this.gitOrNull(['rev-parse', '--short', commit], root);

      return { scope, files: parseReviewDiff(output), subject: short ?? commit, emptyReason: null };
    }

    const range = options.range;

    if (!range) {
      return {
        scope,
        files: [],
        subject: null,
        emptyReason:
          'No snapshot for the last turn. Checkpoints are captured in Code mode, inside a git repository.'
      };
    }

    const output = await this.git(
      [...common, range.from, range.to, '--'],
      root,
      DIFF_TIMEOUT_MS
    );

    return { scope, files: parseReviewDiff(output), subject: null, emptyReason: null };
  }

  /**
   * Untracked files, as diffs against nothing.
   *
   * `git diff` says nothing about them, so a new file the assistant just wrote
   * would be missing from the one scope most likely to be open — the exact case
   * the pane exists for. `--no-index` produces a real patch, and `/dev/null` on
   * the left makes it an addition.
   */
  private async withUntracked(root: string, files: ReviewFile[]): Promise<ReviewFile[]> {
    const listed = await this.gitOrNull(['ls-files', '--others', '--exclude-standard'], root);

    if (!listed) {
      return files;
    }

    const paths = listed.split('\n').map((line) => line.trim()).filter(Boolean);
    const known = new Set(files.map((file) => file.path));
    const extra: ReviewFile[] = [];

    for (const path of paths) {
      if (known.has(path)) {
        continue;
      }

      // Exit code 1 means "differs", which is the expected result here.
      const result = await this.run(
        'git',
        ['--no-pager', 'diff', '--no-color', '--no-index', '-U3', '--', '/dev/null', path],
        { cwd: root, timeoutMs: DIFF_TIMEOUT_MS }
      ).catch(() => null);

      if (!result?.stdout) {
        continue;
      }

      for (const file of parseReviewDiff(result.stdout)) {
        extra.push({ ...file, path, status: 'added' });
      }
    }

    return [...files, ...extra].sort((a, b) => a.path.localeCompare(b.path));
  }

  async stage(root: string, paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    await this.git(['add', '--', ...paths], root, DIFF_TIMEOUT_MS);
  }

  /**
   * Takes files out of the index without touching the working tree.
   *
   * `restore --staged` rather than `reset`: on a repository with no commits
   * there is no HEAD to reset against, and `restore --staged` handles that
   * case by removing the entry outright.
   */
  async unstage(root: string, paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    await this.git(['restore', '--staged', '--', ...paths], root, DIFF_TIMEOUT_MS);
  }

  /**
   * Throws away changes to `paths`, in the working tree and in the index.
   *
   * A file that git has never seen cannot be restored — there is no version to
   * restore it to — so those are deleted instead. That is what reverting an
   * addition means, and leaving them behind would make "revert" quietly
   * partial.
   */
  async revert(root: string, paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    const tracked: string[] = [];
    const untracked: string[] = [];

    for (const path of paths) {
      const known = await this.gitOrNull(['ls-files', '--error-unmatch', '--', path], root);
      (known ? tracked : untracked).push(path);
    }

    if (tracked.length > 0) {
      await this.git(['restore', '--staged', '--worktree', '--', ...tracked], root, DIFF_TIMEOUT_MS);
    }

    if (untracked.length > 0) {
      await this.git(['clean', '-f', '--', ...untracked], root, DIFF_TIMEOUT_MS);
    }
  }

  /**
   * Applies one hunk's patch.
   *
   * `cached` decides whether it lands in the index (staging a hunk) or the
   * working tree (reverting one); `reverse` decides direction. The four
   * combinations are exactly the per-hunk actions the pane offers.
   */
  async applyPatch(
    root: string,
    patch: string,
    options: { cached?: boolean; reverse?: boolean } = {}
  ): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'atlas-review-'));
    const file = join(directory, 'hunk.patch');

    try {
      // `git apply` rejects a patch whose final line is unterminated, and a
      // hunk sliced out of a larger diff often is.
      await writeFile(file, patch.endsWith('\n') ? patch : `${patch}\n`, 'utf8');

      const args = ['apply'];

      if (options.cached) {
        args.push('--cached');
      }

      if (options.reverse) {
        args.push('-R');
      }

      args.push('--', file);

      const result = await this.run('git', args, { cwd: root, timeoutMs: DIFF_TIMEOUT_MS });

      if (result.code !== 0) {
        const message = result.stderr.trim() || result.stdout.trim();
        throw new Error(
          message ||
            'This hunk no longer applies. The file has changed since the diff was read — refresh and try again.'
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
