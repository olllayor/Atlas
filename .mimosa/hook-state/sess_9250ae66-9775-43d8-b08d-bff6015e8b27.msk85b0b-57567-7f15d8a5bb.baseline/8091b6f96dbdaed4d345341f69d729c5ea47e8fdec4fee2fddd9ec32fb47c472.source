import type { SandboxMechanism } from './types';

/**
 * Phrases a command emits when the kernel refused it.
 *
 * The last three are Atlas additions for bubblewrap's `--unshare-net`, which
 * leaves the process with no route rather than no permission, so a blocked
 * fetch reports a network error and never says "denied".
 */
const SANDBOX_DENIED_KEYWORDS = [
  'operation not permitted',
  'permission denied',
  'read-only file system',
  'seccomp',
  'sandbox',
  'landlock',
  'failed to write file',
  'network is unreachable',
  'could not resolve host',
  'temporary failure in name resolution'
] as const;

/**
 * What the model is told when a command looks sandbox-denied.
 *
 * It names the escalation path explicitly instead of leaving the model to guess
 * at it, and says up front that a human will be asked — the model should only
 * spend the request when the access is genuinely needed.
 */
export const SANDBOX_DENIAL_HINT = [
  'This command likely failed because the OS sandbox blocked it (writes are confined',
  'to the project folder, /tmp, and $TMPDIR; network access is blocked). If it truly',
  'needs that access, re-run the exact same command with dangerouslyDisableSandbox:',
  'true and explain why in `description` — the user will be asked to approve running',
  'it without the sandbox.'
].join('\n');

/**
 * Whether a failed command *looks* like it was blocked by the sandbox.
 *
 * Intentionally heuristic and intentionally conservative, as in Codex: a broken
 * `.zshrc` prints "permission denied" too, and a command can be denied without
 * saying anything at all. Nothing acts on this automatically — it only decides
 * whether the model is told that escalation exists, and escalation itself still
 * goes through the user.
 */
export function isLikelySandboxDenied(
  mechanism: SandboxMechanism,
  exitCode: number | null,
  stdout: string,
  stderr: string
): boolean {
  if (mechanism === 'none' || exitCode === 0 || exitCode === null) {
    return false;
  }

  const haystack = `${stdout}\n${stderr}`.toLowerCase();
  return SANDBOX_DENIED_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

/**
 * Whether the *wrapper* failed before the command ever ran.
 *
 * `sandbox-exec` exits 65 (EX_DATAERR) after printing `sandbox-exec: …` when a
 * profile does not compile; `bwrap` prints `bwrap: …` when it cannot set up the
 * namespace, which happens on hosts where unprivileged user namespaces are
 * disabled even though the binary is installed. Neither is a fact about the
 * command, so neither may be reported as one.
 */
export function isSandboxWrapperFailure(
  mechanism: SandboxMechanism,
  exitCode: number | null,
  stderr: string
): boolean {
  const firstLine = stderr.split('\n', 1)[0]?.trim() ?? '';

  if (mechanism === 'seatbelt') {
    return exitCode === 65 && firstLine.startsWith('sandbox-exec:');
  }

  if (mechanism === 'bubblewrap') {
    return exitCode !== 0 && firstLine.startsWith('bwrap:');
  }

  return false;
}
