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
import { OPENCODE_PROVIDER_ID } from '../../../../shared/opencodeSettings.js';
import {
  defaultOpenCodeSettings,
  parseOpenCodeSettings
} from '../../../../shared/opencodeSettingsSchema.js';
import type { OpenCodeSessionsRepo } from '../../../db/repositories/opencodeSessionsRepo.js';
import type { SettingsRepo } from '../../../db/repositories/settingsRepo.js';
import type { KeychainStore } from '../../../secrets/keychain.js';
import { OPENCODE_SERVER_PASSWORD_ACCOUNT } from '../../../secrets/keychain.js';
import type { ProviderRegistry } from '../../core/providerRegistry.js';
import { OpenCodeAgentAdapter } from './OpenCodeAgentAdapter.js';
import { OpenCodeAcpAdapter, probeOpenCodeAcp } from './OpenCodeAcpAdapter.js';
import { AcpClient } from '../../acp/acpClient.js';
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
  /** Seam for tests: build ACP clients that never spawn a real process. */
  readonly createAcpClient?: (directory: string, options: { onExit: () => void }) => AcpClient;
}

export class OpenCodeController {
  private runtime: OpenCodeRuntime | null = null;
  private adapter: OpenCodeAgentAdapter | null = null;
  private acpAdapter: OpenCodeAcpAdapter | null = null;
  private acpClients = new Map<string, { client: AcpClient; idleTimer: NodeJS.Timeout | null }>();
  private acpBinaryPath: string | null = null;
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
   * Register or unregister the adapter to match `enabled`, using the SDK or
   * ACP adapter per `integrationMode`. Idempotent, so it can be called on
   * boot and after every settings write. A mode switch swaps the registry
   * entry; the idle runtime is left alone until its own shutdown.
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

    const wanted = settings.integrationMode === 'acp' ? this.getAcpAdapter() : this.getAdapter();
    if (registered !== wanted) {
      this.deps.registry.set(OPENCODE_PROVIDER_ID, wanted);
      await this.deps.onRegistryChanged?.();
    }
  }

  /** Settings' "Test connection": the probe matching the active mode. */
  async probe(): Promise<OpenCodeProbeResult> {
    const settings = this.getSettings();
    if (settings.integrationMode === 'acp') {
      return probeOpenCodeAcp({ settings, directory: this.directory() });
    }
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
            const connection = await this.getRuntime().connect({ settings, serverPassword });
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
    this.acpAdapter = null;
    const acpEntries = [...this.acpClients.values()];
    this.acpClients.clear();
    this.acpBinaryPath = null;
    for (const entry of acpEntries) {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
      }
    }
    await runtime?.shutdown();
    await Promise.all(
      acpEntries.map((entry) => entry.client.shutdown().catch(() => undefined))
    );
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
      connect: (settings, serverPassword) => this.getRuntime().connect({ settings, serverPassword }),
      createClient: createOpenCodeAgentClient,
      sessions: this.deps.sessions,
      defaultDirectory: () => this.directory()
    });
    return this.adapter;
  }

  private getAcpAdapter(): OpenCodeAcpAdapter {
    this.acpAdapter ??= new OpenCodeAcpAdapter({
      readSettings: () => this.getSettings(),
      getClient: (directory) => this.getAcpClient(directory),
      sessions: this.deps.sessions,
      defaultDirectory: () => this.directory()
    });
    return this.acpAdapter;
  }

  /**
   * One ACP process per directory, reused across turns. A binary-path change
   * retires every client so the next turn spawns from the new location. A
   * dead child evicts its client on exit, so one crash never poisons the
   * directory until restart. Idle clients reap after 30s without use, deferred
   * while a turn is in flight — the owned-server rhythm in miniature.
   */
  private getAcpClient(directory: string): AcpClient {
    const binaryPath = this.getSettings().binaryPath.trim();
    if (this.acpBinaryPath !== null && this.acpBinaryPath !== binaryPath) {
      const stale = [...this.acpClients.values()];
      this.acpClients.clear();
      for (const entry of stale) {
        if (entry.idleTimer) {
          clearTimeout(entry.idleTimer);
        }
      }
      void Promise.all(stale.map((entry) => entry.client.shutdown().catch(() => undefined)));
    }
    this.acpBinaryPath = binaryPath;
    let entry = this.acpClients.get(directory);
    if (!entry) {
      const onExit = () => {
        const current = this.acpClients.get(directory);
        if (current?.client === fresh.client) {
          if (current.idleTimer) {
            clearTimeout(current.idleTimer);
          }
          this.acpClients.delete(directory);
        }
      };
      const fresh: { client: AcpClient; idleTimer: NodeJS.Timeout | null } = {
        client:
          this.deps.createAcpClient?.(directory, { onExit }) ??
          new AcpClient({
            cwd: directory,
            binaryPath: binaryPath || undefined,
            onExit
          }),
        idleTimer: null
      };
      this.acpClients.set(directory, fresh);
      entry = fresh;
    }
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    const idleTimer = setTimeout(() => {
      const current = this.acpClients.get(directory);
      if (!current || current.client !== entry.client) {
        return;
      }
      if (typeof current.client.hasInflight === 'function' && current.client.hasInflight()) {
        // Turn still running: rearm instead of killing mid-turn.
        current.idleTimer = setTimeout(() => this.reapAcpClient(directory, entry.client), 30_000);
        current.idleTimer.unref?.();
        return;
      }
      void this.reapAcpClient(directory, entry.client);
    }, 30_000);
    idleTimer.unref?.();
    entry.idleTimer = idleTimer;
    return entry.client;
  }

  private async reapAcpClient(directory: string, client: AcpClient): Promise<void> {
    const current = this.acpClients.get(directory);
    if (!current || current.client !== client) {
      return;
    }
    this.acpClients.delete(directory);
    await client.shutdown().catch(() => undefined);
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
