/**
 * What is running inside a terminal, for its tab label.
 *
 * A tab that always reads "Terminal 2" tells the user nothing about which of
 * their shells is the one running the test suite. The cheapest honest answer
 * is the shell's own child process, which `ps` already knows.
 *
 * Everything except `probeProcessTree` is pure, because the parsing is the
 * part that is easy to get wrong and impossible to notice: a misparse shows up
 * as a tab that quietly never changes its name.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

export type ProcessTable = {
  /** pid → its direct children, in the order `ps` listed them. */
  childrenByParent: Map<number, number[]>;
  /** pid → its `comm`, exactly as reported. */
  commandById: Map<number, string>;
};

export type SubprocessInspection = {
  hasRunningSubprocess: boolean;
  /** Normalized name of the shell's first child, or null when idle. */
  childCommand: string | null;
};

const MAX_LABEL_LENGTH = 32;

export const EMPTY_PROCESS_TABLE: ProcessTable = {
  childrenByParent: new Map(),
  commandById: new Map(),
};

/**
 * Parses `ps -A -o pid=,ppid=,comm=`. The first two fields are integers and
 * the rest of the line is the command, which may itself contain spaces — an
 * app bundle under `/Applications/Some App.app` is the common case.
 */
export function parseProcessTable(stdout: string): ProcessTable {
  const childrenByParent = new Map<number, number[]>();
  const commandById = new Map<number, string>();

  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;

    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) continue;

    commandById.set(pid, match[3].trim());
    const children = childrenByParent.get(parentPid);
    if (children) children.push(pid);
    else childrenByParent.set(parentPid, [pid]);
  }

  return { childrenByParent, commandById };
}

/**
 * The name worth putting on a tab: the basename, without the leading dash a
 * login shell carries, capped so a long path cannot push the close button off
 * the strip.
 */
export function normalizeChildCommandName(raw: string): string | null {
  const basename = raw.trim().split('/').pop()?.trim();
  if (!basename) return null;

  const withoutLoginDash = basename.startsWith('-') ? basename.slice(1) : basename;
  if (!withoutLoginDash) return null;

  return withoutLoginDash.length > MAX_LABEL_LENGTH
    ? `${withoutLoginDash.slice(0, MAX_LABEL_LENGTH - 1)}…`
    : withoutLoginDash;
}

/**
 * Whether the shell has a child, and what it is called.
 *
 * The *first* child is the answer even when several are running: a pipeline
 * shows its head, which is the command the user typed.
 */
export function inspectSubprocess(table: ProcessTable, shellPid: number): SubprocessInspection {
  const childPid = table.childrenByParent.get(shellPid)?.[0];
  if (childPid === undefined) return { hasRunningSubprocess: false, childCommand: null };

  return {
    hasRunningSubprocess: true,
    childCommand: normalizeChildCommandName(table.commandById.get(childPid) ?? ''),
  };
}

/**
 * Absolute, and resolved once. Spawning `ps` by bare name walks every PATH
 * entry — one failed spawn per directory until the hit — and this runs on a
 * one-second cadence while a terminal is open.
 */
const PS_CANDIDATES = ['/bin/ps', '/usr/bin/ps'] as const;

let resolvedPs: string | null | undefined;

function resolvePs(): string | null {
  if (resolvedPs !== undefined) return resolvedPs;
  resolvedPs = PS_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
  return resolvedPs;
}

/**
 * One process table, or the empty one.
 *
 * Failure is not worth reporting: the only consequence is a tab that keeps its
 * fallback name, and a terminal panel that surfaced "ps exited 1" would be
 * noise about something the user never asked for. Windows has no `ps`, so
 * labels there stay at "Terminal N".
 */
export function probeProcessTree(): Promise<ProcessTable> {
  const ps = resolvePs();
  if (!ps) return Promise.resolve(EMPTY_PROCESS_TABLE);

  return new Promise((resolve) => {
    execFile(
      ps,
      ['-A', '-o', 'pid=,ppid=,comm='],
      { maxBuffer: 8 * 1024 * 1024, timeout: 2_000 },
      (error, stdout) => {
        resolve(error ? EMPTY_PROCESS_TABLE : parseProcessTable(stdout));
      }
    );
  });
}
