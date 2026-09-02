/**
 * Finds and kills orphaned `opencode serve` child processes.
 *
 * When Atlas crashes or is restarted during development (`electron-vite dev`),
 * child processes spawned with `detached: true` are reparented to launchd/init
 * (PID 1). Because they are in their own process group, the OS does not send
 * SIGHUP or SIGTERM on parent death.
 *
 * This reaper runs on boot and kills any `opencode serve` process whose parent
 * PID is 1, stopping orphaned servers from accumulating and exhausting swap.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

const PS_CANDIDATES = ['/bin/ps', '/usr/bin/ps'] as const;

let resolvedPs: string | null | undefined;

function resolvePs(): string | null {
  if (resolvedPs !== undefined) return resolvedPs;
  resolvedPs = PS_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
  return resolvedPs;
}

const OPENCODE_SERVE_PATTERN = /\bopencode\d*(\.exe)?\s+serve\b/i;

/**
 * Pure parser for `ps -A -o pid=,ppid=,args=`.
 * Returns PIDs of orphaned opencode serve processes (ppid === 1).
 */
export function parseOrphanedOpenCodePids(stdout: string): number[] {
  const pids: number[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;

    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const command = match[3];

    if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) continue;
    if (parentPid !== 1) continue;

    if (OPENCODE_SERVE_PATTERN.test(command) || (command.includes('opencode') && command.includes('serve'))) {
      pids.push(pid);
    }
  }
  return pids;
}

function runPs(): Promise<string> {
  if (process.platform === 'win32') return Promise.resolve('');
  const ps = resolvePs();
  if (!ps) return Promise.resolve('');

  return new Promise((resolve) => {
    execFile(
      ps,
      ['-A', '-o', 'pid=,ppid=,args='],
      { maxBuffer: 8 * 1024 * 1024, timeout: 3_000 },
      (error, stdout) => {
        resolve(error ? '' : stdout);
      }
    );
  });
}

export async function reapOrphanedOpenCodeServers(options?: {
  psRunner?: () => Promise<string>;
  killer?: (pid: number) => void;
}): Promise<number[]> {
  if (process.platform === 'win32') return [];

  const runner = options?.psRunner ?? runPs;
  const killer = options?.killer ?? ((pid: number) => {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process may have already exited.
    }
  });

  try {
    const stdout = await runner();
    if (!stdout) return [];

    const orphans = parseOrphanedOpenCodePids(stdout);
    for (const pid of orphans) {
      console.info(`[opencode] reaping orphaned server (pid ${pid}, ppid 1)`);
      killer(pid);
    }
    return orphans;
  } catch (error) {
    console.warn('[opencode] orphan reap failed:', error);
    return [];
  }
}
