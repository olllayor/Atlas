import type { ListModelsOptions, ProviderId, SettingsSummary } from '../../../shared/contracts';
import { PROVIDER_ORDER } from '../../../shared/providerMetadata';
import type { ModelsRepo } from '../../db/repositories/modelsRepo';
import type { SettingsRepo } from '../../db/repositories/settingsRepo';
import type { KeychainStore } from '../../secrets/keychain';
import { normalizeError } from './ErrorNormalizer';
import type { ProviderRegistry } from './providerRegistry';
import { getProviderOrThrow } from './providerRegistry';

export class ModelRegistry {
  constructor(
    private readonly modelsRepo: ModelsRepo,
    private readonly settingsRepo: SettingsRepo,
    private readonly keychain: KeychainStore,
    private readonly providers: ProviderRegistry
  ) {}

  list(options: ListModelsOptions = {}) {
    return this.modelsRepo.list(options);
  }

  async refresh() {
    let refreshedAny = false;
    let sawProviderFailure = false;

    for (const providerId of PROVIDER_ORDER) {
      const provider = this.providers.get(providerId);
      if (!provider) {
        continue;
      }

      const apiKey = await this.keychain.getSecret(providerId);
      if (!apiKey && providerId !== 'glm') {
        continue;
      }

      try {
        const models = await provider.listModels(apiKey);
        this.modelsRepo.upsertModels(models);
        refreshedAny = true;

        if (apiKey) {
          this.settingsRepo.updateCredentialStatus(providerId, {
            hasSecret: true,
            status: 'valid',
            validatedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        sawProviderFailure = true;
        const normalized = normalizeError(error);
        if (normalized.code === 'auth_error' && apiKey) {
          this.settingsRepo.updateCredentialStatus(providerId, {
            hasSecret: true,
            status: 'invalid',
            validatedAt: null
          });
        }
      }
    }

    if (refreshedAny) {
      return this.modelsRepo.list();
    }

    const cachedModels = this.modelsRepo.list({ allowStale: true });
    if (cachedModels.length > 0 && sawProviderFailure) {
      return cachedModels;
    }

    if (!refreshedAny) {
      throw new Error('Add a provider API key in settings before refreshing models.');
    }
  }

  async validateProviderKey(providerId: ProviderId, secretOverride?: string) {
    const provider = getProviderOrThrow(this.providers, providerId);
    const override = secretOverride?.trim();
    const apiKey = override || (await this.keychain.getSecret(providerId));

    if (!apiKey) {
      this.settingsRepo.updateCredentialStatus(providerId, {
        hasSecret: false,
        status: 'missing',
        validatedAt: null
      });
      throw new Error('Save an API key first.');
    }

    await provider.validateCredential(apiKey);
    if (override) {
      await this.keychain.setSecret(providerId, apiKey);
    }
    this.settingsRepo.updateCredentialStatus(providerId, {
      hasSecret: true,
      status: 'valid',
      validatedAt: new Date().toISOString()
    });
  }

  getSettingsSummary(): SettingsSummary {
    const credentials = this.settingsRepo.getProviderCredentials();
    const catalog = this.modelsRepo.getCatalogStats();
    const staleThreshold = 12 * 60 * 60 * 1000;
    const lastSyncedAt = catalog.lastSyncedAt ? Date.parse(catalog.lastSyncedAt) : 0;

    return {
      providers: credentials,
      defaultProviderId:
        credentials.find((provider) => provider.hasSecret)?.providerId ??
        PROVIDER_ORDER.find((providerId) => this.providers.has(providerId)) ??
        null,
      appearance: {
        themeMode: this.settingsRepo.getThemeMode()
      },
      keyboard: {
        keybindings: this.settingsRepo.getKeybindings()
      },
      showFreeOnlyByDefault: this.settingsRepo.getShowFreeOnlyByDefault(),
      modelCatalogLastSyncedAt: catalog.lastSyncedAt,
      modelCatalogStale: !catalog.lastSyncedAt || Date.now() - lastSyncedAt > staleThreshold,
      modelCatalogCount: catalog.count
    };
  }
}
