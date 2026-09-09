import { accessSync, constants, existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  PullRequestAction,
  PullRequestActivity,
  PullRequestDetail,
  PullRequestDiffResult,
  PullRequestInvolvement,
  PullRequestListEntry,
  PullRequestListState
} from '../../shared/contracts';
import { runCommand } from '../ai/tools/toolRuntime';
import {
  PR_ACTIVITY_FIELDS,
  PR_DETAIL_FIELDS,
  PR_LIST_FIELDS,
  decodePullRequestActivity,
  decodePullRequestDetail,
  decodePullRequestList
} from './githubPullRequestJson';
import { defaultPathDirs } from './IdeLauncher';

/** How long a detection probe is trusted before it is re-run. */
const DETECTION_TTL_MS = 30_000;
const GH_TIMEOUT_MS = 20_000;

/**
 * Listing, activity and diff reads get longer than the 20s a status probe does:
 * they are one deliberate request each, and a busy repository's first page is
 * routinely slower than a `gh auth status`.
 */
const GH_LIST_TIMEOUT_MS = 45_000;

/**
 * The ceiling on rows one page may ask for, so a renderer bug cannot turn a
 * listing into a repository-wide crawl.
 */
const PR_LIST_MAX_ROWS = 100;

/** A patch past this is cut, and the caller is told it was. */
const PR_DIFF_MAX_BYTES = 4 * 1024 * 1024;

export type GitHubSlug = {
  owner: string;
  repo: string;
};

export type GitHubCliStatus = {
  /** Whether a `gh` launcher was found on disk. */
  installed: boolean;
  /** Whether `gh auth status` succeeded. False whenever `installed` is false. */
  authenticated: boolean;
};

export type GitHubPullRequest = {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; maxOutputBytes?: number }
) => Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the ingest budget cut stdout short, which a patch reader must know. */
  stdoutTruncated?: boolean;
}>;

export type GitHubCliOptions = {
  platform?: NodeJS.Platform;
  pathDirs?: string[];
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
  run?: CommandRunner;
};

