import { access, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow, app, ipcMain } from 'electron/main';

import { ChatEngine } from './ai/core/ChatEngine';
import { ChatSessionRuntime } from './ai/core/ChatSessionRuntime';
import { CustomProviderService } from './ai/core/CustomProviderService';
import { migrateLegacyBuiltInProviders } from './ai/core/legacyProviderMigration';
import { ModelRegistry } from './ai/core/ModelRegistry';
import { createSiteTools, shouldLoadSiteTools } from './ai/tools/siteTools';
import type { ProviderAdapter } from './ai/core/ProviderAdapter';
import type { ProviderRegistry } from './ai/core/providerRegistry';
import { ToolStateStore } from './ai/tools/ToolStateStore';
import { AttachmentStore } from './attachments/AttachmentStore';
import { createWindow } from './bootstrap/createWindow';
import { getDockIcon } from './bootstrap/iconPath';
import { createAppDatabase } from './db/client';
import { registerDiagnosticsIpc } from './ipc/diagnostics';
import { registerChatIpc } from './ipc/chat';
import { registerConversationsIpc } from './ipc/conversations';
import { registerModelsIpc } from './ipc/models';
import { registerProvidersIpc } from './ipc/providers';
import { registerSettingsIpc } from './ipc/settings';
import { registerSitesIpc } from './ipc/sites';
import { registerUpdatesIpc } from './ipc/updates';
import { registerVisualsIpc } from './ipc/visuals';
import { SiteExporter } from './sites/SiteExporter';
import { SiteFileStore } from './sites/SiteFileStore';
import { SitePreviewHost, registerSitePreviewScheme } from './sites/SitePreviewHost';
import { SiteService } from './sites/SiteService';
import { KeychainStore } from './secrets/keychain';
import { UpdateService } from './updates/UpdateService';
import { captureFirstLaunchIfNeeded, capturePostHogEvent, getAnonymousId, getTelemetryEnabled, setTelemetryEnabled, shutdownPostHog } from './analytics/PostHogClient';
import { IPC_CHANNELS } from '../shared/ipc';
import { POSTHOG_EVENTS } from '../shared/posthog';

const APP_NAME = 'Atlas';
const DATABASE_FILENAME = 'atlas-chat.db';
const LEGACY_DATABASE_FILENAMES = ['atlas-chat.db', 'cheapchat.db'];
const LEGACY_USER_DATA_DIRECTORIES = ['Atlas', 'CheapChat', 'cheapchat'];

app.setName(APP_NAME);

// Custom schemes must be declared before the app is ready. `atlas-site` gives
// previewed sites their own secure origin instead of loading them over file://.
registerSitePreviewScheme();

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

app.whenReady().then(async () => {
  const icon = getDockIcon();
  if (icon && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon);
  }

  const attachmentStore = new AttachmentStore(await resolveAttachmentDirectory());
  const database = createAppDatabase(await resolveDatabasePath(), attachmentStore);
  const toolStateStore = new ToolStateStore(database.toolExecutions);
  const interruptedMessageIds = toolStateStore.reconcileInterrupted();
  const interruptedRuntimeSessions = database.runtimeState.reconcileInterruptedSessions();
  database.conversations.markMessagesError(interruptedMessageIds, 'interrupted');
  database.conversations.markMessagesError(
    interruptedRuntimeSessions.map((session) => session.assistantMessageId),
    'interrupted',
  );
  const keychain = new KeychainStore();
  const updateService = new UpdateService();
  // Every provider is user-configured; the registry starts empty and is filled
  // from the database by CustomProviderService below.
  const providers: ProviderRegistry = new Map<ProviderAdapter['providerId'], ProviderAdapter>();

  // Upgrade path: convert the former built-in providers into ordinary entries.
  await migrateLegacyBuiltInProviders({
    customProvidersRepo: database.customProviders,
    modelsRepo: database.models,
    settingsRepo: database.settings,
    keychain,
    remapConversationProvider: (from, to) => database.conversations.remapProviderId(from, to)
  }).catch(() => undefined);

  const modelRegistry = new ModelRegistry(
    database.models,
    database.settings,
    keychain,
    providers,
    database.customProviders
  );

  const customProviderService = new CustomProviderService({
    repo: database.customProviders,
    modelsRepo: database.models,
    settingsRepo: database.settings,
    keychain,
    registry: providers,
    // A configuration change can add, remove or re-point models, so the catalog
    // is rebuilt rather than left showing endpoints that no longer exist.
    onProvidersChanged: async () => {
      await modelRegistry.refresh().catch(() => undefined);
    }
  });

  // Adapters for providers saved in a previous session.
  await customProviderService.syncRegistry();
  // Drop cached models left behind by providers that no longer exist, so the
  // catalog does not carry entries nothing can serve.
  database.models.deleteOrphanedModels();

  const siteFileStore = new SiteFileStore(await resolveSitesDirectory());
  const siteService = new SiteService(database.sites, siteFileStore);
  const sitePreviewHost = new SitePreviewHost(siteService, siteFileStore);
  const siteExporter = new SiteExporter(siteService);
  sitePreviewHost.registerProtocolHandler();

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
      undefined,
      ({ conversationId, mentions }) => {
        const optedIn = shouldLoadSiteTools({
          mentions,
          hasExistingSite: database.sites.hasSiteForConversation(conversationId),
        });
        return optedIn ? createSiteTools(siteService, sitePreviewHost, conversationId) : null;
      },
    ),
    database.runtimeState,
    toolStateStore,
  );

  registerSettingsIpc({
    settingsRepo: database.settings,
    modelRegistry,
    keychain
  });
  registerModelsIpc(modelRegistry);
  registerProvidersIpc(customProviderService);
  registerConversationsIpc(database.conversations);
  registerChatIpc(chatEngine);
  registerDiagnosticsIpc(database.conversations);
  registerUpdatesIpc(updateService);
  registerVisualsIpc(database.visuals);
  registerSitesIpc({ service: siteService, previewHost: sitePreviewHost, exporter: siteExporter });

  ipcMain.handle(IPC_CHANNELS.posthogGetAnonymousId, () => {
    return getAnonymousId();
  });

  ipcMain.handle(IPC_CHANNELS.posthogCaptureEvent, (_event: Electron.IpcMainInvokeEvent, eventName: string, properties?: Record<string, unknown>) => {
    capturePostHogEvent(eventName, properties);
  });

  ipcMain.handle(IPC_CHANNELS.posthogGetTelemetryEnabled, () => {
    return getTelemetryEnabled();
  });

  ipcMain.handle(IPC_CHANNELS.posthogSetTelemetryEnabled, (_event: Electron.IpcMainInvokeEvent, enabled: boolean) => {
    return setTelemetryEnabled(enabled);
  });

  const window = createWindow();
  captureFirstLaunchIfNeeded();
  window.once('show', () => {
    updateService.start();
    capturePostHogEvent(POSTHOG_EVENTS.APP_LAUNCHED);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  void shutdownPostHog();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
