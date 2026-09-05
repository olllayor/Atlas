/**
 * "Is this agent on the machine, and which version?" — the one question every
 * row of the Local agents list has to answer before anything else is worth
 * showing.
 *
 * Two wrinkles drive the shape here:
 *
 * - A packaged Electron app inherits a stripped `PATH` (no `/opt/homebrew/bin`,
 *   no `~/.local/bin`), so a bare command name that works in a terminal reads
 *   as "not installed" from the app. Lookup therefore goes through a login
 *   shell, which is the only thing that knows the user's real `PATH`.
 * - Every CLI prints its version differently (`1.18.28`, `2.1.261 (Claude
 *   Code)`, `codex-cli 0.148.0`, `2026.05.09-0afadcc`), so the version is the
 *   first version-looking token rather than the whole line.
 */

import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';

import type { LocalAgentDetection } from '../../../shared/localAgents.js';

const VERSION_TOKEN_PATTERN = /\b(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)\b/;

const DEFAULT_TIMEOUT_MS = 8_000;

export function parseCliVersion(output: string): string | null {
  return VERSION_TOKEN_PATTERN.exec(output)?.[1] ?? null;
}

export interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface LocalAgentDetectionDeps {
  /** Spawn seam; tests answer without touching the machine. */
  readonly run?: (
    command: string,
    args: readonly string[],
    options: { timeoutMs: number; env?: NodeJS.ProcessEnv }
  ) => Promise<RunResult>;
  /** PATH lookup seam. Returns the absolute path, or null when not found. */
  readonly lookup?: (command: string, env?: NodeJS.ProcessEnv) => Promise<string | null>;
  readonly now?: () => Date;
}

function defaultRun(
  command: string,
  args: readonly string[],
  options: { timeoutMs: number; env?: NodeJS.ProcessEnv }
): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        timeout: options.timeoutMs,
        windowsHide: true,
        ...(options.env ? { env: options.env } : {})
      },
      (error, stdout, stderr) => {
        resolve({
          code: error ? ((error as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 1) : 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? '')
        });
      }
    );
  });
}

/**
 * Resolve a command to an absolute path.
 *
 * A configured path (anything with a separator) is taken at its word and only
 * checked for existence — overriding the binary is exactly how a user points
 * Atlas at a build that is not on `PATH`. A bare name goes through the login
 * shell so the answer matches what the user's terminal would resolve.
 */
async function defaultLookup(command: string, env?: NodeJS.ProcessEnv): Promise<string | null> {
  if (command.includes('/')) {
    try {
      await access(command, constants.X_OK);
      return command;
    } catch {
      return null;
    }
  }

  const shell = env?.SHELL ?? process.env.SHELL ?? '/bin/sh';
  const result = await defaultRun(shell, ['-lc', `command -v ${JSON.stringify(command)}`], {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    ...(env ? { env } : {})
  });
  const resolved = result.stdout.trim().split('\n').filter(Boolean).pop();
  return result.code === 0 && resolved ? resolved : null;
}

export async function detectLocalAgent(
  input: {
    readonly command: string;
    readonly versionArgs: readonly string[];
    readonly env?: NodeJS.ProcessEnv;
  },
  deps: LocalAgentDetectionDeps = {}
): Promise<LocalAgentDetection> {
  const run = deps.run ?? defaultRun;
  const lookup = deps.lookup ?? defaultLookup;
  const checkedAt = (deps.now?.() ?? new Date()).toISOString();

  const command = input.command.trim();
  if (!command) {
    return { installed: false, version: null, resolvedPath: null, checkedAt };
  }

  const resolvedPath = await lookup(command, input.env);
  if (!resolvedPath) {
    return { installed: false, version: null, resolvedPath: null, checkedAt };
  }

  const result = await run(resolvedPath, input.versionArgs, {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    ...(input.env ? { env: input.env } : {})
  });

  // A CLI that resolved but refuses `--version` is still installed: the path
  // is proof. Version stays null and the UI says so, rather than the row
  // claiming the agent is missing.
  return {
    installed: true,
    version: parseCliVersion(`${result.stdout}\n${result.stderr}`),
    resolvedPath,
    checkedAt
  };
}
