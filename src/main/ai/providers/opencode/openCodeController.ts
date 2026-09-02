/**
 * Owns the OpenCode integration's lifecycle: settings in, adapter registered,
 * server torn down on quit.
 *
 * The gating rule is t3code's, verbatim in spirit: while the feature is
 * disabled the adapter is absent from the registry and *nothing probes* — no
 * spawn, no HTTP, no cost. Enabling constructs the runtime lazily, on the
 * first thing that actually needs a server (plan T7, D6).
 */

import type { OpenCodeSettings, OpenCodeStatusView } from '../../../../shared/opencodeSettings.js';
import {
  OPENCODE_PROVIDER_ID,
  defaultOpenCodeSettings,
  parseOpenCodeSettings
} from '../../../../shared/opencodeSettings.js';
import type { OpenCodeSessionsRepo } from '../../../db/repositories/opencodeSessionsRepo.js';
import type { SettingsRepo } from '../../../db/repositories/settingsRepo.js';
import type { KeychainStore } from '../../../secrets/keychain.js';
import { OPENCODE_SERVER_PASSWORD_ACCOUNT } from '../../../secrets/keychain.js';
import type { ProviderRegistry } from '../../core/providerRegistry.js';
import { OpenCodeAgentAdapter } from './OpenCodeAgentAdapter.js';
import { createOpenCodeAgentClient } from './OpenCodeAgentClient.js';
import { OpenCodeRuntime } from './OpenCodeRuntime.js';
import { reapOrphanedOpenCodeServers } from './orphanReaper.js';
import { probeOpenCode, type OpenCodeProbeResult } from './probeOpenCode.js';

export interface OpenCodeControllerDeps {
  readonly settingsRepo: Pick<SettingsRepo, 'getOpenCodeSettings' | 'setOpenCodeSettings'>;
  readonly keychain: Pick<KeychainStore, 'getSecretByAccount' | 'setSecretByAccount' | 'deleteSecretByAccount'>;
  readonly sessions: OpenCodeSessionsRepo;
  readonly registry: ProviderRegistry;
  /** Directory used for turns and probes that carry no project. */
  readonly defaultDirectory?: () => string;
  /** Called after the registry changes so the catalog can be rebuilt. */
  readonly onRegistryChanged?: () => void | Promise<void>;
  /** Surfaces a server crash to the user; wired to the notice plumbing. */
  readonly onServerExited?: () => void;
  /** Seam for tests: build a runtime that never spawns a real process. */
  readonly createRuntime?: () => OpenCodeRuntime;
}

export class OpenCodeController {
  private runtime: OpenCodeRuntime | null = null;
  private adapter: OpenCodeAgentAdapter | null = null;
  /** Last parse failure already logged; keeps a per-call read from spamming. */
  private lastSettingsParseError: string | null = null;

  constructor(private readonly deps: OpenCodeControllerDeps) {}

  /**
   * Persisted settings, falling back to defaults when the blob is unreadable.
   * The fallback is silent on screen — every field reverts at once — so it is
   * at least said out loud in the log, once per reason.
   */
  getSettings(): OpenCodeSettings {
    const parsed = this.deps.settingsRepo.getOpenCodeSettings();
    if (parsed.ok) {
      return parsed.settings;
    }
    if (this.lastSettingsParseError !== parsed.error) {
      this.lastSettingsParseError = parsed.error;
      console.warn(
        `[opencode] stored settings are unreadable (${parsed.error}); using defaults until they are saved again.`
      );
    }
    return defaultOpenCodeSettings();
  }

  /** Settings plus the one derived fact the renderer may know about secrets. */
  async getStatusView(): Promise<OpenCodeStatusView> {
    const settings = this.getSettings();
    return { ...settings, hasServerPassword: (await this.readServerPassword()) !== null };
  }

  /**
   * Apply a settings patch, persist it, and bring the registry in line.
   * Rejects an invalid patch rather than half-applying it.
   */
  async updateSettings(patch: Partial<OpenCodeSettings>): Promise<OpenCodeStatusView> {
    const parsed = parseOpenCodeSettings({ ...this.getSettings(), ...patch });
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }

    this.deps.settingsRepo.setOpenCodeSettings(parsed.settings);
    await this.syncRegistry();
    return this.getStatusView();
  }

  async setServerPassword(secret: string | null): Promise<void> {
    const trimmed = secret?.trim() ?? '';
    if (trimmed.length === 0) {
      await this.deps.keychain.deleteSecretByAccount(OPENCODE_SERVER_PASSWORD_ACCOUNT);
      return;
    }
    await this.deps.keychain.setSecretByAccount(OPENCODE_SERVER_PASSWORD_ACCOUNT, trimmed);
  }

  /**
   * Register or unregister the adapter to match `enabled`. Idempotent, so it
   * can be called on boot and after every settings write.
   */
  async syncRegistry(): Promise<void> {
    const settings = this.getSettings();
    const registered = this.deps.registry.get(OPENCODE_PROVIDER_ID);

    if (!settings.enabled) {
      if (registered) {
        this.deps.registry.delete(OPENCODE_PROVIDER_ID);
        await this.shutdown();
        await this.deps.onRegistryChanged?.();
      }
      return;
    }

    if (!registered) {
      this.deps.registry.set(OPENCODE_PROVIDER_ID, this.getAdapter());
      await this.deps.onRegistryChanged?.();
    }
  }

  /** Settings' "Test connection": the probe from T3, wired to live deps. */
  async probe(): Promise<OpenCodeProbeResult> {
    const settings = this.getSettings();
    const serverPassword = await this.readServerPassword();
    // A probe is a consumer like any turn: without returning its lease, ten
    // presses of "Test connection" pinned the server past every idle reap.
    let lease: { release: () => void } | null = null;

    try {
      return await probeOpenCode({
        settings,
        directory: this.directory(),
        ...(serverPassword ? { serverPassword } : {}),
        deps: {
          connectOwnedServer: async () => {
            const connection = await this.getRuntime().connect({ settings });
            lease = connection;
            return { baseUrl: connection.baseUrl };
          }
        }
      });
    } finally {
      (lease as { release: () => void } | null)?.release();
    }
  }

  /** Kills any server Atlas owns. Safe to call when nothing was ever started. */
  async shutdown(): Promise<void> {
    const runtime = this.runtime;
    this.runtime = null;
    this.adapter = null;
    await runtime?.shutdown();
  }

  /** Forget a conversation's opencode session — used when the chat is deleted. */
  forgetConversation(conversationId: string): void {
    this.deps.sessions.clear(conversationId);
  }

  private directory(): string {
    return this.deps.defaultDirectory?.() ?? process.cwd();
  }

  private async readServerPassword(): Promise<string | null> {
    return this.deps.keychain.getSecretByAccount(OPENCODE_SERVER_PASSWORD_ACCOUNT);
  }

  private getRuntime(): OpenCodeRuntime {
    if (!this.runtime) {
      this.runtime = this.deps.createRuntime?.() ?? new OpenCodeRuntime();
      this.runtime.setUnexpectedExitHandler(() => this.deps.onServerExited?.());
    }
    return this.runtime;
  }

  private getAdapter(): OpenCodeAgentAdapter {
    this.adapter ??= new OpenCodeAgentAdapter({
      readSettings: () => this.getSettings(),
      readServerPassword: () => this.readServerPassword(),
      connect: (settings) => this.getRuntime().connect({ settings }),
      createClient: createOpenCodeAgentClient,
      sessions: this.deps.sessions,
      defaultDirectory: () => this.directory()
    });
    return this.adapter;
  }
}

/**
 * Boot-time wiring: register the adapter if the feature is already on. The
 * caller owns the quit hook (`controller.shutdown()`), which keeps this module
 * free of Electron so its tests run under plain `node --test`.
 */
/**
 * Build the controller and bring the registry in line with the stored settings.
 *
 * The registry sync deliberately does *not* block the caller. It was awaited
 * during boot, where it sat between the database opening and the first window
 * existing and cost about a second of a cold start — paid whether or not the
 * integration was ever switched on. Nothing in that first second can use the
 * adapter: the renderer has not loaded, so there is no turn to run and no model
 * picker to populate. When the sync does land, `onRegistryChanged` announces the
 * new catalog exactly as it does for a settings change, which is the same path a
 * user enabling OpenCode mid-session already takes.
 *
 * The returned promise is exposed for tests and for shutdown ordering; callers
 * that just want the controller can ignore it.
 */
export function initializeOpenCode(deps: OpenCodeControllerDeps): {
  controller: OpenCodeController;
  synced: Promise<void>;
} {
  void reapOrphanedOpenCodeServers();
  const controller = new OpenCodeController(deps);
  const synced = controller.syncRegistry().catch((error) => {
    console.warn('[opencode] initial registry sync failed:', error);
  });
  return { controller, synced };
}
