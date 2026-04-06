import { ipcMain } from 'electron/main';

import { IPC_CHANNELS } from '../../shared/ipc';
import type { ProviderId, SettingsUpdateRequest } from '../../shared/contracts';
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

  ipcMain.handle(IPC_CHANNELS.settingsSaveProviderKey, async (event, providerId: ProviderId, secret: string) => {
    assertTrustedSender(event);

    const trimmed = secret.trim();
    if (!trimmed) {
      throw new Error('Provider API key cannot be empty.');
    }

    await keychain.setSecret(providerId, trimmed);
    settingsRepo.updateCredentialStatus(providerId, {
      hasSecret: true,
      status: 'unknown',
      validatedAt: null
    });

    return modelRegistry.getSettingsSummary();
  });

  ipcMain.handle(IPC_CHANNELS.settingsValidateProviderKey, async (event, providerId: ProviderId, secret?: string) => {
    assertTrustedSender(event);
    await modelRegistry.validateProviderKey(providerId, secret);
    return modelRegistry.getSettingsSummary();
  });

  ipcMain.handle(
    IPC_CHANNELS.settingsUpdatePreferences,
    (event, patch: SettingsUpdateRequest) => {
      assertTrustedSender(event);
      const appearancePatch = patch?.appearance;

      if (typeof patch?.showFreeOnlyByDefault === 'boolean') {
        settingsRepo.setShowFreeOnlyByDefault(patch.showFreeOnlyByDefault);
      }

      if (appearancePatch?.themeMode) {
        settingsRepo.setThemeMode(appearancePatch.themeMode);
      }

      if (appearancePatch?.designTheme) {
        settingsRepo.setDesignTheme(appearancePatch.designTheme);
      }

      if (typeof appearancePatch?.uiFontSize === 'number') {
        settingsRepo.setUiFontSize(appearancePatch.uiFontSize);
      }

      if (typeof appearancePatch?.codeFontSize === 'number') {
        settingsRepo.setCodeFontSize(appearancePatch.codeFontSize);
      }

      if (appearancePatch && 'uiFontFamily' in appearancePatch) {
        settingsRepo.setUiFontFamily(appearancePatch.uiFontFamily ?? null);
      }

      if (appearancePatch && 'codeFontFamily' in appearancePatch) {
        settingsRepo.setCodeFontFamily(appearancePatch.codeFontFamily ?? null);
      }

      if (patch?.keyboard?.keybindings) {
        settingsRepo.setKeybindings(patch.keyboard.keybindings);
      }

      return modelRegistry.getSettingsSummary();
    }
  );
}
