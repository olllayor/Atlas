import { ipcMain } from 'electron/main';

import { IPC_CHANNELS } from '../../shared/ipc';
import type { ModelRegistry } from '../ai/core/ModelRegistry';
import type { SettingsRepo } from '../db/repositories/settingsRepo';
import type { KeychainStore } from '../secrets/keychain';
import { assertTrustedSender } from './security';

type SettingsIpcDeps = {
  settingsRepo: SettingsRepo;
  modelRegistry: ModelRegistry;
  keychain: KeychainStore;
};

export function registerSettingsIpc({ settingsRepo, modelRegistry, keychain }: SettingsIpcDeps) {
  ipcMain.handle(IPC_CHANNELS.settingsGetSummary, (event) => {
    assertTrustedSender(event);
    return modelRegistry.getSettingsSummary();
  });

  ipcMain.handle(IPC_CHANNELS.settingsSaveOpenRouterKey, async (event, secret: string) => {
    assertTrustedSender(event);

    const trimmed = secret.trim();
    if (!trimmed) {
      throw new Error('OpenRouter API key cannot be empty.');
    }

    await keychain.setSecret('openrouter', trimmed);
    settingsRepo.updateCredentialStatus('openrouter', {
      hasSecret: true,
      status: 'unknown',
      validatedAt: null
    });

    return modelRegistry.getSettingsSummary();
  });

  ipcMain.handle(IPC_CHANNELS.settingsValidateOpenRouterKey, async (event) => {
    assertTrustedSender(event);
    await modelRegistry.validateOpenRouterKey();
    return modelRegistry.getSettingsSummary();
  });

  ipcMain.handle(
    IPC_CHANNELS.settingsUpdatePreferences,
    (event, patch: { showFreeOnlyByDefault?: boolean }) => {
      assertTrustedSender(event);

      if (typeof patch?.showFreeOnlyByDefault === 'boolean') {
        settingsRepo.setShowFreeOnlyByDefault(patch.showFreeOnlyByDefault);
      }

      return modelRegistry.getSettingsSummary();
    }
  );
}
