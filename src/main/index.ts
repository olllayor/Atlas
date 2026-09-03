import { randomUUID } from 'node:crypto';
import { access, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow, app, ipcMain } from 'electron/main';
import { shell } from 'electron/common';

import { ChatEngine } from './ai/core/ChatEngine';
import { ChatSessionRuntime } from './ai/core/ChatSessionRuntime';
import { ContextManager } from './ai/core/ContextManager';
import { SummaryRefreshService } from './ai/compaction/summaryRefresher';
import { CustomProviderService } from './ai/core/CustomProviderService';
import { migrateLegacyBuiltInProviders } from './ai/core/legacyProviderMigration';
import { ModelRegistry } from './ai/core/ModelRegistry';
import { createSiteTools, shouldLoadSiteTools } from './ai/tools/siteTools';
import { SpillStore } from './ai/tools/spill/SpillStore';
import { BackgroundJobRegistry, type JobSnapshot } from './ai/jobs/BackgroundJobRegistry';
import type { ProviderAdapter } from './ai/core/ProviderAdapter';
import type { ProviderRegistry } from './ai/core/providerRegistry';
import { ToolStateStore } from './ai/tools/ToolStateStore';
import { AttachmentStore } from './attachments/AttachmentStore';
import {
  registerAttachmentProtocolHandler,
  registerAttachmentScheme,
} from './attachments/attachmentProtocol';
import { createWindow, syncNativeTheme } from './bootstrap/createWindow';
import { getDockIcon } from './bootstrap/iconPath';
import { perfMark, perfNow } from './bootstrap/perfTrace';
import { createAppDatabase } from './db/client';
import { registerDiagnosticsIpc } from './ipc/diagnostics';
import { withUserFacingErrors } from './ipc/errors';
import { registerChatIpc } from './ipc/chat';
import { registerConversationsIpc } from './ipc/conversations';
import { registerModelsIpc } from './ipc/models';
import { registerProjectsIpc } from './ipc/projects';
import { registerProvidersIpc } from './ipc/providers';
import { registerSettingsIpc } from './ipc/settings';
import { initializeOpenCode } from './ai/providers/opencode/openCodeController';
import { registerWorkspaceIpc } from './ipc/workspace';
import { registerBrowserIpc } from './ipc/browser';
import { PortDiscovery } from './browser/PortDiscovery';
import { hardenBrowserSession } from './browser/webviewSecurity';
import { WorkspaceIndex } from './workspace/WorkspaceIndex';
import { registerGitIpc } from './ipc/git';
import { registerGitHubIpc } from './ipc/github';
import { registerFileChangesIpc } from './ipc/fileChanges';
import { registerTerminalIpc } from './ipc/terminal';
import { registerJobsIpc } from './ipc/jobs';
import { registerGoalsIpc } from './ipc/goals';
import { IdeLauncher } from './workspace/IdeLauncher';
import { ProjectDetector } from './workspace/ProjectDetector';
import { AgentInstructionsService } from './workspace/AgentInstructions';
import { EnvStore } from './workspace/EnvStore';
import { GitReviewService } from './workspace/GitReviewService';
import { GitStateService } from './workspace/GitStateService';
import { getSharedGitHubService } from './workspace/GitHubCli';
import { CheckpointCoordinator } from './workspace/CheckpointCoordinator';
import { McpClientManager } from './ai/mcp/McpClientManager';
import type { ActivationRecord } from './plugins/PluginActivation';
import { PluginActivationStore } from './plugins/PluginActivation';
import {
  registerPluginIconProtocolHandler,
  registerPluginIconScheme,
} from './plugins/pluginIconProtocol';
import { MarketplaceRegistry } from './plugins/MarketplaceRegistry';
import { marketplaceCheckoutRoot, withBundledMarketplace } from './plugins/bundledMarketplace';
import type { MarketplaceRecord } from './plugins/MarketplaceRegistry';
import { PluginBlocklistService } from './plugins/PluginBlocklistService';
import { PluginInstaller } from './plugins/PluginInstaller';
import { PluginMarketplaceService } from './plugins/PluginMarketplaceService';
import { PluginOriginStore } from './plugins/PluginOrigins';
import type { PluginOrigin } from './plugins/PluginOrigins';
import { PluginRegistry } from './plugins/PluginRegistry';
import { PluginUpdateService } from './plugins/PluginUpdateService';
import { registerPluginsIpc } from './ipc/plugins';
import { registerMcpUiIpc } from './ipc/mcpUi';
import { McpAuditLog } from './ai/mcp/McpAuditLog';
import { resolveMcpToolProvenance } from './ai/mcp/mcpToolProvenance';
import { McpUiStore } from './ai/mcp/McpUiStore';
import { registerMcpUiProtocolHandler, registerMcpUiScheme } from './ai/mcp/mcpUiProtocol';
import { createPluginMcpSource } from './plugins/PluginMcpSource';
import { SkillsService } from './plugins/SkillsService';
import { createKeychainOAuthStore, McpSecretStore } from './secrets/mcpSecrets';
import { McpOAuthProvider } from './ai/mcp/mcpOAuth';
import { createMcpToolsProvider } from './ai/mcp/mcpToolsProvider';
import { FileChangeTracker } from './workspace/FileChangeTracker';
import { PtyService } from './terminal/PtyService';
import { assertTrustedSender } from './ipc/security';
import { registerSitesIpc } from './ipc/sites';
import { registerUpdatesIpc } from './ipc/updates';
import { registerVisualsIpc } from './ipc/visuals';
import { registerContextMenuIpc } from './ipc/contextMenu';
import { SiteExporter } from './sites/SiteExporter';
import { SiteFileStore } from './sites/SiteFileStore';
import { SitePreviewHost, registerSitePreviewScheme } from './sites/SitePreviewHost';
import {
  parkColdStartLink,
  registerAtlasProtocolHandler,
  registerAtlasScheme,
  registerDeepLinkIpc,
  wireOsLaunchLinks,
} from './bootstrap/deepLink';
import { SiteService } from './sites/SiteService';
import { logger } from './observability/logger';
import { KeychainStore } from './secrets/keychain';
import { worktreeService } from './workspace/WorktreeService';
import { GoalRuntime } from './ai/goal/goalRuntime';
import { resolveConversationWorkspace } from './workspace/conversationWorkspace';
import { UpdateService } from './updates/UpdateService';
import { captureFirstLaunchIfNeeded, capturePostHogEvent, getAnonymousId, getTelemetryEnabled, setTelemetryEnabled, shutdownPostHog } from './analytics/PostHogClient';
import { EMPTY_BLOCKLIST } from '../shared/blocklist';
import { IPC_CHANNELS } from '../shared/ipc';
import { POSTHOG_EVENTS } from '../shared/posthog';

