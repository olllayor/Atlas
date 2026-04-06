import { access, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow, app, ipcMain } from 'electron/main';

import { ChatEngine } from './ai/core/ChatEngine';
import { ModelRegistry } from './ai/core/ModelRegistry';
import type { ProviderAdapter } from './ai/core/ProviderAdapter';
import type { ProviderRegistry } from './ai/core/providerRegistry';
import { AttachmentStore } from './attachments/AttachmentStore';
import { GlmProvider } from './ai/providers/glm';
import { OpenRouterProvider } from './ai/providers/openrouter';
import { createWindow } from './bootstrap/createWindow';
import { getDockIcon } from './bootstrap/iconPath';
import { createAppDatabase } from './db/client';
import { registerDiagnosticsIpc } from './ipc/diagnostics';
import { registerChatIpc } from './ipc/chat';
import { registerConversationsIpc } from './ipc/conversations';
import { registerModelsIpc } from './ipc/models';
import { registerSettingsIpc } from './ipc/settings';
import { registerUpdatesIpc } from './ipc/updates';
import { registerVisualsIpc } from './ipc/visuals';
import { KeychainStore } from './secrets/keychain';
import { UpdateService } from './updates/UpdateService';
import { capturePostHogEvent, getAnonymousId, shutdownPostHog } from './analytics/PostHogClient';
import { IPC_CHANNELS } from '../shared/ipc';
import { POSTHOG_EVENTS } from '../shared/posthog';

const APP_NAME = 'Atlas';
const DATABASE_FILENAME = 'atlas-chat.db';
const LEGACY_DATABASE_FILENAMES = ['atlas-chat.db', 'cheapchat.db'];
const LEGACY_USER_DATA_DIRECTORIES = ['Atlas', 'CheapChat', 'cheapchat'];

app.setName(APP_NAME);

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

app.whenReady().then(async () => {
  const icon = getDockIcon();
  if (icon && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon);
  }

  const attachmentStore = new AttachmentStore(await resolveAttachmentDirectory());
  const database = createAppDatabase(await resolveDatabasePath(), attachmentStore);
  const keychain = new KeychainStore();
  const openRouter = new OpenRouterProvider();
  const glm = new GlmProvider();
  const updateService = new UpdateService();
  const providers: ProviderRegistry = new Map<ProviderAdapter['providerId'], ProviderAdapter>([
    [openRouter.providerId, openRouter],
    [glm.providerId, glm]
  ]);

  for (const providerId of providers.keys()) {
    database.settings.syncSecretPresence(providerId, Boolean(await keychain.getSecret(providerId)));
  }

  const modelRegistry = new ModelRegistry(database.models, database.settings, keychain, providers);
  const chatEngine = new ChatEngine(database.conversations, database.models, keychain, providers, attachmentStore);

  registerSettingsIpc({
    settingsRepo: database.settings,
    modelRegistry,
    keychain
  });
  registerModelsIpc(modelRegistry);
  registerConversationsIpc(database.conversations);
  registerChatIpc(chatEngine);
  registerDiagnosticsIpc(database.conversations);
  registerUpdatesIpc(updateService);
  registerVisualsIpc(database.visuals);

  ipcMain.handle(IPC_CHANNELS.posthogGetAnonymousId, () => {
    return getAnonymousId();
  });

  ipcMain.handle(IPC_CHANNELS.posthogCaptureEvent, (_event: Electron.IpcMainInvokeEvent, eventName: string, properties?: Record<string, unknown>) => {
    capturePostHogEvent(eventName, properties);
  });

  const window = createWindow();
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
