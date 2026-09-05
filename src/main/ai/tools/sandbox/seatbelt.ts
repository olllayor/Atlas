import { buildSandboxCacheEnv } from './cache';
import type { SandboxLaunch, SandboxPolicy, WritableRoot } from './types';


/** Hardcoded, never resolved through PATH: the sandbox must not be selectable by the command it confines. */
export const SEATBELT_EXECUTABLE = '/usr/bin/sandbox-exec';

/**
 * The base Seatbelt profile, modeled on OpenAI Codex's `seatbelt_base_policy.sbpl`
 * (itself modeled on Chrome's renderer profile).
 *
 * It lives in a template literal rather than a `.sbpl` asset so the Electron
 * packager never has to be taught about it — a profile missing from a packaged
 * build would fail open at exactly the moment confinement matters.
 */
export const SEATBELT_BASE_POLICY = `(version 1)
(deny default)

; Child processes inherit the sandbox.
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))

; Discarding output must always work.
(allow file-write-data
  (require-all
    (path "/dev/null")
    (vnode-type CHARACTER-DEVICE)))

; Reads are unrestricted in every Atlas policy, matching toolWorkspace.ts:
; "Reads are unrestricted (as in Codex); only writes are confined".
(allow file-read*)

; Hardware and kernel info; node, python and jvm all probe these at startup.
; Codex allowlists ~50 individual sysctl names, which is equivalent here
; because reads are already unrestricted.
(allow sysctl-read)

; user/group lookups (getpwuid) go through opendirectoryd.
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo"))

; POSIX semaphores and shared memory, for python multiprocessing and libomp.
(allow ipc-posix-sem)
(allow ipc-posix-shm-read-data ipc-posix-shm-write-create ipc-posix-shm-write-unlink
  (ipc-posix-name-regex #"^/__KMP_REGISTERED_LIB_[0-9]+$"))

; openpty()/script/expect-style tools.
(allow pseudo-tty)
(allow file-read* file-write* file-ioctl (literal "/dev/ptmx"))
(allow file-ioctl (regex #"^/dev/ttys[0-9]+"))

; Read-only user preferences, read during CoreFoundation initialization.
(allow ipc-posix-shm-read* (ipc-posix-name-prefix "apple.cfprefs."))
(allow mach-lookup
  (global-name "com.apple.cfprefsd.daemon")
  (global-name "com.apple.cfprefsd.agent")
  (local-name "com.apple.cfprefsd.agent"))
(allow user-preference-read)
`;

/**
 * Appended only when the network is granted.
 *
 * Denial is structural: `(deny default)` with no network rule already blocks
 * every socket, so there is nothing to switch off — only something to add.
 */
export const SEATBELT_NETWORK_POLICY = `(allow network-outbound)
(allow network-inbound)
(allow system-socket
  (require-all (socket-domain AF_SYSTEM) (socket-protocol 2)))
(allow mach-lookup
  (global-name "com.apple.bsd.dirhelper")
  (global-name "com.apple.system.opendirectoryd.membership")
  (global-name "com.apple.SecurityServer")
  (global-name "com.apple.networkd")
  (global-name "com.apple.ocspd")
  (global-name "com.apple.trustd.agent")
  (global-name "com.apple.SystemConfiguration.DNSConfiguration")
  (global-name "com.apple.SystemConfiguration.configd"))
(allow sysctl-read (sysctl-name-regex #"^net.routetable"))
`;

/**
 * A path that cannot be carried in a `-D` argument.
 *
 * `sandbox-exec` reads `-DKEY=value` as a single argv element and splits at the
 * first `=`, so a newline in the value has no representation. Refusing is the
 * only safe answer: truncating would silently grant a *different*, shorter path.
 */
function assertRepresentableParam(value: string) {
  if (value.includes('\n')) {
    throw new Error(`Sandbox path cannot contain a newline: ${JSON.stringify(value)}`);
  }
}

/**
 * The write section of the profile, plus the `-D` parameters it refers to.
 *
 * No filesystem path is ever spliced into the profile text. Paths travel as
 * opaque `-D` values and are substituted at policy-evaluation time, which
 * removes the entire class of SBPL quoting bugs — there is no escaping to get
 * wrong because there is no text interpolation. Parameter keys are generated
 * here and never derived from user input.
 */
export function buildSeatbeltWritePolicy(roots: WritableRoot[]): {
  policyText: string;
  params: Array<[key: string, value: string]>;
} {
  const params: Array<[string, string]> = [];
  const components: string[] = [];

  roots.forEach((root, rootIndex) => {
    const rootKey = `WRITABLE_ROOT_${rootIndex}`;
    assertRepresentableParam(root.root);
    params.push([rootKey, root.root]);

    if (root.readOnlySubpaths.length === 0) {
      components.push(`(subpath (param "${rootKey}"))`);
      return;
    }

    const parts = [`(subpath (param "${rootKey}"))`];

    root.readOnlySubpaths.forEach((subpath, subpathIndex) => {
      const subpathKey = `${rootKey}_RO_${subpathIndex}`;
      assertRepresentableParam(subpath);
      params.push([subpathKey, subpath]);
      // Both forms, as in Codex. On macOS 26 `subpath` already covers the node
      // itself, so `mkdir .git` is refused without the `literal` rule — but
      // whether a subpath matches its own root is not documented behaviour, and
      // the version where it stops holding is the version where a protected
      // directory becomes creatable from nothing.
      parts.push(`(require-not (literal (param "${subpathKey}")))`);
      parts.push(`(require-not (subpath (param "${subpathKey}")))`);
    });

    components.push(`(require-all ${parts.join(' ')} )`);
  });

  return {
    policyText: components.length > 0 ? `(allow file-write*\n${components.join('\n')}\n)` : '',
    params
  };
}

/**
 * Wraps an already argv-split command in `sandbox-exec`.
 *
 * The profile goes in as `-p <text>` rather than `-f <file>`: Node's `spawn`
 * passes each argv element through verbatim with no shell interpretation, so a
 * multi-line profile needs no quoting, and there is no temporary file to secure,
 * race against, or clean up.
 */
export function buildSeatbeltLaunch(argv: string[], policy: SandboxPolicy): SandboxLaunch {
  const roots = policy.fs.kind === 'workspace-write' ? policy.fs.writableRoots : [];
  const { policyText, params } = buildSeatbeltWritePolicy(roots);
  const fullPolicy = [
    SEATBELT_BASE_POLICY,
    policyText,
    policy.network === 'allow' ? SEATBELT_NETWORK_POLICY : ''
  ]
    .filter(Boolean)
    .join('\n');

  const cacheEnv = policy.fs.kind === 'workspace-write' ? buildSandboxCacheEnv() : {};

  return {
    command: SEATBELT_EXECUTABLE,
    args: ['-p', fullPolicy, ...params.map(([key, value]) => `-D${key}=${value}`), '--', ...argv],
    env: {
      ATLAS_SANDBOX: 'seatbelt',
      ...cacheEnv,
      ...(policy.network === 'deny' ? { ATLAS_SANDBOX_NETWORK_DISABLED: '1' } : {})
    },
    mechanism: 'seatbelt'
  };
}