const APP_NAME = 'Atlas';
const DATABASE_FILENAME = 'atlas-chat.db';
const LEGACY_DATABASE_FILENAMES = ['atlas-chat.db', 'cheapchat.db'];
const LEGACY_USER_DATA_DIRECTORIES = ['Atlas', 'CheapChat', 'cheapchat'];

app.setName(APP_NAME);

// Dev-only escape hatch: `ATLAS_REMOTE_DEBUG_PORT=9223 pnpm dev` exposes the
// renderer over CDP so styling/compositing issues can be inspected headlessly.
// Never set in production builds; the switch must land before app ready.
if (!app.isPackaged && process.env.ATLAS_REMOTE_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.ATLAS_REMOTE_DEBUG_PORT);
}

// Custom schemes must be declared before the app is ready. `atlas-site` gives
// previewed sites their own secure origin instead of loading them over file://;
// `atlas-attachment` does the same for stored files, which the CSP will not
// load over file:// either.
registerSitePreviewScheme();
registerAttachmentScheme();
registerPluginIconScheme();
/**
 * Reports a background failure instead of dropping it.
 *
 * Every call site here is work the app deliberately does not wait on, so the
 * catch is what keeps a slow disk or an unreachable endpoint from taking the
 * boot down with it. Swallowing the error entirely is a different thing: it
 * left failed migrations, stale catalogs and orphaned spill directories with
 * no trace anywhere. `event` names the step so a log line points at one.
 */
const reportBackgroundFailure =
  (event: string) =>
  (error: unknown): undefined => {
    logger.warn(event, { error: error instanceof Error ? error.message : String(error) });
    return undefined;
  };

// `atlas://` deep links — same privileged-registration constraint, and the
// OS launch hooks must attach before `whenReady` resolves to catch cold starts.
registerAtlasScheme();
wireOsLaunchLinks();
// Windows and Linux hand an `atlas://` link to a freshly spawned second
// process's argv; Electron only delivers `second-instance` to a primary that
// holds the single-instance lock, so without it the handoff is dead code.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  // This primary may itself have been launched from a link (cold start);
  // park it until the renderer's subscription can pull it.
  parkColdStartLink(process.argv);
}
// Plugin UI components. Must be registered before the app is ready, like the
// three above, and gets its own scheme for the same reason: the widget's CSP is
// a response header this process writes, which is a guarantee no `srcdoc`
// document can offer — one of those inherits the renderer's policy instead.
registerMcpUiScheme();

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveDatabasePath() {
  const currentUserDataPath = app.getPath('userData');
  await mkdir(currentUserDataPath, { recursive: true });

  const databasePath = join(currentUserDataPath, DATABASE_FILENAME);
  if (await pathExists(databasePath)) {
    return databasePath;
  }

  const candidateDirectories = Array.from(
    new Set([currentUserDataPath, ...LEGACY_USER_DATA_DIRECTORIES.map((directory) => join(app.getPath('appData'), directory))])
  );

  for (const directory of candidateDirectories) {
    for (const filename of LEGACY_DATABASE_FILENAMES) {
      const candidatePath = join(directory, filename);
      if (candidatePath === databasePath || !(await pathExists(candidatePath))) {
        continue;
      }

      // Copy the previous local database into the renamed app's data directory.
      await copyFile(candidatePath, databasePath);
      return databasePath;
    }
  }

  return databasePath;
}

