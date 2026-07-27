import type { ListModelsOptions, ProviderId, SettingsSummary } from '../../../shared/contracts';
import type { CustomProvider } from '../../../shared/customProviders';
import type { CustomProvidersRepo } from '../../db/repositories/customProvidersRepo';
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
    private readonly providers: ProviderRegistry,
    /**
     * Read lazily so a provider added at runtime shows up without rebuilding
     * the registry object graph.
     */
    private readonly customProvidersRepo: Pick<CustomProvidersRepo, 'list'> | null = null
  ) {}

  /**
   * The catalog the app is allowed to offer. Always scoped to configured,
   * enabled providers: the cache outlives providers, so a removed or disabled
   * endpoint would otherwise keep offering models that cannot be sent to.
   */
  list(options: ListModelsOptions = {}) {
    return this.modelsRepo.list({ ...options, configuredOnly: true });
  }

  /** Every registered provider, in the order they were configured. */
  private providerIds(): ProviderId[] {
    return [...this.providers.keys()];
  }

  async refresh() {
    let refreshedAny = false;
    let sawProviderFailure = false;

    // Providers are independent, so fetch every catalog concurrently instead of
    // paying the sum of their round trips.
    const fetches = this.providerIds().map(async (providerId) => {
      const provider = this.providers.get(providerId);
      if (!provider) {
        return null;
      }

      const apiKey = await this.keychain.getSecret(providerId);
      // Adapters opt into needing a key; this used to be a hardcoded exception
      // for one provider id.
      if (!apiKey && provider.capabilities?.requiresApiKeyForCatalog === true) {
        return null;
      }

      try {
        return { providerId, provider, apiKey, models: await provider.listModels(apiKey) } as const;
      } catch (error) {
        return { providerId, provider, apiKey, error } as const;
      }
    });

    const outcomes = await Promise.all(fetches);

    // Writes stay sequential so the SQLite transactions do not interleave.
    for (const outcome of outcomes) {
      if (!outcome) {
        continue;
      }

      const { providerId, provider, apiKey } = outcome;

      if ('error' in outcome) {
        sawProviderFailure = true;
        const normalized = normalizeError(outcome.error);
        if (normalized.code === 'auth_error' && apiKey) {
          this.settingsRepo.updateCredentialStatus(providerId, {
            hasSecret: true,
            status: 'invalid',
            validatedAt: null
          });
        }
        continue;
      }

      this.modelsRepo.upsertModels(outcome.models, {
        // Only archive stale rows when the adapter vouches for a full catalog.
        pruneProviderId: provider.capabilities?.returnsCompleteCatalog ? providerId : undefined
      });
      refreshedAny = true;

      if (apiKey) {
        this.settingsRepo.updateCredentialStatus(providerId, {
          hasSecret: true,
          status: 'valid',
          validatedAt: new Date().toISOString()
        });
      }
    }

    // A provider removed since the last refresh leaves rows behind.
    this.modelsRepo.deleteOrphanedModels();

    if (refreshedAny) {
      return this.list();
    }

    const cachedModels = this.list({ allowStale: true });
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
    const customRecords = this.customProvidersRepo?.list() ?? [];
    // Credentials cover every provider the app can address: those saved in the
    // database plus anything currently registered.
    const credentialIds = [
      ...new Set([...customRecords.map((record) => record.id), ...this.providerIds()])
    ];
    const credentials = this.settingsRepo.getProviderCredentials(credentialIds);
    const customProviders: CustomProvider[] = customRecords.map((record) => ({
      ...record,
      hasApiKey:
        credentials.find((credential) => credential.providerId === record.id)?.hasSecret ?? false
    }));
    const catalog = this.modelsRepo.getCatalogStats();
    const staleThreshold = 12 * 60 * 60 * 1000;
    const lastSyncedAt = catalog.lastSyncedAt ? Date.parse(catalog.lastSyncedAt) : 0;

    return {
      providers: credentials,
      customProviders,
      defaultProviderId:
        credentials.find((provider) => provider.hasSecret)?.providerId ??
        this.providerIds().find((providerId) => this.providers.has(providerId)) ??
        null,
      appearance: {
        themeMode: this.settingsRepo.getThemeMode(),
        designTheme: this.settingsRepo.getDesignTheme(),
        uiFontSize: this.settingsRepo.getUiFontSize(),
        codeFontSize: this.settingsRepo.getCodeFontSize(),
        uiFontFamily: this.settingsRepo.getUiFontFamily(),
        codeFontFamily: this.settingsRepo.getCodeFontFamily(),
        borderRadius: this.settingsRepo.getBorderRadius(),
      },
      keyboard: {
        keybindings: this.settingsRepo.getKeybindings()
      },
      chat: {
        reasoningEffort: this.settingsRepo.getReasoningEffort(),
        toolPermissionMode: this.settingsRepo.getToolPermissionMode()
      },
      showFreeOnlyByDefault: this.settingsRepo.getShowFreeOnlyByDefault(),
      modelCatalogLastSyncedAt: catalog.lastSyncedAt,
      modelCatalogStale: !catalog.lastSyncedAt || Date.now() - lastSyncedAt > staleThreshold,
      modelCatalogCount: catalog.count
    };
  }
}
