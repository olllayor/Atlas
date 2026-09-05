/**
 * Lifecycle and registry sync for the Local agents catalog.
 *
 * Each agent is driven by its declared transport:
 *
 * - `'acp'`  — starts an ACP client on stdio (reused per (agent, directory),
 *   reaped on idle, retired when its spawn arguments move).
 * - `'sdk'`  — driven directly via official SDK:
 *   - `claude-code`: driven by `ClaudeAgentAdapter` via `@anthropic-ai/claude-agent-sdk`.
 *   - `opencode`: bridged to `OpenCodeController`.
 * - `'none'` — detected and configurable, but refuses `enabled: true`.
 */

import type { ProviderId } from '../../../shared/contracts.js';
import {
  findLocalAgent,
  LOCAL_AGENTS,
  type LocalAgentDefinition,
  type LocalAgentId,
  type LocalAgentDetection,
  type LocalAgentProbeResult,
  type LocalAgentSettings,
  type LocalAgentStatusView,
  type LocalAgentUpdateRequest
} from '../../../shared/localAgents.js';
import {
  defaultLocalAgentSettings,
  parseLocalAgentSettings
} from '../../../shared/localAgentsSchema.js';
import type { SettingsRepo } from '../../db/repositories/settingsRepo.js';
import type { LocalAgentSessionsRepo } from '../../db/repositories/localAgentSessionsRepo.js';
import { AcpClient } from '../acp/acpClient.js';
import type { ProviderRegistry } from '../core/providerRegistry.js';
import { AcpAgentAdapter, acpSpawnEnv } from '../acp/AcpAgentAdapter.js';
import { splitLaunchArgs } from '../providers/opencode/openCodeParsers.js';
import type { OpenCodeController } from '../providers/opencode/openCodeController.js';
import { detectLocalAgent, type LocalAgentDetectionDeps } from './localAgentDetection.js';
import { ClaudeAgentAdapter } from '../providers/claude/ClaudeAgentAdapter.js';
import { probeClaude } from '../providers/claude/probeClaude.js';

const IDLE_SHUTDOWN_MS = 30_000;
/** Long enough to survive a burst of field saves, short enough to notice an install. */
const DETECTION_TTL_MS = 10_000;

export interface LocalAgentControllerDeps {
  readonly settingsRepo: Pick<SettingsRepo, 'getLocalAgentSettingsRecord' | 'setLocalAgentSettings'>;
  readonly sessions: LocalAgentSessionsRepo;
  readonly registry: ProviderRegistry;
  /** Bridges opencode, which keeps its own settings blob and lifecycle. */
  readonly opencode?: OpenCodeController;
  /** Directory used for turns and probes that carry no project. */
  readonly defaultDirectory?: () => string;
  /** Called after the registry changes so the catalog can be rebuilt. */
  readonly onRegistryChanged?: () => void | Promise<void>;
  /** Seams for tests: detection and clients that never touch the machine. */
  readonly detectionDeps?: LocalAgentDetectionDeps;
  readonly createAcpClient?: (
    agent: LocalAgentDefinition,
    directory: string,
    options: { onExit: () => void }
  ) => AcpClient;
}

interface PooledClient {
  client: AcpClient;
  idleTimer: NodeJS.Timeout | null;
}

interface AcpSpawnPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv | undefined;
  /** Stable cache key: when this changes, live children must be retired. */
  readonly key: string;
}

export class LocalAgentController {
  /** `${agentId} ${directory}` → client. */
  private readonly clients = new Map<string, PooledClient>();
  private readonly spawnKeys = new Map<LocalAgentId, string>();
  private readonly adapters = new Map<LocalAgentId, AcpAgentAdapter>();
  private readonly claudeAdapters = new Map<LocalAgentId, ClaudeAgentAdapter>();
  private readonly lastParseError = new Map<LocalAgentId, string>();
  private readonly detectionCache = new Map<string, { detection: LocalAgentDetection; at: number }>();

  constructor(private readonly deps: LocalAgentControllerDeps) {}

  /** Agents this controller owns: everything the opencode integration doesn't. */
  private ownedAgents(): LocalAgentDefinition[] {
    return LOCAL_AGENTS.filter((agent) => agent.settingsSource === 'localAgents');
  }

  private defaultDirectory(): string {
    return this.deps.defaultDirectory?.() ?? process.cwd();
  }

