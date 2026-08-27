/**
 * Pure parsing helpers for the OpenCode runtime — kept dependency-free so the
 * full behavior matrix can be tested without spawning anything.
 *
 * Blueprint: pingdotgg/t3code `apps/server/src/provider/opencodeRuntime.ts`
 * (constants L51-54, `parseServerUrlFromOutput` L188-197).
 */

export const OPENCODE_SERVER_READY_PREFIX = 'opencode server listening';
export const OPENCODE_SERVER_STARTUP_TIMEOUT_MS = 30_000;
export const OPENCODE_DEFAULT_HOSTNAME = '127.0.0.1';

/**
 * Extract the listening URL from a `opencode serve` stdout stream.
 *
 * The CLI announces readiness with exactly one line of the shape:
 *
 *     opencode server listening on http://127.0.0.1:<port>
 *
 * We scan accumulated output line-by-line (t3code parity): any number of
 * non-ready log lines may precede the announcement, and partial chunks mean
 * a match can appear only after enough bytes arrived — callers simply re-run
 * this over the growing buffer.
 */
export function parseOpenCodeServerUrlFromOutput(output: string): string | null {
  for (const line of output.split('\n')) {
    if (!line.startsWith(OPENCODE_SERVER_READY_PREFIX)) {
      continue;
    }
    const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
    return match?.[1] ?? null;
  }
  return null;
}

/**
 * Parse `<binary> --version` output down to its first semver-looking token.
 * Mirrors t3code's `parseGenericCliVersion` semantics loosely: first token of
 * any whitespace-split word that looks like MAJOR.MINOR[.PATCH][-suffix].
 */
const SEMVER_TOKEN_PATTERN = /\b(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)\b/;

export function parseOpenCodeVersionOutput(stdout: string): string | null {
  const match = SEMVER_TOKEN_PATTERN.exec(stdout);
  return match?.[1] ?? null;
}

/**
 * Compare two dotted numeric versions (-pre suffix tolerated). Returns a
 * negative number when `left` is older than `right` (same contract as
 * t3code's compareSemverVersions for our use: floor enforcement).
 */
export function compareOpenCodeVersions(left: string, right: string): number {
  const core = (v: string) => v.split('-')[0] ?? '';
  const leftParts = core(left).split('.');
  const rightParts = core(right).split('.');
  const width = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < width; index += 1) {
    const l = Number.parseInt(leftParts[index] ?? '0', 10) || 0;
    const r = Number.parseInt(rightParts[index] ?? '0', 10) || 0;
    if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

/** Flatten stderr/stdout tails into an actionable error detail (bounded). */
export function summarizeProcessFailure(input: {
  readonly exitCode: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly stdoutTail?: string;
  readonly stderrTail?: string;
}): string {
  const parts: string[] = [];
  if (input.signal) {
    parts.push(`terminated by ${input.signal}`);
  } else {
    parts.push(`exit code ${input.exitCode ?? '?'}`);
  }
  const clean = (value: string | undefined) => value?.trim().slice(-400) || '';
  const stderr = clean(input.stderrTail);
  const stdout = clean(input.stdoutTail);
  if (stderr) parts.push(`stderr:\n${stderr}`);
  if (stdout && !stderr) parts.push(`stdout:\n${stdout}`);
  return parts.join('\n\n');
}
