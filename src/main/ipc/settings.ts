import { ipcMain } from 'electron/main';

import type { ProviderId } from '../../shared/contracts';
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

const PROVIDER_CONFIGS: Array<{
  saveChannel: string;
  validateChannel: string;
  providerId: ProviderId;
  label: string;
}> = [
  {
    saveChannel: IPC_CHANNELS.settingsSaveOpenRouterKey,
    validateChannel: IPC_CHANNELS.settingsValidateOpenRouterKey,
    providerId: 'openrouter',
    label: 'OpenRouter'
  },
  {
    saveChannel: IPC_CHANNELS.settingsSaveOpenAiKey,
    validateChannel: IPC_CHANNELS.settingsValidateOpenAiKey,
    providerId: 'openai',
    label: 'OpenAI'
  },
  {
    saveChannel: IPC_CHANNELS.settingsSaveGeminiKey,
    validateChannel: IPC_CHANNELS.settingsValidateGeminiKey,
    providerId: 'gemini',
    label: 'Gemini'
  },
  {
    saveChannel: IPC_CHANNELS.settingsSaveAnthropicKey,
    validateChannel: IPC_CHANNELS.settingsValidateAnthropicKey,
    providerId: 'anthropic',
    label: 'Anthropic'
  }
];

export function registerSettingsIpc({ settingsRepo, modelRegistry, keychain }: SettingsIpcDeps) {
  ipcMain.handle(IPC_CHANNELS.settingsGetSummary, (event) => {
    assertTrustedSender(event);
    return modelRegistry.getSettingsSummary();
  });

  for (const config of PROVIDER_CONFIGS) {
    ipcMain.handle(config.saveChannel, async (event, secret: string) => {
      assertTrustedSender(event);

      const trimmed = secret.trim();
      if (!trimmed) {
        throw new Error(`${config.label} API key cannot be empty.`);
      }

      await keychain.setSecret(config.providerId, trimmed);
      settingsRepo.updateCredentialStatus(config.providerId, {
        hasSecret: true,
        status: 'unknown',
        validatedAt: null
      });

      return modelRegistry.getSettingsSummary();
    });

    ipcMain.handle(config.validateChannel, async (event) => {
      assertTrustedSender(event);
      await modelRegistry.validateProviderKey(config.providerId);
      return modelRegistry.getSettingsSummary();
    });
  }

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