  /**
   * Persisted settings for one agent, falling back to defaults when the blob
   * is unreadable. The fallback is silent on screen — every field reverts at
   * once — so it is at least said out loud in the log, once per reason.
   */
  getSettings(agentId: LocalAgentId): LocalAgentSettings {
    const stored = this.deps.settingsRepo.getLocalAgentSettingsRecord()[agentId];
    const parsed = parseLocalAgentSettings(stored);
    if (parsed.ok) {
      return parsed.settings;
    }
    if (this.lastParseError.get(agentId) !== parsed.error) {
      this.lastParseError.set(agentId, parsed.error);
      console.warn(
        `[local-agents] stored settings for ${agentId} are unreadable (${parsed.error}); using defaults until they are saved again.`
      );
    }
    return defaultLocalAgentSettings();
  }

  /**
   * The whole Local agents section in one call: settings plus the facts only
   * this process can answer. Detection runs in parallel — six login-shell
   * lookups in series would be the slowest thing in Settings.
   */
  async list(): Promise<LocalAgentStatusView[]> {
    return Promise.all(LOCAL_AGENTS.map((agent) => this.describe(agent)));
  }

  private async describe(agent: LocalAgentDefinition): Promise<LocalAgentStatusView> {
    const openCodeView =
      agent.settingsSource === 'opencode' && this.deps.opencode
        ? await this.deps.opencode.getStatusView()
        : null;
    const settings = openCodeView ? this.mergeOpenCodeSettings(agent, openCodeView) : this.getSettings(agent.id);
    const command = settings.binaryPath.trim() || agent.binary;
    const detection = await this.detect(command, agent.versionArgs);

    const base: LocalAgentStatusView = {
      id: agent.id,
      label: agent.label,
      logoId: agent.logoId,
      transport: agent.transport,
      unsupportedReason: agent.unsupportedReason ?? null,
      authHint: agent.authHint,
      acpInstallHint: agent.acp?.installHint ?? null,
      enabled: settings.enabled,
      displayName: settings.displayName,
      color: settings.color,
      binaryPath: settings.binaryPath,
      homePath: settings.homePath,
      binaryDefault: agent.binary,
      acpCommand: settings.acpCommand,
      acpCommandDefault: agent.acp && agent.acp.command !== 'self' ? agent.acp.command : null,
      launchArgs: settings.launchArgs,
      env: settings.env,
      customModels: settings.customModels,
      detection
    };

    if (!openCodeView) {
      return base;
    }

    return {
      ...base,
      opencode: {
        serverUrl: openCodeView.serverUrl,
        hasServerPassword: openCodeView.hasServerPassword
      }
    };
  }

  /**
   * opencode's own blob, mapped onto the shared settings shape.
   *
   * Everything that drives a spawn comes from opencode's settings, which stay
   * its single source of truth. Display name and accent are cosmetics it has
   * no field for, so they come from the shared record — otherwise renaming the
   * OpenCode card would silently do nothing.
   */
  private mergeOpenCodeSettings(
    agent: LocalAgentDefinition,
    view: { enabled: boolean; binaryPath: string; launchArgs: string; env: Record<string, string>; customModels: readonly string[] }
  ): LocalAgentSettings {
    const cosmetics = this.getSettings(agent.id);
    return {
      ...defaultLocalAgentSettings(),
      displayName: cosmetics.displayName,
      color: cosmetics.color,
      enabled: view.enabled,
      binaryPath: view.binaryPath,
      homePath: '',
      launchArgs: view.launchArgs,
      env: view.env,
      customModels: [...view.customModels],
      acpCommand: agent.acp?.command === 'self' ? '' : (agent.acp?.command ?? '')
    };
  }

  /**
   * Detection is cached briefly: `list()` runs after every settings write, and
   * a login-shell lookup per agent per keystroke-blur would make the section
   * the slowest thing in Settings. A changed command misses the cache by key,
   * so pointing at a different binary still re-checks immediately.
   */
  private async detect(command: string, versionArgs: readonly string[]): Promise<LocalAgentDetection> {
    const cached = this.detectionCache.get(command);
    if (cached && Date.now() - cached.at < DETECTION_TTL_MS) {
      return cached.detection;
    }
    const detection = await detectLocalAgent(
      { command, versionArgs },
      this.deps.detectionDeps
    );
    this.detectionCache.set(command, { detection, at: Date.now() });
    return detection;
  }

