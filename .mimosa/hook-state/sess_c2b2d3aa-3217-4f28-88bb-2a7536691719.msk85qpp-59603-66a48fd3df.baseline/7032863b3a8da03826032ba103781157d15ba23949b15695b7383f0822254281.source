import { existsSync } from 'node:fs';

import type { SandboxLaunch, SandboxPolicy } from './types';

export const BUBBLEWRAP_EXECUTABLE = 'bwrap';

/**
 * Wraps an already argv-split command in bubblewrap.
 *
 * The whole filesystem is bound read-only and the writable roots are re-bound
 * on top, because bubblewrap resolves mounts in argument order and a later
 * mount shadows an earlier one. Codex has since moved to bubblewrap as well;
 * its earlier Landlock+seccomp path needs a helper binary that re-execs itself,
 * which is not reproducible from Node.
 *
 * One gap against Seatbelt, and it is not closeable here: a protected directory
 * that does not exist yet cannot be read-only bound, so `mkdir .git` is not
 * kernel-blocked on Linux. `resolveWritablePath` still refuses it for the file
 * tools, which is exactly the pre-sandbox status quo for bash.
 */
export function buildBubblewrapLaunch(argv: string[], policy: SandboxPolicy): SandboxLaunch {
  const args: string[] = [
    '--die-with-parent',
    '--ro-bind',
    '/',
    '/',
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    '--tmpfs',
    '/run'
  ];

  if (policy.fs.kind === 'workspace-write') {
    for (const root of policy.fs.writableRoots) {
      args.push('--bind', root.root, root.root);

      for (const subpath of root.readOnlySubpaths) {
        if (existsSync(subpath)) {
          args.push('--ro-bind', subpath, subpath);
        }
      }
    }
  }

  if (policy.network === 'deny') {
    args.push('--unshare-net');
  }

  args.push('--', ...argv);

  return {
    command: BUBBLEWRAP_EXECUTABLE,
    args,
    env: {
      ATLAS_SANDBOX: 'bubblewrap',
      ...(policy.network === 'deny' ? { ATLAS_SANDBOX_NETWORK_DISABLED: '1' } : {})
    },
    mechanism: 'bubblewrap'
  };
}
