import type { SandboxMechanism, SandboxNetworkPolicy } from './types';

/**
 * Phrases a command emits when the kernel refused a filesystem write or privilege.
 */
const SANDBOX_FS_DENIED_KEYWORDS = [
  'operation not permitted',
  'permission denied',
  'read-only file system',
  'seccomp',
  'sandbox',
  'landlock',
  'failed to write file'
] as const;

/**
 * Phrases a command emits when network access is refused or unrouted.
 *
 * Atlas additions for bubblewrap's `--unshare-net` (or seatbelt without network-outbound),
 * which leaves the process with no route rather than no permission, so a blocked
 * fetch reports a network error and never says "denied".
 */
const SANDBOX_NETWORK_DENIED_KEYWORDS = [
  'network is unreachable',
  'could not resolve host',
  'temporary failure in name resolution'
] as const;

const SANDBOX_DENIED_KEYWORDS = [
  ...SANDBOX_FS_DENIED_KEYWORDS,
  ...SANDBOX_NETWORK_DENIED_KEYWORDS
] as const;

/**
 * What the model is told when a command looks sandbox-denied with network blocked.
 */
export const SANDBOX_DENIAL_HINT = [
  'This command likely failed because the OS sandbox blocked it (writes are confined',
  'to the project folder, /tmp, and $TMPDIR; network access is blocked). If it truly',
  'needs that access, re-run the exact same command with dangerouslyDisableSandbox:',
  'true and explain why in `description` — the user will be asked to approve running',
  'it without the sandbox.'
].join('\n');

/**
 * What the model is told when a command looks sandbox-denied but network is already allowed.
 */
export const SANDBOX_DENIAL_HINT_NETWORK_ALLOWED = [
  'This command likely failed because the OS sandbox blocked it (writes are confined',
  'to the project folder, /tmp, and $TMPDIR). If it truly needs that access, re-run',
  'the exact same command with dangerouslyDisableSandbox: true and explain why in',
  '`description` — the user will be asked to approve running it without the sandbox.'
].join('\n');

export function getSandboxDenialHint(networkPolicy: SandboxNetworkPolicy = 'deny'): string {
  return networkPolicy === 'allow' ? SANDBOX_DENIAL_HINT_NETWORK_ALLOWED : SANDBOX_DENIAL_HINT;
}

/**
 * Whether a failed command *looks* like it was blocked by the sandbox.
 *
 * When network is allowed, network errors (such as unresolved hosts) are not
 * considered sandbox denials.
 */
export function isLikelySandboxDenied(
  mechanism: SandboxMechanism,
  exitCode: number | null,
  stdout: string,
  stderr: string,
  networkPolicy: SandboxNetworkPolicy = 'deny'
): boolean {
  if (mechanism === 'none' || exitCode === 0 || exitCode === null) {
    return false;
  }

  const haystack = `${stdout}\n${stderr}`.toLowerCase();
  if (SANDBOX_FS_DENIED_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return true;
  }

  if (networkPolicy === 'deny') {
    return SANDBOX_NETWORK_DENIED_KEYWORDS.some((keyword) => haystack.includes(keyword));
  }

  return false;
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