  /**
   * Apply a patch and bring the registry in line. Rejects an invalid patch
   * whole rather than half-applying it, and refuses to enable an agent Atlas
   * cannot actually drive.
   */
  async update(request: LocalAgentUpdateRequest): Promise<LocalAgentStatusView[]> {
    const agent = findLocalAgent(request.agentId);
    if (!agent) {
      throw new Error(`Unknown local agent \"${request.agentId}\".`);
    }

    if (request.enabled === true && agent.transport === 'none') {
      throw new Error(agent.unsupportedReason ?? `Atlas cannot run turns through ${agent.label} yet.`);
    }

    if (agent.settingsSource === 'opencode') {
      await this.updateOpenCode(request);
      this.saveCosmetics(agent.id, request);
      return this.list();
    }

    const current = this.getSettings(agent.id);
    const patch: Record<string, unknown> = { ...current };
    for (const key of [
      'enabled',
      'displayName',
      'color',
      'binaryPath',
      'homePath',
      'acpCommand',
      'launchArgs',
      'env',
      'customModels'
    ] as const) {
      if (request[key] !== undefined) {
        patch[key] = request[key];
      }
    }

    const parsed = parseLocalAgentSettings(patch);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }

    this.deps.settingsRepo.setLocalAgentSettings(agent.id, parsed.settings);
    await this.syncRegistry();
    return this.list();
  }

  /**
   * Persist the fields opencode's own settings have no room for. Called only
   * on the opencode path; every other agent stores these with the rest.
   */
  private saveCosmetics(agentId: LocalAgentId, request: LocalAgentUpdateRequest): void {
    if (request.displayName === undefined && request.color === undefined) {
      return;
    }
    const current = this.getSettings(agentId);
    const parsed = parseLocalAgentSettings({
      ...current,
      ...(request.displayName !== undefined ? { displayName: request.displayName } : {}),
      ...(request.color !== undefined ? { color: request.color } : {})
    });
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    this.deps.settingsRepo.setLocalAgentSettings(agentId, parsed.settings);
  }

  private async updateOpenCode(request: LocalAgentUpdateRequest): Promise<void> {
    if (!this.deps.opencode) {
      throw new Error('The OpenCode integration is not available in this build.');
    }
    const patch: Parameters<OpenCodeController['updateSettings']>[0] = {};
    if (request.enabled !== undefined) patch.enabled = request.enabled;
    if (request.binaryPath !== undefined) patch.binaryPath = request.binaryPath;
    if (request.launchArgs !== undefined) patch.launchArgs = request.launchArgs;
    if (request.env !== undefined) patch.env = request.env;
    if (request.customModels !== undefined) patch.customModels = request.customModels;
    if (request.serverUrl !== undefined) patch.serverUrl = request.serverUrl;
    await this.deps.opencode.updateSettings(patch);
  }

  /**
   * Register or unregister an adapter per agent to match `enabled`.
   * Idempotent, so it can be called on boot and after every settings write.
   */
  async syncRegistry(): Promise<void> {
    let changed = false;

    for (const agent of this.ownedAgents()) {
      const settings = this.getSettings(agent.id);
      const isClaude = agent.id === 'claude-code';
      const wanted = settings.enabled && (agent.transport === 'acp' || isClaude);
      const registered = this.deps.registry.get(agent.id);

      if (!wanted) {
        if (registered && (this.adapters.has(agent.id) || this.claudeAdapters.has(agent.id))) {
          this.deps.registry.delete(agent.id);
          this.adapters.delete(agent.id);
          this.claudeAdapters.delete(agent.id);
          await this.shutdownAgent(agent.id);
          changed = true;
        }
        continue;
      }

      const adapter = isClaude ? this.getClaudeAdapter(agent) : this.getAdapter(agent);
      if (registered !== adapter) {
        this.deps.registry.set(agent.id, adapter);
        changed = true;
      }

      if (!isClaude) {
        // A spawn-config change retires live children so the next turn starts
        // from the new configuration instead of the one already running.
        const plan = this.spawnPlan(agent, settings);
        const previous = this.spawnKeys.get(agent.id);
        if (previous !== undefined && previous !== plan.key) {
          await this.shutdownAgent(agent.id);
        }
        this.spawnKeys.set(agent.id, plan.key);
      }
    }

    if (changed) {
      await this.deps.onRegistryChanged?.();
    }
  }

  private getAdapter(agent: LocalAgentDefinition): AcpAgentAdapter {
    const existing = this.adapters.get(agent.id);
    if (existing) {
      return existing;
    }

    const adapter = new AcpAgentAdapter({
      providerId: agent.id as ProviderId,
      agentLabel: agent.label,
      readSettings: () => this.getSettings(agent.id),
      getClient: (directory) => this.getClient(agent, directory),
      defaultDirectory: () => this.defaultDirectory(),
      sessions: {
        get: (conversationId) => {
          const cursor = this.deps.sessions.get(agent.id, conversationId);
          return cursor
            ? { sessionId: cursor.sessionId, directory: cursor.directory, transport: 'acp' as const }
            : null;
        },
        set: ({ conversationId, sessionId, directory }) =>
          this.deps.sessions.set({ agentId: agent.id, conversationId, sessionId, directory }),
        clear: (conversationId) => this.deps.sessions.clear(agent.id, conversationId)
      }
    });
    this.adapters.set(agent.id, adapter);
    return adapter;
  }

  private getClaudeAdapter(agent: LocalAgentDefinition): ClaudeAgentAdapter {
    const existing = this.claudeAdapters.get(agent.id);
    if (existing) {
      return existing;
    }

    const adapter = new ClaudeAgentAdapter({
      providerId: agent.id as ProviderId,
      agentLabel: agent.label,
      readSettings: () => this.getSettings(agent.id),
      defaultDirectory: () => this.defaultDirectory(),
      sessions: {
        get: (conversationId) => {
          const cursor = this.deps.sessions.get(agent.id, conversationId);
          return cursor
            ? { sessionId: cursor.sessionId, directory: cursor.directory, transport: 'sdk' as const }
            : null;
        },
        set: ({ conversationId, sessionId, directory }) =>
          this.deps.sessions.set({ agentId: agent.id, conversationId, sessionId, directory }),
        clear: (conversationId) => this.deps.sessions.clear(agent.id, conversationId)
      }
    });
    this.claudeAdapters.set(agent.id, adapter);
    return adapter;
  }

  /**
   * Resolve how this agent's ACP child is started.
   *
   * `'self'` agents speak ACP behind their own subcommand; the rest need a
   * bridge binary, which is a separate install and therefore separately
   * overridable.
   */
  private spawnPlan(agent: LocalAgentDefinition, settings: LocalAgentSettings): AcpSpawnPlan {
    const extra = splitLaunchArgs(settings.launchArgs);
    const usesSelf = agent.acp?.command === 'self';
    const command = usesSelf
      ? settings.binaryPath.trim() || agent.binary
      : settings.acpCommand.trim() || agent.acp?.command || agent.binary;
    const args = [...(agent.acp?.args ?? []), ...extra];
    const env = acpSpawnEnv(settings.env);
    return { command, args, env, key: JSON.stringify([command, args, settings.env]) };
  }

  /**
   * One ACP process per (agent, directory), reused across turns. A dead child
   * evicts its client on exit, so one crash never poisons the directory until
   * restart; idle clients reap after 30s, deferred while a turn is in flight.
   */
  private getClient(agent: LocalAgentDefinition, directory: string): AcpClient {
    const key = `${agent.id} ${directory}`;
    let entry = this.clients.get(key);

    if (!entry) {
      const onExit = () => {
        const current = this.clients.get(key);
        if (current?.client === fresh.client) {
          if (current.idleTimer) {
            clearTimeout(current.idleTimer);
          }
          this.clients.delete(key);
        }
      };

      const settings = this.getSettings(agent.id);
      const plan = this.spawnPlan(agent, settings);
      const fresh: PooledClient = {
        client:
          this.deps.createAcpClient?.(agent, directory, { onExit }) ??
          new AcpClient({
            cwd: directory,
            binaryPath: plan.command,
            spawnArgs: plan.args,
            spawnCwd: true,
            ...(plan.env ? { env: plan.env } : {}),
            onExit
          }),
        idleTimer: null
      };
      this.clients.set(key, fresh);
      entry = fresh;
    }

    const settled = entry;
    if (settled.idleTimer) {
      clearTimeout(settled.idleTimer);
      settled.idleTimer = null;
    }

    const armIdleReap = (): NodeJS.Timeout => {
      const timer = setTimeout(() => {
        const current = this.clients.get(key);
        if (!current || current.client !== settled.client) {
          return;
        }
        if (typeof current.client.hasInflight === 'function' && current.client.hasInflight()) {
          // Turn still running: rearm instead of killing mid-turn.
          current.idleTimer = armIdleReap();
          return;
        }
        void this.reap(key, settled.client);
      }, IDLE_SHUTDOWN_MS);
      timer.unref?.();
      return timer;
    };
    settled.idleTimer = armIdleReap();

    return settled.client;
  }

  private async reap(key: string, client: AcpClient): Promise<void> {
    const current = this.clients.get(key);
    if (current && current.client === client) {
      this.clients.delete(key);
    }
    await client.shutdown().catch(() => undefined);
  }

  async probe(agentId: LocalAgentId): Promise<LocalAgentProbeResult> {
    const agent = findLocalAgent(agentId);
    if (!agent) {
      throw new Error(`Unknown local agent \"${agentId}\".`);
    }

    if (agent.settingsSource === 'opencode') {
      if (!this.deps.opencode) {
        throw new Error('The OpenCode integration is not available in this build.');
      }
      const result = await this.deps.opencode.probe();
      return {
        agentId,
        installed: result.installed,
        version: result.version,
        status: result.status,
        modelCount: result.modelCount,
        ...(result.message ? { message: result.message } : {})
      };
    }

    const settings = this.getSettings(agentId);
    const command = settings.binaryPath.trim() || agent.binary;
    const detection = await this.detect(command, agent.versionArgs);

    if (!detection.installed) {
      return {
        agentId,
        installed: false,
        version: null,
        status: 'error',
        modelCount: 0,
        message: `${agent.label} (${command}) is not installed or not on PATH.`
      };
    }

    if (agent.id === 'claude-code') {
      const probeResult = await probeClaude({
        binaryPath: settings.binaryPath.trim() || agent.binary,
        homePath: settings.homePath,
        launchArgs: settings.launchArgs,
        env: settings.env,
        customModels: settings.customModels,
        cwd: this.defaultDirectory()
      });
      return {
        agentId,
        installed: probeResult.installed,
        version: probeResult.version ?? detection.version,
        status: probeResult.status,
        modelCount: probeResult.models.length,
        ...(probeResult.message ? { message: probeResult.message } : {})
      };
    }

    if (agent.transport === 'none') {
      return {
        agentId,
        installed: true,
        version: detection.version,
        status: 'warning',
        modelCount: 0,
        message: agent.unsupportedReason ?? `Atlas cannot run turns through ${agent.label} yet.`
      };
    }

    const client = this.getClient(agent, this.defaultDirectory());
    try {
      await client.start();
      const session = await client.createSession();
      try {
        return {
          agentId,
          installed: true,
          version: detection.version,
          status: 'ready',
          modelCount: session.models.length,
          message: `${session.models.length} models available over ACP through ${agent.label}.`
        };
      } finally {
        await client.closeSession(session.sessionId).catch(() => undefined);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error ?? '');
      const bridgeMissing = /ENOENT|not found|command not found/i.test(detail);
      return {
        agentId,
        installed: true,
        version: detection.version,
        status: 'error',
        modelCount: 0,
        message:
          bridgeMissing && agent.acp?.installHint
            ? `${agent.label}'s ACP bridge is missing. Install it with: ${agent.acp.installHint}`
            : detail || `Failed to talk to ${agent.label} over ACP.`
      };
    }
  }

  /** Drop every child for one agent, e.g. after its spawn settings moved. */
  private async shutdownAgent(agentId: LocalAgentId): Promise<void> {
    if (agentId === 'claude-code') {
      const claude = this.claudeAdapters.get(agentId);
      if (claude) {
        await claude.shutdown();
      }
    }
    const prefix = `${agentId} `;
    const doomed = [...this.clients.entries()].filter(([key]) => key.startsWith(prefix));
    for (const [key, entry] of doomed) {
      this.clients.delete(key);
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
      }
    }
    await Promise.all(doomed.map(([, entry]) => entry.client.shutdown().catch(() => undefined)));
  }

  /** Kills every child this controller owns. Safe to call twice. */
  async shutdown(): Promise<void> {
    for (const adapter of this.claudeAdapters.values()) {
      await adapter.shutdown().catch(() => undefined);
    }
    this.claudeAdapters.clear();
    const entries = [...this.clients.values()];
    this.clients.clear();
    this.adapters.clear();
    this.spawnKeys.clear();
    for (const entry of entries) {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
      }
    }
    await Promise.all(entries.map((entry) => entry.client.shutdown().catch(() => undefined)));
  }
}

/**
 * Build the controller and bring the registry in line with stored settings.
 *
 * The sync deliberately does not block the caller, for the reason
 * `initializeOpenCode` documents: nothing in the first second of boot can use
 * an adapter, and `onRegistryChanged` announces the catalog when it lands.
 */
export function initializeLocalAgents(deps: LocalAgentControllerDeps): {
  controller: LocalAgentController;
  synced: Promise<void>;
} {
  const controller = new LocalAgentController(deps);
  const synced = controller.syncRegistry().catch((error) => {
    console.warn('[local-agents] initial registry sync failed:', error);
  });
  return { controller, synced };
}
