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
 * Compute the explicit `env` for spawning:
 *
 * - Caller explicitly passed `OPENCODE_CONFIG_CONTENT: ''` ⇒ treat as
 *   "force-clear" (user intent to run config-less); we return the merged env
 *   WITHOUT the key rather than writing an empty value (the t3 bug shape).
 * - No key anywhere ⇒ return undefined so the child inherits our environment
 *   naturally (user's config wins).
 * - Key present with a value ⇒ pass a full merged copy, caller overrides applied.
 */
export function resolveOpenCodeSpawnEnvironment(
  overrides: NodeJS.ProcessEnv | undefined,
  inherited: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv | undefined {
  const merged = { ...inherited, ...overrides };

  if (overrides && 'OPENCODE_CONFIG_CONTENT' in overrides && overrides.OPENCODE_CONFIG_CONTENT === '') {
    delete merged.OPENCODE_CONFIG_CONTENT;
    return merged;
  }

  const configContent = merged.OPENCODE_CONFIG_CONTENT;
  if (configContent === undefined || configContent === '') {
    return undefined;
  }
  return merged;
}