async function resolveAttachmentDirectory() {
  const attachmentsPath = join(app.getPath('userData'), 'attachments');
  await mkdir(attachmentsPath, { recursive: true });
  return attachmentsPath;
}

async function resolveSitesDirectory() {
  const sitesPath = join(app.getPath('userData'), 'sites');
  await mkdir(sitesPath, { recursive: true });
  return sitesPath;
}

async function resolveSpillsDirectory() {
  const spillsPath = join(app.getPath('userData'), 'spills');
  await mkdir(spillsPath, { recursive: true });
  return spillsPath;
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return; // A second launch: hand over and die.
  const bootStart = perfNow();
  perfMark('app:whenReady');
  // First thing after ready: everything below is worth having a record of, and
  // a failure here is exactly the kind that leaves no other trace.
  logger.configure({
    directory: join(app.getPath('userData'), 'logs'),
    echoToConsole: !app.isPackaged,
  });
  logger.info('app.started', {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    logFile: logger.getLogFilePath(),
  });

  const icon = getDockIcon();
  if (icon && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon);
  }

  const attachmentStore = new AttachmentStore(await resolveAttachmentDirectory());
  registerAttachmentProtocolHandler(attachmentStore);
  // Every provider is user-configured; the registry starts empty and is filled
  // from the database by CustomProviderService below. Declared before the
  // database because the model cache asks it which providers are servable
  // without a saved endpoint (OpenCode signs itself in), and that answer has
  // to stay live as the integration is switched on and off.
  const providers: ProviderRegistry = new Map<ProviderAdapter['providerId'], ProviderAdapter>();
  const database = createAppDatabase(await resolveDatabasePath(), attachmentStore, () =>
    [...providers.entries()]
      .filter(([, adapter]) => adapter.capabilities?.authenticatesItself === true)
      .map(([providerId]) => providerId)
  );
  perfMark('db:open+schema');
  const spillStore = new SpillStore(await resolveSpillsDirectory());
  // One registry for every long-running producer (background bash today;
  // subagents and terminals can register as kinds later). Conversation-fenced:
  // ids are predictable, so the fence, not id secrecy, is the boundary.
  const jobRegistry = new BackgroundJobRegistry();
  // Push registration and settlement to every window so the jobs chip stays
  // live without polling. Each window filters by its own conversation.
  const broadcastJobEvent = (type: 'started' | 'done') => (snapshot: JobSnapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.jobsEvent, { type, snapshot });
    }
  };
  jobRegistry.onJobStart(broadcastJobEvent('started'));
  jobRegistry.onJobDone(broadcastJobEvent('done'));
  // Reclaim spill directories whose conversation is gone. Fire-and-forget:
  // sweeping is housekeeping, and a slow disk must not delay startup. The
  // min-age guard keeps any directory a live turn may be writing to.
  void spillStore
    .sweep(database.conversations.list({ includeArchived: true, includeSide: true }).map((c) => c.id))
    .catch((err) => logger.warn('spill.sweep_failed', { error: err instanceof Error ? err.message : String(err) }));
  const toolStateStore = new ToolStateStore(database.toolExecutions);
  const interruptedMessageIds = toolStateStore.reconcileInterrupted();
  const interruptedRuntimeSessions = database.runtimeState.reconcileInterruptedSessions();
  database.conversations.markMessagesError(interruptedMessageIds, 'interrupted');
  database.conversations.markMessagesError(
    interruptedRuntimeSessions.map((session) => session.assistantMessageId),
    'interrupted',
  );
  const keychain = new KeychainStore();
  // Load the Cloud Sandbox bearer token from the keychain into the in-memory
  // cache so the synchronous turn-setup path can read it without awaiting.
  await database.settings.primeCloudSandboxSecret().catch((err) => {
    console.warn('[startup] primeCloudSandboxSecret failed:', err);
  });
  const updateService = new UpdateService();

  // Upgrade path: convert the former built-in providers into ordinary entries.
  await migrateLegacyBuiltInProviders({
    customProvidersRepo: database.customProviders,
    modelsRepo: database.models,
    settingsRepo: database.settings,
    keychain,
    remapConversationProvider: (from, to) => database.conversations.remapProviderId(from, to)
  }).catch(reportBackgroundFailure('providers.legacy_migration_failed'));
  perfMark('migrateLegacyBuiltInProviders');

  const modelRegistry = new ModelRegistry(
    database.models,
    database.settings,
    keychain,
    providers,
    database.customProviders
  );

  /**
   * Tell every open window the model cache moved under it.
   *
   * The renderer holds the catalog in its store and only re-reads it on this
   * signal, so any main-process write that is not announced is invisible until
   * the app restarts.
   */
  const broadcastModelsChanged = () => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.modelsChanged);
    }
  };

  const customProviderService = new CustomProviderService({
    repo: database.customProviders,
    modelsRepo: database.models,
    settingsRepo: database.settings,
    keychain,
    registry: providers,
    // A configuration change can add, remove or re-point models, so the catalog
    // is rebuilt rather than left showing endpoints that no longer exist.
    onProvidersChanged: async () => {
      await modelRegistry.refresh().catch(reportBackgroundFailure('models.refresh_failed'));
      // The rebuild happens here, in the main process; the window that made the
      // change gets back a provider record, not a catalog. Without this a
      // freshly added provider's models sat in the cache unseen — the picker
      // kept showing the list it loaded at startup until the app was relaunched.
      broadcastModelsChanged();
    }
  });

  // Adapters for providers saved in a previous session.
  await customProviderService.syncRegistry();
  perfMark('providers:syncRegistry');
  // Saved custom models are re-checked against models.dev: effort levels for
  // models predating them, and context/output limits, which go stale silently
  // and skew every context reading until they are corrected. Network-backed, so
  // it must not block startup; the renderer has usually loaded its model list by
  // the time this lands, hence the change broadcast.
  void customProviderService
    .backfillModelFacts()
    .then((changed) => {
      if (changed) {
        broadcastModelsChanged();
      }
    })
    .catch(reportBackgroundFailure('models.backfill_facts_failed'));
  // Deep OpenCode integration (Beta, off by default): while it is disabled the
  // adapter stays out of the registry and nothing spawns or probes. The initial
  // registry sync runs in the background — see `initializeOpenCode` — because
  // awaiting it here held the first window back by about a second of cold
  // start, for a feature that is off unless someone turned it on.
  const { controller: opencodeController } = initializeOpenCode({
    settingsRepo: database.settings,
    keychain,
    sessions: database.opencodeSessions,
    registry: providers,
    defaultDirectory: () => app.getPath('home'),
    onRegistryChanged: async () => {
      await modelRegistry.refresh().catch(reportBackgroundFailure('models.refresh_failed'));
      broadcastModelsChanged();
    }
  });
  perfMark('opencode:controller-constructed');

  // Drop cached models left behind by providers that no longer exist, so the
  // catalog does not carry entries nothing can serve.
  database.models.deleteOrphanedModels();

  const siteFileStore = new SiteFileStore(await resolveSitesDirectory());
  const siteService = new SiteService(database.sites, siteFileStore);
  const sitePreviewHost = new SitePreviewHost(siteService, siteFileStore);
  const siteExporter = new SiteExporter(siteService);
  sitePreviewHost.registerProtocolHandler();

  const projectDetector = new ProjectDetector();
  const ideLauncher = new IdeLauncher();
  const agentInstructions = new AgentInstructionsService();
  const envStore = new EnvStore(database.raw);
  const gitStateService = new GitStateService();
  const gitReviewService = new GitReviewService();
  const githubService = getSharedGitHubService();
  const fileChangeTracker = new FileChangeTracker(database.fileChanges);
  // The Files surface's listing, cached per workspace root across windows.
  const workspaceIndex = new WorkspaceIndex();
  // Local servers worth offering when a Browser surface opens empty.
  const portDiscovery = new PortDiscovery();
  // Every permission the browser partition could ever be asked for, denied
  // once, before any guest page exists to ask.
  hardenBrowserSession();

  // The Terminal panel's shells. Output is pushed to every open window: the
  // panel filters by conversation, and a second window showing the same
  // conversation should see the same session rather than a dead pane.
  const ptyService = new PtyService(
    (payload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.terminalOutput, payload);
      }
    },
    database.terminalHistory,
    // Status and label changes go to every window for the same reason output
    // does: two windows on one conversation are looking at the same shells.
    (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.terminalMetadata, event);
      }
    }
  );

  // Where each installed bundle came from. Nothing else records it, and both
  // the update check and a scoped revocation are unanswerable without it.
  const pluginOrigins = new PluginOriginStore(
    () => database.settings.getPluginOrigins<PluginOrigin>(),
    (records) => database.settings.setPluginOrigins(records),
  );
  // Read from the marketplaces, cached in settings. The scan below runs on the
  // turn-setup path, so it consults the stored answer and never the network.
  const pluginBlocklist = new PluginBlocklistService(
    () => database.settings.getPluginBlocklist(EMPTY_BLOCKLIST),
    (value) => database.settings.setPluginBlocklist(value),
    pluginOrigins,
  );
  // One scan of ~/.atlas/plugins feeds every component type, so the prompt and
  // the tool set cannot disagree about what is installed.
  const pluginRegistry = new PluginRegistry({
    isEnabled: (name) => !database.settings.getDisabledPlugins().includes(name),
    // Withheld here rather than in each consumer: a revocation any one of them
    // could forget to apply is not a revocation.
    blockedReason: (name, version) => pluginBlocklist.check(name, version)?.message ?? null,
    // A bundle may declare the oldest Atlas that understands it; refusing to
    // load beats loading it without the parts its author relied on.
    appVersion: app.getVersion(),
  });
  // The beta switch, read live everywhere it matters. Off is not "hidden":
  // no MCP server source, no skills in the prompt, no IPC answers, no default
  // installs — the whole pipeline goes inert while the files stay on disk.
  const pluginsBetaEnabled = () => database.settings.getPluginsBetaEnabled();
  const pluginInstaller = new PluginInstaller(pluginRegistry, pluginOrigins);
  const checkoutRoot = marketplaceCheckoutRoot();
  // Artwork is served from these two roots and nowhere else, whatever a
  // manifest asks for.
  registerPluginIconProtocolHandler(() => [pluginRegistry.root, checkoutRoot]);
  registerAtlasProtocolHandler();
  registerDeepLinkIpc();
  // Interrupted installs leave staging directories behind. Upstream documents
  // sweeping them and does not; a machine surveyed for this work still had
  // three from a month earlier.
  pluginInstaller.sweepStaging();
  // Checkouts live beside the bundles but outside them: a dot-directory is
  // skipped by the registry scan, so a cloned marketplace is never mistaken
  // for an installed plugin.
  const marketplaceRegistry = new MarketplaceRegistry(
    // The bundled marketplace is prepended rather than stored: it is not a
    // choice the user made, so it cannot drift from what the build contains.
    () => withBundledMarketplace(database.settings.getMarketplaces<MarketplaceRecord>()),
    checkoutRoot,
  );
  // Checkouts for marketplaces nobody refers to any more are dead weight the
  // installer's own sweep never covered — it only looks inside the plugins
  // directory, and these live beside it.
  marketplaceRegistry.sweepCheckouts();
  perfMark('plugins:registry+sweeps');
  const pluginMarketplaces = new PluginMarketplaceService(
    marketplaceRegistry,
    pluginRegistry,
    pluginInstaller,
    () => database.settings.getMarketplaces<MarketplaceRecord>(),
    (records) => database.settings.setMarketplaces(records),
    pluginBlocklist,
  );
  const pluginUpdates = new PluginUpdateService(
    marketplaceRegistry,
    pluginRegistry,
    pluginInstaller,
    pluginOrigins,
    pluginBlocklist,
  );

  // MCP is no longer a feature with a configuration surface: servers arrive
  // only inside installed plugins, and this manager is the loader internal that
  // runs them.
  const mcpSecrets = new McpSecretStore();
  const keychainOAuthStore = createKeychainOAuthStore();
  const listPluginServers = createPluginMcpSource(pluginRegistry, pluginsBetaEnabled);
  const mcpManager = new McpClientManager(
    listPluginServers,
    async (serverId) => {
      const env = await mcpSecrets.getEnv(serverId);
      // A plugin server's id is `plugin:<name>:<key>`, and the credential panel
      // saves per plugin rather than per server. Merged here — the one place
      // both sides of the id are known — so a token typed into the plugin's
      // detail panel reaches every server that plugin carries.
      const pluginName = serverId.startsWith('plugin:') ? serverId.split(':')[1] : null;

      if (!pluginName) {
        return env;
      }

      const credentials = await mcpSecrets.getPluginCredentials(pluginName);
      return { ...credentials, ...env };
    },
    undefined,
    // OAuth for remote servers: a 401 becomes a browser consent flow with a
    // loopback landing, tokens in the keychain. Stdio servers return nothing —
    // they have nothing to authorize against.
    (server) => {
      if ((server.transport !== 'http' && server.transport !== 'sse') || !server.url) {
        return undefined;
      }

      return new McpOAuthProvider({
        serverId: server.id,
        serverName: server.name,
        store: keychainOAuthStore,
        openExternal: (url) => {
          void shell.openExternal(url);
        }
      });
    }
  );
  // Gating: a bundle's servers stay unconnected and out of the request until a
  // skill from that plugin is opened. Twenty installed plugins therefore cost
  // no tool schemas until the conversation is about one of them.
  const pluginActivations = new PluginActivationStore(
    pluginRegistry,
    () => database.settings.getPluginActivations<ActivationRecord>(),
    (value) => database.settings.setPluginActivations(value),
    () => new Set(database.settings.getAlwaysOnPlugins()),
  );
  // In memory and never persisted: a widget is a view of one moment, and
  // reviving last week's card would show state the server has long since
  // changed while re-running third-party markup nobody asked for again.
  const mcpUiStore = new McpUiStore();
  registerMcpUiProtocolHandler(mcpUiStore);
  registerMcpUiIpc(mcpUiStore);

  // Held apart from the runtime-envelope table: that one is read on the
  // transcript replay path, and audit payloads would make every conversation
  // load pay for records nobody is looking at. Backed by SQLite rather than
  // left in memory, so a record written before a restart is still there
  // after one — the whole reason "session history" means something.
  const mcpAuditLog = new McpAuditLog(database.pluginAudit);

  const mcpToolsProvider = createMcpToolsProvider(
    mcpManager,
    listPluginServers,
    (conversationId) => pluginActivations.serverFilter(conversationId),
    mcpUiStore,
    mcpAuditLog,
  );
  const skillsService = new SkillsService(pluginRegistry, pluginsBetaEnabled);

  app.on('will-quit', () => {
    // Buffered log lines must land before the process goes away; after this,
    // the exit hook is a backstop for anything logged during teardown.
    logger.flushSync();
    ptyService.disposeAll();
    // An `opencode serve` child Atlas spawned outlives the window otherwise.
    void opencodeController.shutdown();
    // Spawned servers outlive the window otherwise: the transport keeps the
    // child alive, and nothing else would reap it.
    void mcpManager.disposeAll();
    // Background jobs are tracked, not detached: quit cancels them instead of
    // orphaning them the way the old fire-and-forget spawn did. Fire-and-
    // forget here too — quit must not hang on a slow kill.
    void jobRegistry.killAll('app quitting');
    // Same for live subagent sessions: they are tracked by the runtime, so
    // quit cascade-stops them rather than leaving child turns running.
    void chatEngine.subagents.interruptAllConversations('app quitting');
  });

  // The turn path reads project env vars synchronously, so the keychain values
  // are loaded once here rather than on the first command that needs them.
  void envStore.primeAll().catch((err) => {
    console.warn('[main] env prime failed:', err);
  });

  const checkpointCoordinator = new CheckpointCoordinator(database);

  // Rolling summaries survive relaunch via the durable store, and each fresh
  // heuristic summary gets an async model upgrade in the background.
  const summaryRefresher = new SummaryRefreshService({
    conversationsRepo: database.conversations,
    modelsRepo: database.models,
    keychain,
    providers,
    summaries: database.conversationSummaries,
  });
  const contextManager = new ContextManager(
    {
      onSummaryRefresh: (conversationId, fingerprint, olderMessages) =>
        summaryRefresher.refresh(conversationId, fingerprint, olderMessages),
    },
    database.conversationSummaries,
  );

  const chatEngine = new ChatEngine(
    database.conversations,
    database.models,
    keychain,
    providers,
    attachmentStore,
    new ChatSessionRuntime(
      database.conversations,
      database.models,
      keychain,
      providers,
      contextManager,
      ({ conversationId, mentions }) => {
        // Sticky opt-in: once a conversation mentions @Sites the toolset stays
        // registered for the rest of it, so the tool catalog stops toggling per
        // message and the provider's prompt cache survives. The mention check
        // still runs first so the very first opt-in persists itself.
        const mentioned = mentions.includes('sites');
        if (mentioned && !database.conversations.getSiteOptIn(conversationId)) {
          database.conversations.setSiteOptIn(conversationId, true);
        }

        const optedIn =
          mentioned ||
          database.conversations.getSiteOptIn(conversationId) ||
          shouldLoadSiteTools({
            mentions,
            hasExistingSite: database.sites.hasSiteForConversation(conversationId),
          });
        return optedIn ? createSiteTools(siteService, sitePreviewHost, conversationId) : null;
      },
      (conversationId) => ({
        ...resolveConversationWorkspace(database, conversationId, {
          fileChangeTracker,
          envStore,
          agentInstructions,
          terminalHistory: database.terminalHistory,
          settingsRepo: database.settings,
          // Display-only echo: the agent's command already ran through the
          // approval ladder in `runCommand`, and nothing here touches stdin.
          onAgentCommand: (command, exitCode) =>
            ptyService.echoAgentCommand(conversationId, command, exitCode),
        }),
        jobRegistry,
        spillStore,
        // Read-only: the agent may watch the user's terminal but never type
        // into it (PtyService.snapshot has no stdin path).
        terminalReadback: ptyService,
        // The model side of /goal: without this the update_goal tool is never
        // advertised and the goal etiquette never ships, so the runtime would
        // keep admitting continuation turns the model cannot report on.
        goalTools: goalRuntime,
      }),
      () => database.settings.getVisualMode(),
      mcpToolsProvider,
      skillsService,
      (conversationId, pluginName, requiredServers) =>
        pluginActivations.activateForSkill(conversationId, pluginName, requiredServers),
      // Naming a plugin with `@` activates it for the conversation. Reuses the
      // skill route because the effect is identical — the plugin's own servers
      // come up — and a second activation path would be a second thing to keep
      // in step with the gate.
      (conversationId, targets) => {
        for (const target of targets) {
          pluginActivations.activateForSkill(conversationId, target.plugin, []);
        }
      },
      mcpAuditLog,
      spillStore,
      () => database.settings.getCompactionThresholdPercent(),
    ),
    database.runtimeState,
    toolStateStore,
    undefined,
    async ({ modelId, capability }) => {
      await customProviderService
        .recordCapabilityRejection(modelId, capability)
        .catch(reportBackgroundFailure('providers.capability_rejection_failed'));
    },
    checkpointCoordinator,
    mcpAuditLog,
    // Built fresh per lookup from a live snapshot, not captured once at
    // construction: an approval can be decided long after the tool call that
    // requested it, and the plugin behind it must be resolved against what is
    // installed at that later moment, not against a stale list.
    (toolName) => {
      const found = resolveMcpToolProvenance(toolName, pluginRegistry.snapshot().plugins);

      if (!found) {
        return null;
      }

      const plugin = pluginRegistry
        .snapshot()
        .plugins.find((candidate) => candidate.manifest.name === found.pluginName);

      return plugin ? { name: plugin.manifest.name, version: plugin.manifest.version } : null;
    },
    // Resumed follow-ups borrow the frontmost window for event delivery.
    () => {
      const windows = BrowserWindow.getAllWindows();
      return windows.length > 0 ? windows[windows.length - 1] : null;
    },
  );

  /*
    Goal mode (/goal). The runtime owns every goal state transition; the
    engine owns turn scheduling. Each is wired to the other here, after both
    exist — a constructor parameter would be circular.
  */
  const pushGoalEvent = (conversationId: string, info?: { notice?: string }): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.goalsEvent, {
        type: 'updated',
        conversationId,
        goal: database.conversationGoals.getActive(conversationId),
        ...(info?.notice ? { notice: info.notice } : {}),
      });
    }
  };
  const goalRuntime = new GoalRuntime({
    goals: database.conversationGoals,
    randomId: () => randomUUID(),
    recordActivity: ({ eventId, conversationId, activityType, payload }) => {
      // Same durable-log writer the followup queue uses: lifecycle rows land
      // in conversation_activities and replay like any other work log.
      void chatEngine.recordGoalActivity({ eventId, conversationId, activityType, payload });
    },
    isBusy: (conversationId) => chatEngine.isBusyForGoal(conversationId),
    hasPendingApproval: (conversationId) => chatEngine.hasPendingGoalApproval(conversationId),
    enqueueContinuation: (conversationId) => chatEngine.startGoalContinuation(conversationId),
    pushEvent: pushGoalEvent,
  });
  chatEngine.attachGoalRuntime(goalRuntime);
  perfMark('chatengine+goal:constructed');

  registerSettingsIpc({
    settingsRepo: database.settings,
    modelRegistry,
    keychain,
    opencode: opencodeController
  });
  registerModelsIpc(modelRegistry);
  registerProvidersIpc(customProviderService);
  registerConversationsIpc({
    conversationsRepo: database.conversations,
    projectsRepo: database.projects,
    settingsRepo: database.settings,
    onRegenerateTitle: (conversationId) => chatEngine.regenerateTitle(conversationId),
    onConversationDeleted: (conversationId) => {
      ptyService.killConversation(conversationId);
      // Spill files are an implementation detail of the conversation's turns;
      // they go with it. Fire-and-forget for the same reason the sweep is.
      void spillStore.deleteConversation(conversationId).catch(reportBackgroundFailure('spill.delete_failed'));
      // Same for its background jobs: the owner is gone, so nothing can
      // claim their output anymore.
      void jobRegistry
        .killConversation(conversationId, 'conversation deleted')
        .catch(reportBackgroundFailure('jobs.kill_conversation_failed'));
      // And its live subagent sessions, for the same reason. Eviction stops the
      // continuation loops (child-first through nested trees) and drops any
      // completion notices nobody will ever drain; interruptAll handles the
      // remaining one-shot Task sessions.
      // The opencode resume cursor points at a session for a chat that no
      // longer exists. The FK cascade drops the row too, but the delete should
      // not depend on a pragma to be correct.
      opencodeController.forgetConversation(conversationId);
      chatEngine.continuations.evictForConversation(conversationId);
      void chatEngine.subagents
        .interruptAll(conversationId, 'conversation deleted')
        .catch(reportBackgroundFailure('subagents.interrupt_all_failed'));
      void chatEngine.subagents
        .clearConversationBackground(conversationId, 'conversation deleted')
        .catch(reportBackgroundFailure('subagents.clear_background_failed'));
    },
  });
  registerProjectsIpc({
    projectsRepo: database.projects,
    settingsRepo: database.settings,
    ideLauncher,
    conversationsRepo: database.conversations,
    worktreeService,
  });
  registerWorkspaceIpc(database, projectDetector, envStore, agentInstructions, workspaceIndex);
  registerBrowserIpc(portDiscovery);
  registerGitIpc(database, gitStateService, gitReviewService);
  registerGitHubIpc(database, githubService);
  // Plugins Atlas ships with are present without being asked for. Runs after
  // the staging sweep so a half-finished copy is never mistaken for installed.
  // Skipped while the beta is off: a default install is the feature acting,
  // and an off feature does nothing at all.
  if (pluginsBetaEnabled()) {
    pluginMarketplaces.installDefaults();
  }

  registerPluginsIpc({
    isEnabled: pluginsBetaEnabled,
    registry: pluginRegistry,
    installer: pluginInstaller,
    marketplaces: pluginMarketplaces,
    updates: pluginUpdates,
    origins: pluginOrigins,
    activations: pluginActivations,
    secrets: mcpSecrets,
    mcpManager,
    setAlwaysOn: (name, alwaysOn) => database.settings.setPluginAlwaysOn(name, alwaysOn),
    setEnabled: (name, enabled) => database.settings.setPluginEnabled(name, enabled),
  });
  registerFileChangesIpc(database, fileChangeTracker);
  registerTerminalIpc(database, ptyService);
  registerJobsIpc(jobRegistry);
  registerGoalsIpc({ goalRuntime, chatEngine });
  registerChatIpc(chatEngine);
  perfMark('ipc:handlers-registered');
  // Fold the durable follow-up queue back in and start draining it. The
  // window resolver lets a resumed entry borrow the frontmost window for
  // event delivery; entries wait in the queue until one exists.
  chatEngine.resumePersistedFollowups();
  // Boot admission tick (plan §2.7): a crash mid-turn leaves its goal active
  // with no settle coming. Idle conversations get one admission decision now;
  // busy ones are skipped because their own settle will decide.
  goalRuntime.continueIdleGoals();
  registerDiagnosticsIpc(database.conversations);
  registerUpdatesIpc(updateService);
  registerVisualsIpc(database.visuals);
  registerContextMenuIpc();
  registerSitesIpc({ service: siteService, previewHost: sitePreviewHost, exporter: siteExporter });

  // Wrapped like every other handler: these are registered here rather than in
  // an `ipc/` module, which is exactly how a surface ends up being the one that
  // still throws raw internals at the renderer. They are also the only handlers
  // that bypass `./ipc/security`, so each one starts by asserting a trusted
  // sender — otherwise an XSS'd or loaded-iframe renderer could drive
  // analytics/telemetry on the main process.
  ipcMain.handle(
    IPC_CHANNELS.posthogGetAnonymousId,
    withUserFacingErrors(IPC_CHANNELS.posthogGetAnonymousId, (event) => {
      assertTrustedSender(event);
      return getAnonymousId();
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.posthogCaptureEvent,
    withUserFacingErrors(
      IPC_CHANNELS.posthogCaptureEvent,
      (event: Electron.IpcMainInvokeEvent, eventName: string, properties?: Record<string, unknown>) => {
        assertTrustedSender(event);
        capturePostHogEvent(eventName, properties);
      },
    ),
  );

  ipcMain.handle(
    IPC_CHANNELS.posthogGetTelemetryEnabled,
    withUserFacingErrors(IPC_CHANNELS.posthogGetTelemetryEnabled, (event) => {
      assertTrustedSender(event);
      return getTelemetryEnabled();
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.posthogSetTelemetryEnabled,
    withUserFacingErrors(
      IPC_CHANNELS.posthogSetTelemetryEnabled,
      (event: Electron.IpcMainInvokeEvent, enabled: boolean) => {
        assertTrustedSender(event);
        setTelemetryEnabled(enabled);
      },
    ),
  );

  // Before the first window: the vibrancy material is created with the native
  // appearance, so setting it afterwards leaves the first paint mismatched.
  syncNativeTheme(database.settings.getThemeMode());
  perfMark('boot:pre-window-complete');
  const window = createWindow({ translucentSidebar: database.settings.getTranslucentSidebar() });
  perfMark('window:created');
  window.webContents.once('did-finish-load', () => {
    perfMark('boot:total (module eval → renderer loaded)');
    if (process.env.ATLAS_PERF_TRACE === '1') {
      console.info(`[perf] bootStart→whenReady measured from module eval; whenReady delta: ${Math.round(performance.now() - bootStart)}ms`);
    }
  });
  captureFirstLaunchIfNeeded();
  window.once('show', () => {
    updateService.start();
    capturePostHogEvent(POSTHOG_EVENTS.APP_LAUNCHED);
    // Deliberately after the window is up rather than beside the other
    // priming above: these are child processes, and spawning them while the
    // renderer is still loading would trade the first turn's latency for the
    // first paint's. By the time the user has typed anything, the servers are
    // connected and their tools already listed.
    // Gated servers are deliberately not warmed: warming one would spawn the
    // process the gate exists to avoid.
    void mcpManager.prewarm(pluginActivations.eagerOnlyFilter()).catch(reportBackgroundFailure('mcp.prewarm_failed'));
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow({ translucentSidebar: database.settings.getTranslucentSidebar() });
    }
  });
});

app.on('window-all-closed', () => {
  void shutdownPostHog();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
