import { join } from 'node:path';
import { BrowserWindow, app } from 'electron/main';

import { ChatEngine } from './ai/core/ChatEngine';
import { ModelRegistry } from './ai/core/ModelRegistry';
import { OpenRouterProvider } from './ai/providers/openrouter';
import { OpenAIProvider } from './ai/providers/openai';
import { GeminiProvider } from './ai/providers/gemini';
import { AnthropicProvider } from './ai/providers/anthropic';
import type { ProviderId } from '../shared/contracts';
import type { ProviderAdapter } from './ai/core/ProviderAdapter';
import { createWindow } from './bootstrap/createWindow';
import { getAppIcon } from './bootstrap/iconPath';
import { createAppDatabase } from './db/client';
import { registerChatIpc } from './ipc/chat';
import { registerConversationsIpc } from './ipc/conversations';
import { registerModelsIpc } from './ipc/models';
import { registerSettingsIpc } from './ipc/settings';
import { KeychainStore } from './secrets/keychain';

app.setName('CheapChat');

app.whenReady().then(async () => {
  const icon = getAppIcon();
  if (icon && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon);
  }

  const database = createAppDatabase(join(app.getPath('userData'), 'cheapchat.db'));
  const keychain = new KeychainStore();

  const providers = new Map<ProviderId, ProviderAdapter>([
    ['openrouter', new OpenRouterProvider()],
    ['openai', new OpenAIProvider()],
    ['gemini', new GeminiProvider()],
    ['anthropic', new AnthropicProvider()]
  ]);

  for (const [providerId] of providers) {
    database.settings.syncSecretPresence(providerId, Boolean(await keychain.getSecret(providerId)));
  }

  const modelRegistry = new ModelRegistry(database.models, database.settings, keychain, providers);
  const chatEngine = new ChatEngine(database.conversations, keychain, providers);

  registerSettingsIpc({
    settingsRepo: database.settings,
    modelRegistry,
    keychain
  });
  registerModelsIpc(modelRegistry);
  registerConversationsIpc(database.conversations);
  registerChatIpc(chatEngine);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
