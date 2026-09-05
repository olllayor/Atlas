import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import type { ToolPermissionMode } from '../../../../shared/chatParameters';
import type { ToolWorkspace } from '../toolWorkspace';
import { buildBubblewrapLaunch } from './bubblewrap';
import { computeWritableRoots } from './policy';
import { buildSeatbeltLaunch, SEATBELT_EXECUTABLE } from './seatbelt';
import type { SandboxLaunch, SandboxMechanism, SandboxNetworkPolicy, SandboxPolicy } from './types';

let mechanismProbe: Promise<SandboxMechanism> | null = null;

const BUBBLEWRAP_PROBE_TIMEOUT_MS = 2_000;

function probeBubblewrap() {
  return new Promise<SandboxMechanism>((resolvePromise) => {
    let settled = false;
    const settle = (mechanism: SandboxMechanism) => {
      if (!settled) {
        settled = true;
        resolvePromise(mechanism);
      }
    };

    try {
      const child = spawn('bwrap', ['--version'], { stdio: 'ignore' });
      const timeoutId = setTimeout(() => {
        child.kill('SIGKILL');
        settle('none');
      }, BUBBLEWRAP_PROBE_TIMEOUT_MS);

      child.on('error', () => {
        clearTimeout(timeoutId);
        settle('none');
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        settle(code === 0 ? 'bubblewrap' : 'none');
      });
    } catch {
      settle('none');
    }
  });
}

/**
 * Which sandbox this host can actually enforce.
 *
 * Cached because it is asked once per shell command and the answer cannot
 * change while the app runs. "Unsupported" is a value rather than an error:
 * a host with no mechanism still runs commands, it just reports `none` so the
 * transcript never implies a boundary that is not there.
 */
export function detectSandboxMechanism(): Promise<SandboxMechanism> {
  if (!mechanismProbe) {
    if (process.platform === 'darwin') {
      mechanismProbe = Promise.resolve(existsSync(SEATBELT_EXECUTABLE) ? 'seatbelt' : 'none');
    } else if (process.platform === 'linux') {
      mechanismProbe = probeBubblewrap();
    } else {
      mechanismProbe = Promise.resolve('none');
    }
  }

  return mechanismProbe;
}

/**
 * Records that the mechanism this host advertised does not work.
 *
 * bubblewrap can be installed and still fail to start (unprivileged user
 * namespaces disabled by the distro), and that only shows up on a real launch.
 * Downgrading the cache stops every later command from paying for the same
 * failure — the command that discovered it is still reported as failed rather
 * than silently retried unsandboxed.
 */
export function markSandboxMechanismUnavailable() {
  mechanismProbe = Promise.resolve('none');
}

/**
 * The sandbox policy for a turn, derived from the workspace and permission mode.
 *
 * `full-access` now enables network access in addition to bypassing the approval
 * ladder. This allows commands like `npx postplan upload` to work in full-access
 * mode without requiring `dangerouslyDisableSandbox`. The filesystem sandbox
 * (write confinement) still applies — only the network restriction is lifted.
 *
 * `read-only` never gets here at all, because bash is withheld from that tool set
 * entirely.
 */
export function deriveSandboxPolicy(
  workspace: ToolWorkspace | undefined,
  permissionMode?: ToolPermissionMode
): SandboxPolicy {
  // Full-access mode enables network access while keeping filesystem sandbox intact
  const network: SandboxNetworkPolicy = permissionMode === 'full-access' ? 'allow' : 'deny';

  if (workspace?.mode === 'code' && workspace.root) {
    return {
      fs: { kind: 'workspace-write', writableRoots: computeWritableRoots(workspace.root) },
      network
    };
  }

  return { fs: { kind: 'read-only' }, network };
}

/**
 * Wraps an already argv-split command in the platform's sandbox.
 *
 * Returns the command unwrapped, with mechanism `none`, when the policy is
 * `danger-full-access` or the host has no mechanism. It never throws for an
 * unsupported platform; the only throw is a path that cannot be represented as
 * a Seatbelt parameter, which would otherwise mean granting the wrong path.
 */
export function buildSandboxedLaunch(
  argv: string[],
  policy: SandboxPolicy,
  mechanism: SandboxMechanism
): SandboxLaunch {
  const [command, ...args] = argv;

  if (!command) {
    throw new Error('Expected a command to sandbox.');
  }

  if (policy.fs.kind === 'danger-full-access' || mechanism === 'none') {
    return { command, args, env: {}, mechanism: 'none' };
  }

  if (mechanism === 'seatbelt') {
    return buildSeatbeltLaunch(argv, policy);
  }

  return buildBubblewrapLaunch(argv, policy);
}

export { buildSandboxCacheEnv, getSandboxCacheDir } from './cache';
export { getSandboxDenialHint, isLikelySandboxDenied, isSandboxWrapperFailure, SANDBOX_DENIAL_HINT } from './denial';
export { computeWritableRoots } from './policy';
export * from './types';

