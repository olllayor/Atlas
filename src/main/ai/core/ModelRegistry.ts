import type { ListModelsOptions, ModelSummary, ProviderId, SettingsSummary } from '../../../shared/contracts';
import type { ModelsRepo } from '../../db/repositories/modelsRepo';
import type { SettingsRepo } from '../../db/repositories/settingsRepo';
import type { KeychainStore } from '../../secrets/keychain';
import { normalizeError } from './ErrorNormalizer';
import type { ProviderAdapter } from './ProviderAdapter';

export class ModelRegistry {
  constructor(
    private readonly modelsRepo: ModelsRepo,
    private readonly settingsRepo: SettingsRepo,
    private readonly keychain: KeychainStore,
    private readonly providers: Map<ProviderId, ProviderAdapter>
  ) {}

  list(options: ListModelsOptions = {}) {
    return this.modelsRepo.list(options);
  }

  async refresh() {
    const results: ModelSummary[] = [];

    for (const [providerId, provider] of this.providers) {
      const apiKey = await this.keychain.getSecret(providerId);
      if (!apiKey) continue;

      try {
        const models = await provider.listModels(apiKey);
        const validatedAt = new Date().toISOString();

        this.modelsRepo.upsertModels(models);
        this.settingsRepo.updateCredentialStatus(providerId, {
          hasSecret: true,
          status: 'valid',
          validatedAt
        });

        results.push(...models);
      } catch (error) {
        const normalized = normalizeError(error);

        if (normalized.code === 'auth_error') {
          this.settingsRepo.updateCredentialStatus(providerId, {
            hasSecret: true,
            status: 'invalid',
            validatedAt: null
          });
        }
      }
    }

    return results.length > 0 ? results : this.modelsRepo.list();
  }

  async refreshProvider(providerId: ProviderId) {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const apiKey = await this.keychain.getSecret(providerId);
    if (!apiKey) {
      throw new Error(`Add a ${providerId} API key in settings before refreshing models.`);
    }

    try {
      const models = await provider.listModels(apiKey);
      const validatedAt = new Date().toISOString();

      this.modelsRepo.upsertModels(models);
      this.settingsRepo.updateCredentialStatus(providerId, {
        hasSecret: true,
        status: 'valid',
        validatedAt
      });

      return this.modelsRepo.list();
    } catch (error) {
      const normalized = normalizeError(error);

      if (normalized.code === 'auth_error') {
        this.settingsRepo.updateCredentialStatus(providerId, {
          hasSecret: true,
          status: 'invalid',
          validatedAt: null
        });
      }

      throw error;
    }
  }

  async validateProviderKey(providerId: ProviderId) {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const apiKey = await this.keychain.getSecret(providerId);

    if (!apiKey) {
      this.settingsRepo.updateCredentialStatus(providerId, {
        hasSecret: false,
        status: 'missing',
        validatedAt: null
      });
      throw new Error(`Save a ${providerId} API key first.`);
    }

    await provider.validateCredential(apiKey);
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
      showFreeOnlyByDefault: this.settingsRepo.getShowFreeOnlyByDefault(),
      modelCatalogLastSyncedAt: catalog.lastSyncedAt,
      modelCatalogStale: !catalog.lastSyncedAt || Date.now() - lastSyncedAt > staleThreshold,
      modelCatalogCount: catalog.count
    };
  }
}
