import type { ListModelsOptions, SettingsSummary } from '../../../shared/contracts';
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
    private readonly provider: ProviderAdapter
  ) {}

  list(options: ListModelsOptions = {}) {
    return this.modelsRepo.list(options);
  }

  async refresh() {
    const apiKey = await this.keychain.getSecret('openrouter');

    if (!apiKey) {
      throw new Error('Add an OpenRouter API key in settings before refreshing models.');
    }

    try {
      const models = await this.provider.listModels(apiKey);
      const validatedAt = new Date().toISOString();

      this.modelsRepo.upsertModels(models);
      this.settingsRepo.updateCredentialStatus('openrouter', {
        hasSecret: true,
        status: 'valid',
        validatedAt
      });

      return this.modelsRepo.list();
    } catch (error) {
      const normalized = normalizeError(error);

      if (normalized.code === 'auth_error') {
        this.settingsRepo.updateCredentialStatus('openrouter', {
          hasSecret: true,
          status: 'invalid',
          validatedAt: null
        });
      }

      throw error;
    }
  }

  async validateOpenRouterKey() {
    const apiKey = await this.keychain.getSecret('openrouter');

    if (!apiKey) {
      this.settingsRepo.updateCredentialStatus('openrouter', {
        hasSecret: false,
        status: 'missing',
        validatedAt: null
      });
      throw new Error('Save an OpenRouter API key first.');
    }

    await this.provider.validateCredential(apiKey);
    this.settingsRepo.updateCredentialStatus('openrouter', {
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
