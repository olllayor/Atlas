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
 *
 * One transport, like t3code: Atlas drives `opencode serve` over the official
 * SDK. The ACP client stack serves the other local agents, which have no
 * server to connect to.
 */

/** Provider id used everywhere (registry keys, models rows, keychain account prefix). */
export const OPENCODE_PROVIDER_ID = 'opencode';

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
