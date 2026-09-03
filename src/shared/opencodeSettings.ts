import type { z } from 'zod';

import type { OpenCodeSettingsSchema } from './opencodeSettingsSchema';

/**
 * Settings for the deep OpenCode integration (providerId `"opencode"`).
 *
 * Modeled on t3code's `OpenCodeSettings`
 * (pingdotgg/t3code `packages/contracts/src/settings.ts`), simplified for
 * Atlas' single-instance world and hardened for Atlas' conventions:
 *
 * - The **server password never lives in this schema** — it goes to the OS
 *   keychain under the `opencode-server-password` account
 *   (`src/main/secrets/keychain.ts`). t3code stores it plaintext; we don't.
 * - Empty string always means "auto" (t3code parity):
 *   - `binaryPath: ''` resolves the `opencode` binary from PATH;
 *   - `serverUrl: ''` makes Atlas spawn a scoped `opencode serve` child
 *     instead of talking to a user-managed server.
 * - `enabled` defaults to **false**: the binding stays dormant until the user
 *   opts in from Settings (mirrors t3code's opt-in gating rationale).
 */

/** Provider id used everywhere (registry keys, models rows, keychain account prefix). */
export const OPENCODE_PROVIDER_ID = 'opencode';

/**
 * How Atlas talks to OpenCode. Both options are surfaced to the user in
 * Settings behind the same Beta toggle (plan decision D7):
 *
 * - `'server'` — deep SDK/server integration (default): Atlas spawns or
 *   connects to `opencode serve`, drives sessions over the official
 *   `@opencode-ai/sdk` HTTP surface. Pre-connect inventory, BYO remote server.
 * - `'acp'`    — Agent Client Protocol: Atlas launches `opencode acp`
 *   (JSON-RPC over stdio). Same runtime an ACP-registry ecosystem would drive;
 *   opens the door to other registry agents reusing one client stack.
 */
export const OPENCODE_INTEGRATION_MODES = ['server', 'acp'] as const;
export type OpenCodeIntegrationMode = (typeof OPENCODE_INTEGRATION_MODES)[number];

export function isOpenCodeIntegrationMode(value: unknown): value is OpenCodeIntegrationMode {
  return (
    typeof value === 'string' &&
    (OPENCODE_INTEGRATION_MODES as readonly string[]).includes(value)
  );
}

export type OpenCodeSettings = z.output<typeof OpenCodeSettingsSchema>;

export type ParseOpenCodeSettingsResult =
  | { ok: true; settings: OpenCodeSettings }
  | { ok: false; error: string };

/** `'external'` = talk to a user-managed server; `'spawned'` = own lifecycle. */
export type OpenCodeServerMode = 'external' | 'spawned';

export function openCodeServerMode(settings: Pick<OpenCodeSettings, 'serverUrl'>): OpenCodeServerMode {
  return settings.serverUrl.trim().length > 0 ? 'external' : 'spawned';
}

/**
 * What "Test connection" answers, shaped exactly like t3code's probe result so
 * the Settings card can render every state without extra round trips. Declared
 * in shared because both the main-process probe and the renderer read it.
 */
export type OpenCodeProbeStatus = 'ready' | 'warning' | 'error';

export interface OpenCodeProbeResult {
  readonly installed: boolean;
  readonly version: string | null;
  readonly status: OpenCodeProbeStatus;
  readonly auth: { readonly status: 'authenticated' | 'unknown' };
  readonly connectedProviders: readonly string[];
  readonly modelCount: number;
  readonly baseUrlUsed?: string;
  readonly message?: string;
}

/** Derived view exposed over IPC/UI so the renderer learns password *presence* only. */
export interface OpenCodeStatusView extends OpenCodeSettings {
  hasServerPassword: boolean;
}
