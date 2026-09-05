import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ToolWorkspace } from '../ai/tools/toolWorkspace';
import { runGit } from '../ai/tools/codeTools';
import { validateBranchName } from '../ai/tools/gitTools';

/**
 * `git branch -a` lists remote branches as `remotes/origin/feature`, which is
 * not a name `git switch` accepts. Dropping the two leading segments turns the
 * listed name back into the local branch git would create for it.
 */
function normalizeBranchName(raw: string): string {
  const name = validateBranchName(raw);
  if (!name.startsWith('remotes/')) {
    return name;
  }

  const segments = name.split('/');
  return segments.slice(2).join('/') || name;
}

export type GitFileStatus = {
  path: string;
  indexStatus: string;
  workingTreeStatus: string;
};

export type GitLogEntry = {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
};

export type GitBranchInfo = {
  name: string;
  current: boolean;
  remote: boolean;
};

/** What `--branch` adds to a porcelain status: the header line, decoded. */
export type GitBranchState = {
  branch: string | null;
  ahead: number | null;
  behind: number | null;
};

export type GitWorkingState = GitBranchState & {
  files: GitFileStatus[];
};

const DETACHED_BRANCH_LABEL = 'HEAD (detached)';
const DETACHED_HEADER = 'HEAD (no branch)';
const NO_COMMITS_PREFIX = 'No commits yet on ';

const UNKNOWN_BRANCH_STATE: GitBranchState = { branch: null, ahead: null, behind: null };

/**
 * Decode the `## …` line that `git status --branch` prints first.
 *
 * The shapes, all of which appear in normal use:
 *
 *     ## main                                  no upstream
 *     ## main...origin/main                    upstream, in sync
 *     ## main...origin/main [ahead 1]          one side only
 *     ## main...origin/main [ahead 1, behind 2]
 *     ## main...origin/main [gone]             upstream ref deleted
 *     ## HEAD (no branch)                      detached
 *     ## No commits yet on main                fresh repo
 *
 * Ahead/behind stay null rather than falling to zero whenever there is nothing
 * to compare against — no upstream, or an upstream that has been deleted.
 * "0 ahead, 0 behind" would claim the branch is in sync with a remote it has
 * never been pushed to, which is a different and much more reassuring fact.
 */
export function parseStatusBranchHeader(line: string): GitBranchState {
  if (!line.startsWith('## ')) return UNKNOWN_BRANCH_STATE;

  let rest = line.slice(3).trim();

  if (rest === DETACHED_HEADER) {
    return { branch: DETACHED_BRANCH_LABEL, ahead: null, behind: null };
  }

  if (rest.startsWith(NO_COMMITS_PREFIX)) {
    rest = rest.slice(NO_COMMITS_PREFIX.length);
  }

  // `[` is not a legal character in a refname, so the bracket can only ever be
  // the tracking suffix and never part of a branch name.
  const tracking = /\s\[(.+)\]$/.exec(rest);
  const spec = tracking ? rest.slice(0, tracking.index) : rest;

  // Likewise `..` is forbidden in a refname, so the `...` separator is
  // unambiguous and neither side can contain it.
  const separator = spec.indexOf('...');
  const branch = (separator === -1 ? spec : spec.slice(0, separator)).trim() || null;

  if (separator === -1) return { branch, ahead: null, behind: null };
  if (!tracking) return { branch, ahead: 0, behind: 0 };

  const detail = tracking[1]!;
  if (detail === 'gone') return { branch, ahead: null, behind: null };

  const ahead = /ahead (\d+)/.exec(detail);
  const behind = /behind (\d+)/.exec(detail);

  return {
    branch,
    ahead: ahead ? Number.parseInt(ahead[1]!, 10) : 0,
    behind: behind ? Number.parseInt(behind[1]!, 10) : 0
  };
}

/** Decode one `XY path` line of porcelain v1 output. */
export function parseStatusFileLine(line: string): GitFileStatus {
  const indexStatus = line[0] || ' ';
  const workingTreeStatus = line[1] || ' ';
  let path = line.slice(3).trim();

  // Renamed/copied files arrive as 'R  old -> new'; the new path is the one
  // that exists on disk and the only one worth showing.
  if ((indexStatus === 'R' || indexStatus === 'C') && path.includes(' -> ')) {
    path = path.split(' -> ').pop()!.trim();
  }

  return { path, indexStatus, workingTreeStatus };
}

export class GitStateService {
  isGitRepo(root: string): boolean {
    const absRoot = resolve(root);
    return existsSync(resolve(absRoot, '.git'));
  }

