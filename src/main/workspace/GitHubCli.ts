import { accessSync, constants, existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCommand } from '../ai/tools/toolRuntime';
import { defaultPathDirs } from './IdeLauncher';

/** How long a detection probe is trusted before it is re-run. */
const DETECTION_TTL_MS = 30_000;
const GH_TIMEOUT_MS = 20_000;

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
  options: { cwd?: string; timeoutMs?: number }
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

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
