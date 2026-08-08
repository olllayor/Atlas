/** Which OS mechanism actually wrapped the command. Reported in every bash tool result. */
export type SandboxMechanism = 'seatbelt' | 'bubblewrap' | 'none';

export type WritableRoot = {
  /** Absolute, canonicalized (realpath) directory. */
  root: string;
  /**
   * Absolute paths under `root` that stay read-only (top-level .git/.atlas/…).
   * Both the literal path and its subtree are denied, so `mkdir .git` is
   * blocked even when the directory does not exist yet.
   */
  readOnlySubpaths: string[];
};

export type SandboxFsPolicy =
  | { kind: 'read-only' }
  | { kind: 'workspace-write'; writableRoots: WritableRoot[] }
  | { kind: 'danger-full-access' };

export type SandboxNetworkPolicy = 'deny' | 'allow';

export type SandboxPolicy = { fs: SandboxFsPolicy; network: SandboxNetworkPolicy };

/** A fully-resolved child process invocation. `command` is the executable. */
export type SandboxLaunch = {
  command: string;
  args: string[];
  /** Extra env the sandbox layer injects (e.g. ATLAS_SANDBOX, ATLAS_SANDBOX_NETWORK_DISABLED). */
  env: Record<string, string>;
  mechanism: SandboxMechanism;
};

export type BashToolResult = {
  stdout: string;
  stderr: string;
  interrupted: boolean;
  sandbox: SandboxMechanism;
  sandboxNetwork: SandboxNetworkPolicy;
  sandboxEscalated: boolean;
  backgroundTaskId?: string;
  noOutputExpected?: boolean;
  outputTruncated?: true;
  sandboxDenied?: true;
  sandboxDenialHint?: string;
  sandboxFailed?: true;
  returnCodeInterpretation: 'success' | 'timed_out' | 'backgrounded' | 'sandbox_failed' | `exit_code_${number | 'unknown'}`;
};