  /**
   * Branch, upstream drift and working-tree status in one `git` invocation.
   *
   * These used to be three: `branch --show-current`, `status --porcelain=v1`
   * and `rev-list --left-right --count @{upstream}...HEAD`. Adding `--branch`
   * to the status call makes it print all three as a header line above the file
   * list, so the panel costs one subprocess instead of three — and, unlike
   * caching the two cheap ones, the answer is never stale.
   *
   * `getBranch` / `getStatus` / `getAheadBehind` remain as narrow readers on
   * top of this, so there is exactly one parser and one command to keep right.
   */
  async getState(root: string): Promise<GitWorkingState> {
    if (!this.isGitRepo(root)) return { ...UNKNOWN_BRANCH_STATE, files: [] };
    const workspace: ToolWorkspace = { mode: 'code', root };

    try {
      const output = await runGit(['status', '--porcelain=v1', '--branch'], workspace);
      const lines = output.split('\n').filter(Boolean);
      const hasHeader = lines[0]?.startsWith('## ') ?? false;

      return {
        ...parseStatusBranchHeader(hasHeader ? lines[0]! : ''),
        files: (hasHeader ? lines.slice(1) : lines).map(parseStatusFileLine)
      };
    } catch (err) {
      console.warn('[GitStateService] getState failed:', err);
      return { ...UNKNOWN_BRANCH_STATE, files: [] };
    }
  }

  async getBranch(root: string): Promise<string | null> {
    return (await this.getState(root)).branch;
  }

  /**
   * How far the branch has drifted from its upstream. Null when there is no
   * upstream to have drifted from — see `parseStatusBranchHeader`.
   */
  async getAheadBehind(root: string): Promise<{ ahead: number | null; behind: number | null }> {
    const { ahead, behind } = await this.getState(root);
    return { ahead, behind };
  }

  async switchBranch(root: string, name: string): Promise<void> {
    const workspace: ToolWorkspace = { mode: 'code', root };
    await runGit(['switch', normalizeBranchName(name)], workspace);
  }

  /**
   * The remote's default branch (`origin/HEAD`), or null when it cannot be
   * determined — no `origin`, `origin/HEAD` unset, or git failing. Null means
   * "not provably the default", so callers treat it as ineligible rather than
   * guessing from the checked-out name.
   */
  async getDefaultBranch(root: string): Promise<string | null> {
    if (!this.isGitRepo(root)) return null;
    const workspace: ToolWorkspace = { mode: 'code', root };
    try {
      const output = await runGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], workspace);
      const match = /^refs\/remotes\/origin\/(.+)$/.exec(output.trim());
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Fast-forward only. Anything needing a merge or rebase throws, and the
   * caller leaves the checkout exactly where it was.
   */
  async pullCurrentBranch(root: string): Promise<string> {
    const workspace: ToolWorkspace = { mode: 'code', root };
    const output = await runGit(['pull', '--ff-only'], workspace);
    return output.trim();
  }

  /**
   * Refreshes the upstream tracking refs without touching the checkout.
   * Throws when offline or the remote is unreachable — callers treat that as
   * a skip, never an error.
   */
  async fetchRemote(root: string): Promise<void> {
    const workspace: ToolWorkspace = { mode: 'code', root };
    await runGit(['fetch'], workspace);
  }

  async createBranch(root: string, name: string): Promise<void> {
    const workspace: ToolWorkspace = { mode: 'code', root };
    await runGit(['switch', '-c', normalizeBranchName(name)], workspace);
  }

  async commit(
    root: string,
    input: { message: string; amend?: boolean; addAll?: boolean }
  ): Promise<string> {
    const workspace: ToolWorkspace = { mode: 'code', root };
    const message = input.message.trim();

    if (!message && !input.amend) {
      throw new Error('A commit message is required.');
    }

    if (input.addAll) {
      await runGit(['add', '-A'], workspace);
    }

    const args = ['commit'];
    if (message) {
      args.push('-m', message);
    }
    if (input.amend) {
      args.push('--amend');
      if (!message) {
        args.push('--no-edit');
      }
    }

    const output = await runGit(args, workspace);
    return output.trim() || 'Commit created.';
  }

  async getStatus(root: string): Promise<GitFileStatus[]> {
    return (await this.getState(root)).files;
  }

  async getLog(root: string, maxCount = 20): Promise<GitLogEntry[]> {
    if (!this.isGitRepo(root)) return [];
    const workspace: ToolWorkspace = { mode: 'code', root };
    try {
      // Format: hash%x1fshortHash%x1fmessage%x1fauthor%x1fdate
      const output = await runGit(
        ['log', `--max-count=${maxCount}`, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ad', '--date=iso'],
        workspace
      );
      const lines = output.split('\n').filter(Boolean);
      return lines.map((line) => {
        const [hash = '', shortHash = '', message = '', author = '', date = ''] = line.split('\x1f');
        return { hash, shortHash, message, author, date };
      });
    } catch (err) {
      console.warn('[GitStateService] getLog failed:', err);
      return [];
    }
  }

  async getBranches(root: string): Promise<GitBranchInfo[]> {
    if (!this.isGitRepo(root)) return [];
    const workspace: ToolWorkspace = { mode: 'code', root };
    try {
      const output = await runGit(['branch', '-a', '--no-color'], workspace);
      const lines = output.split('\n').filter(Boolean);
      return lines.map((line) => {
        const current = line.startsWith('*');
        const cleanName = line.replace(/^\*?\s+/, '').trim();
        const remote = cleanName.startsWith('remotes/');
        return { name: cleanName, current, remote };
      });
    } catch (err) {
      console.warn('[GitStateService] getBranches failed:', err);
      return [];
    }
  }
}
