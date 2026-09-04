/**
 * Environment + port helpers for the OpenCode runtime.
 *
 * The env rule reproduces t3code's hard-won fix
 * (pingdotgg/t3code `opencodeRuntime.ts` L520-528): never force
 * `OPENCODE_CONFIG_CONTENT` to `'{}'` — the child must inherit our environment
 * untouched so the user's own opencode config (providers, models, auth)
 * loads normally.
 */

import * as net from 'node:net';

import { OPENCODE_DEFAULT_HOSTNAME } from './openCodeParsers.js';

/** Grab an ephemeral localhost port (bind :0 → read → close). */
export function findFreeLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, OPENCODE_DEFAULT_HOSTNAME, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => (port > 0 ? resolve(port) : reject(new Error('No free local port.'))));
    });
  });
}

/**
 * Is this localhost port still bindable?
 *
 * Used only after a spawn died on startup: the port we handed opencode was
 * free when we probed it and nothing held it until opencode bound it, so a
 * lost race is indistinguishable from a fatal config error by exit output
 * alone (the CLI just prints "ServeError"). Asking who owns the port now
 * settles it. Anything other than EADDRINUSE counts as free — an unclear
 * answer must not be read as "retry".
 */
export function isLocalPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code !== 'EADDRINUSE');
    });
    probe.listen(port, OPENCODE_DEFAULT_HOSTNAME, () => {
      probe.close(() => resolve(true));
    });
  });
}

/**
 * Compute the explicit `env` for spawning:
 *
 * - Caller explicitly passed `OPENCODE_CONFIG_CONTENT: ''` ⇒ treat as
 *   "force-clear" (user intent to run config-less); we return the merged env
 *   WITHOUT the key rather than writing an empty value (the t3 bug shape).
 * - No key anywhere and no password decision ⇒ return undefined so the child
 *   inherits our environment naturally (user's config wins).
 * - Key present with a value ⇒ pass a full merged copy, caller overrides applied.
 *
 * Password rule (Atlas keychain is source of truth):
 * - `serverPassword` value ⇒ set `OPENCODE_SERVER_PASSWORD` so the child
 *   demands exactly what our client will send.
 * - `serverPassword` null/'' ⇒ strip the key so a host-inherited password can
 *   never make our own spawned server 401 our own client.
 * - `serverPassword` undefined ⇒ legacy, touch nothing (tests callers).
 */
export function resolveOpenCodeSpawnEnvironment(
  overrides: NodeJS.ProcessEnv | undefined,
  inherited: NodeJS.ProcessEnv = process.env,
  serverPassword?: string | null
): NodeJS.ProcessEnv | undefined {
  const merged = { ...inherited, ...overrides };

  if (overrides && 'OPENCODE_CONFIG_CONTENT' in overrides && overrides.OPENCODE_CONFIG_CONTENT === '') {
    delete merged.OPENCODE_CONFIG_CONTENT;
    if (serverPassword === undefined) {
      return merged;
    }
  }

  if (serverPassword !== undefined) {
    const trimmed = serverPassword?.trim() ?? '';
    if (trimmed.length > 0) {
      merged.OPENCODE_SERVER_PASSWORD = trimmed;
    } else {
      delete merged.OPENCODE_SERVER_PASSWORD;
    }
    return merged;
  }

  const configContent = merged.OPENCODE_CONFIG_CONTENT;
  if (configContent === undefined || configContent === '') {
    return undefined;
  }
  return merged;
}