function isExecutable(path: string, platform: NodeJS.Platform) {
  if (platform === 'win32') {
    return existsSync(path);
  }

  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where `gh` lives, or null when this machine has no GitHub CLI.
 *
 * Uses the same explicit directory sweep as the IDE detection rather than
 * trusting `PATH`: a GUI-launched Electron app inherits Finder's stunted
 * environment, and Homebrew's bin directory is not in it.
 */
export function detectGhBinary(options: GitHubCliOptions = {}): string | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathDirs = options.pathDirs ?? defaultPathDirs(platform, env);
  const executable = options.exists ?? ((path: string) => isExecutable(path, platform));
  const binaryName = platform === 'win32' ? 'gh.exe' : 'gh';

  for (const dir of pathDirs) {
    const candidate = join(dir, binaryName);
    if (executable(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * `owner/repo` for a GitHub remote, or null for anything else.
 *
 * Non-GitHub remotes resolve to null rather than throwing: this is the check
 * that decides whether to offer the feature at all, and a GitLab remote is a
 * normal state, not an error.
 */
export function parseGitHubSlug(remoteUrl: string): GitHubSlug | null {
  const url = remoteUrl.trim();
  if (!url) {
    return null;
  }

  // git@github.com:owner/repo.git — scp-style, no scheme to parse.
  const scpMatch = /^[^@]+@github\.com:(?<path>.+)$/.exec(url);
  const path = scpMatch?.groups?.path ?? hostPathFor(url);

  if (!path) {
    return null;
  }

  const segments = path.replace(/\.git$/, '').split('/').filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  // A deeper path (…/owner/repo/tree/main) still identifies the repository.
  const [owner, repo] = segments;
  return { owner: owner!, repo: repo! };
}

function hostPathFor(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
      return null;
    }
    return parsed.pathname.replace(/^\//, '');
  } catch {
    return null;
  }
}

/**
 * Reject values that git or gh would read as flags.
 *
 * The model supplies branch names and PR titles, so every one of them reaches
 * argv as data that looks like it could be an option.
 */
export function assertNotFlag(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  if (trimmed.startsWith('-')) {
    throw new Error(`Invalid ${label}: '${trimmed}'. It cannot start with '-'.`);
  }
  return trimmed;
}

/**
 * The GitHub half of the workspace: detection, PR lookup, and PR creation.
 *
 * Everything is argv-only and routed through `runCommand`, so no string ever
 * reaches a shell. Detection is cached because `gh auth status` is a process
 * spawn and the toolbar asks for it on every render.
 */
export class GitHubService {
  private readonly options: GitHubCliOptions;
  private readonly run: CommandRunner;
  private cached: { at: number; status: GitHubCliStatus; binary: string | null } | null = null;

  constructor(options: GitHubCliOptions = {}) {
    this.options = options;
    this.run = options.run ?? ((command, args, opts) => runCommand(command, args, opts));
  }

  /** Drops the detection cache so the next probe re-runs. */
  invalidate() {
    this.cached = null;
  }

  async getStatus(now: number = Date.now()): Promise<GitHubCliStatus> {
    if (this.cached && now - this.cached.at < DETECTION_TTL_MS) {
      return this.cached.status;
    }

    const binary = detectGhBinary(this.options);
    let status: GitHubCliStatus = { installed: binary !== null, authenticated: false };

    if (binary) {
      const result = await this.run(binary, ['auth', 'status'], { timeoutMs: GH_TIMEOUT_MS }).catch(
        () => null
      );
      status = { installed: true, authenticated: result?.code === 0 };
    }

    this.cached = { at: now, status, binary };
    return status;
  }

  /** The resolved `gh` path, or an error naming the fix. */
  private async requireGh(): Promise<string> {
    const status = await this.getStatus();

    if (!status.installed) {
      throw new Error('GitHub CLI not found. Install it with `brew install gh`, then try again.');
    }

    if (!status.authenticated) {
      throw new Error('GitHub CLI is not signed in. Run `gh auth login`, then try again.');
    }

    return this.cached!.binary!;
  }

  private async git(args: string[], cwd: string) {
    const result = await this.run('git', args, { cwd, timeoutMs: GH_TIMEOUT_MS });

    if (result.code !== 0) {
      const message = result.stderr.trim() || result.stdout.trim();
      throw new Error(message || `git ${args[0]} exited with code ${result.code ?? 'unknown'}.`);
    }

    return result.stdout;
  }

  async getOriginSlug(root: string): Promise<GitHubSlug | null> {
    const result = await this.run('git', ['remote', 'get-url', 'origin'], {
      cwd: root,
      timeoutMs: GH_TIMEOUT_MS
    }).catch(() => null);

    if (!result || result.code !== 0) {
      return null;
    }

    return parseGitHubSlug(result.stdout);
  }

  async getCurrentBranch(root: string): Promise<string | null> {
    const result = await this.run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      timeoutMs: GH_TIMEOUT_MS
    }).catch(() => null);

    if (!result || result.code !== 0) {
      return null;
    }

    const branch = result.stdout.trim();
    // A detached HEAD has no branch to open a pull request from.
    return branch && branch !== 'HEAD' ? branch : null;
  }

  /** The open pull request for `branch`, or null when there is none. */
  async findOpenPr(root: string, branch: string): Promise<GitHubPullRequest | null> {
    const gh = await this.requireGh();
    const head = assertNotFlag(branch, 'branch name');

    const result = await this.run(
      gh,
      [
        'pr',
        'list',
        '--head',
        head,
        '--state',
        'open',
        '--limit',
        '1',
        '--json',
        'number,title,url,isDraft,headRefName,baseRefName'
      ],
      { cwd: root, timeoutMs: GH_TIMEOUT_MS }
    );

    if (result.code !== 0) {
      const message = result.stderr.trim() || result.stdout.trim();
      throw new Error(message || 'Could not list pull requests.');
    }

    return firstPullRequest(result.stdout);
  }

  async pushBranch(root: string, branch: string, force = false): Promise<string> {
    const name = assertNotFlag(branch, 'branch name');
    const args = ['push', '--set-upstream', 'origin', name];

    if (force) {
      // Never a bare --force: a lease still refuses to discard commits this
      // clone has not seen, which is the case that loses someone else's work.
      args.splice(1, 0, '--force-with-lease');
    }

    const output = await this.git(args, root);
    return output.trim() || `Pushed ${name} to origin.`;
  }

  /**
   * Opens a pull request, or returns the existing one.
   *
   * `gh pr create` fails outright when the branch already has an open PR, which
   * is a normal thing for the model to run into after a follow-up commit; the
   * useful answer there is the existing PR, not an error.
   */
  async createPr(
    root: string,
    input: { title: string; body: string; base?: string; draft?: boolean; branch: string }
  ): Promise<{ pr: GitHubPullRequest | null; url: string; alreadyExisted: boolean }> {
    const gh = await this.requireGh();
    const title = assertNotFlag(input.title, 'pull request title');
    const branch = assertNotFlag(input.branch, 'branch name');

    const existing = await this.findOpenPr(root, branch);
    if (existing) {
      return { pr: existing, url: existing.url, alreadyExisted: true };
    }

    // `runCommand` gives the child no stdin, and a PR body is far too big for
    // argv, so the body travels as a file that is deleted either way.
    const dir = await mkdtemp(join(tmpdir(), 'atlas-pr-'));
    const bodyFile = join(dir, 'body.md');

    try {
      await writeFile(bodyFile, input.body ?? '', { encoding: 'utf8', mode: 0o600 });

      const args = ['pr', 'create', '--title', title, '--body-file', bodyFile, '--head', branch];

      if (input.base?.trim()) {
        args.push('--base', assertNotFlag(input.base, 'base branch'));
      }

      if (input.draft) {
        args.push('--draft');
      }

      const result = await this.run(gh, args, { cwd: root, timeoutMs: GH_TIMEOUT_MS });

      if (result.code !== 0) {
        const message = result.stderr.trim() || result.stdout.trim();
        throw new Error(message || 'Could not create the pull request.');
      }

      const url = extractPrUrl(result.stdout) ?? '';
      const pr = await this.findOpenPr(root, branch).catch(() => null);
      return { pr, url: pr?.url ?? url, alreadyExisted: false };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * The signed-in login.
   *
   * `authored` and `reviewing` are both defined in terms of it, so the listing
   * asks once and reuses the answer rather than sending `@me` and hoping every
   * qualifier reads it the same way.
   */
  async getViewerLogin(root: string): Promise<string | null> {
    const gh = await this.requireGh();
    const result = await this.run(gh, ['api', 'user', '--jq', '.login'], {
      cwd: root,
      timeoutMs: GH_TIMEOUT_MS
    }).catch(() => null);

    if (!result || result.code !== 0) {
      return null;
    }

    const login = result.stdout.trim();
    return login || null;
  }

  /**
   * One page of pull requests.
   *
   * Ordering is the reason this goes through `--search` at all: `gh pr list`
   * answers newest-*created* first, which is not the order the panel reads rows
   * in — a pull request opened last year and touched this morning belongs at
   * the top. `sort:updated-desc` is what fixes that, and `gh` takes exactly one
   * `--search`, so every qualifier joins one string.
   */
  async listPullRequests(input: {
    root: string;
    state: PullRequestListState;
    involvement: PullRequestInvolvement;
    viewer: string | null;
    query?: string;
    limit: number;
  }): Promise<{ entries: PullRequestListEntry[]; truncated: boolean }> {
    const gh = await this.requireGh();
    // One row past the page reveals that the repository has more than it shows,
    // without a second request to find out.
    const requested = Math.max(1, Math.min(input.limit, PR_LIST_MAX_ROWS)) + 1;

    const args = [
      'pr',
      'list',
      '--state',
      input.state,
      '--limit',
      String(requested),
      '--json',
      PR_LIST_FIELDS,
      ...involvementArgs(input)
    ];

    const result = await this.run(gh, args, { cwd: input.root, timeoutMs: GH_LIST_TIMEOUT_MS });

    if (result.code !== 0) {
      const message = result.stderr.trim() || result.stdout.trim();
      throw new Error(message || 'Could not list pull requests.');
    }

    const decoded = decodePullRequestList(result.stdout);
    return {
      entries: decoded.slice(0, requested - 1),
      truncated: decoded.length >= requested
    };
  }

  async getPullRequestDetail(root: string, number: number): Promise<PullRequestDetail | null> {
    const gh = await this.requireGh();
    const result = await this.run(
      gh,
      ['pr', 'view', assertPullRequestNumber(number), '--json', PR_DETAIL_FIELDS],
      { cwd: root, timeoutMs: GH_TIMEOUT_MS }
    );

    if (result.code !== 0) {
      const message = result.stderr.trim() || result.stdout.trim();
      throw new Error(message || `Could not read pull request #${number}.`);
    }

    return decodePullRequestDetail(result.stdout);
  }

  async getPullRequestActivity(root: string, number: number): Promise<PullRequestActivity> {
    const gh = await this.requireGh();
    const result = await this.run(
      gh,
      ['pr', 'view', assertPullRequestNumber(number), '--json', PR_ACTIVITY_FIELDS],
      { cwd: root, timeoutMs: GH_LIST_TIMEOUT_MS }
    );

    if (result.code !== 0) {
      const message = result.stderr.trim() || result.stdout.trim();
      throw new Error(message || `Could not read the activity on pull request #${number}.`);
    }

    return decodePullRequestActivity(result.stdout);
  }

  /**
   * The patch.
   *
   * `--color never` because the panel renders the diff itself, and a patch
   * carrying escape sequences is not one the renderer can read. A patch cut at
   * the byte budget is reported as truncated rather than shown as if whole: it
   * ends mid-file, and a reader who is not told that will believe the file
   * ended there.
   */
  async getPullRequestDiff(root: string, number: number): Promise<PullRequestDiffResult> {
    const gh = await this.requireGh();
    const result = await this.run(
      gh,
      ['pr', 'diff', assertPullRequestNumber(number), '--color', 'never'],
      { cwd: root, timeoutMs: GH_LIST_TIMEOUT_MS, maxOutputBytes: PR_DIFF_MAX_BYTES }
    );

    if (result.code !== 0) {
      const message = result.stderr.trim() || result.stdout.trim();
      // GitHub answers 406 rather than a diff once a pull request passes 300
      // changed files. There is nothing to fall back to here, so say what
      // happened instead of showing an empty patch.
      throw new Error(message || `Could not read the diff for pull request #${number}.`);
    }

    return {
      patch: result.stdout,
      truncated: result.stdoutTruncated === true
    };
  }

  /** Merges, closes, reopens, or marks a draft ready. */
  async runPullRequestAction(input: {
    root: string;
    number: number;
    action: PullRequestAction;
    mergeMethod?: 'merge' | 'squash' | 'rebase';
  }): Promise<void> {
    const gh = await this.requireGh();
    const number = assertPullRequestNumber(input.number);
    const args = [...PR_ACTION_ARGS[input.action]];

    if (input.action === 'merge' && input.mergeMethod) {
      args.push(`--${input.mergeMethod}`);
    }

    const [subcommand, ...flags] = args;
    const result = await this.run(gh, ['pr', subcommand!, number, ...flags], {
      cwd: input.root,
      timeoutMs: GH_TIMEOUT_MS
    });

    if (result.code !== 0) {
      const message = result.stderr.trim() || result.stdout.trim();
      throw new Error(message || `Could not ${input.action} pull request #${input.number}.`);
    }
  }

  /** Posts a comment. The body travels as a file, for the same reason a PR body does. */
  async commentOnPullRequest(root: string, number: number, body: string): Promise<void> {
    const gh = await this.requireGh();
    const target = assertPullRequestNumber(number);

    if (!body.trim()) {
      throw new Error('A comment needs something in it.');
    }

    const dir = await mkdtemp(join(tmpdir(), 'atlas-pr-comment-'));
    const bodyFile = join(dir, 'body.md');

    try {
      await writeFile(bodyFile, body, { encoding: 'utf8', mode: 0o600 });
      const result = await this.run(
        gh,
        ['pr', 'comment', target, '--body-file', bodyFile],
        { cwd: root, timeoutMs: GH_TIMEOUT_MS }
      );

      if (result.code !== 0) {
        const message = result.stderr.trim() || result.stdout.trim();
        throw new Error(message || 'Could not post the comment.');
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** The subcommand and fixed flags each action runs as. */
const PR_ACTION_ARGS: Record<PullRequestAction, readonly string[]> = {
  close: ['close'],
  reopen: ['reopen'],
  ready: ['ready'],
  merge: ['merge']
};

/**
 * A pull request number as argv.
 *
 * It reaches `gh` as a positional, so a value that is not a positive integer
 * would be read as something else entirely — a path, or with a leading dash, a
 * flag. The renderer only ever sends numbers it was given, which is exactly why
 * this is checked at the boundary rather than trusted along the way.
 */
export function assertPullRequestNumber(value: number): string {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid pull request number: '${value}'.`);
  }
  return String(value);
}

/**
 * A reader's own words as one search phrase.
 *
 * The quotes are the defence, not the formatting: outside them GitHub reads
 * `is:merged` as a qualifier and `label:x` as another, so text typed into the
 * filter box could widen the very listing it is meant to narrow. Inside them it
 * is only text. The two characters that could end the phrase early are escaped,
 * which GitHub reads back as themselves.
 */
export function searchPhrase(query: string): string {
  return `"${query.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/**
 * The involvement and state narrowings, as flags where `gh` has one and as
 * search qualifiers where it does not.
 *
 * `--state closed` includes merged pull requests, so a reader asking for closed
 * ones additionally excludes them with `is:unmerged` — otherwise the Closed tab
 * is the Merged tab plus a few.
 */
export function involvementArgs(input: {
  state: PullRequestListState;
  involvement: PullRequestInvolvement;
  viewer: string | null;
  query?: string;
}): string[] {
  const query = input.query?.trim() ?? '';
  const viewer = input.viewer?.trim();

  const terms = [
    ...(input.involvement === 'reviewing' && viewer ? [`review-requested:${viewer}`] : []),
    ...(input.state === 'closed' ? ['is:unmerged'] : []),
    ...(query ? [searchPhrase(query)] : []),
    'sort:updated-desc'
  ];

  return [
    ...(input.involvement === 'authored' && viewer ? ['--author', viewer] : []),
    '--search',
    terms.join(' ')
  ];
}

function firstPullRequest(raw: string): GitHubPullRequest | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw.trim() || '[]');
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return null;
  }

  const entry = parsed[0] as Record<string, unknown>;
  const number = typeof entry.number === 'number' ? entry.number : null;
  const url = typeof entry.url === 'string' ? entry.url : null;

  if (number === null || !url) {
    return null;
  }

  return {
    number,
    url,
    title: typeof entry.title === 'string' ? entry.title : '',
    isDraft: entry.isDraft === true,
    headRefName: typeof entry.headRefName === 'string' ? entry.headRefName : '',
    baseRefName: typeof entry.baseRefName === 'string' ? entry.baseRefName : ''
  };
}

/** `gh pr create` prints the new PR's URL on its own line. */
function extractPrUrl(stdout: string): string | null {
  const match = /https:\/\/github\.com\/\S+/.exec(stdout);
  return match ? match[0] : null;
}

export const GITHUB_DETECTION_TTL_MS = DETECTION_TTL_MS;

/** Kept for callers that only need a home-relative default sweep. */
export function defaultGhSearchDirs(home: string = homedir()): string[] {
  return defaultPathDirs(process.platform, process.env, home);
}

let shared: GitHubService | null = null;

/**
 * One service for the whole process.
 *
 * The agent tools and the toolbar both ask about `gh`, and the detection probe
 * is a process spawn, so they share a cache rather than each keeping their own.
 */
export function getSharedGitHubService(): GitHubService {
  shared ??= new GitHubService();
  return shared;
}
