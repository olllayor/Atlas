import { randomUUID } from 'node:crypto';

import type { ProviderId } from '../../../shared/contracts';
import type {
  CreateCustomProviderRequest,
  CustomProvider,
  DiscoverCustomProviderModelsRequest,
  DiscoveredModel,
  SetCustomProviderModelsRequest,
  UpdateCustomProviderRequest
} from '../../../shared/customProviders';
import {
  CustomProviderValidationError,
  buildCustomProviderId,
  normalizeBaseUrl,
  normalizeModelInputs,
  normalizeProviderName
} from '../../../shared/customProviders';
import type { ProviderPreset } from '../catalog/modelsDev';
import { ModelsDevCatalog } from '../catalog/modelsDev';
import type { CustomProvidersRepo, CustomProviderRecord } from '../../db/repositories/customProvidersRepo';
import type { ModelsRepo } from '../../db/repositories/modelsRepo';
import type { SettingsRepo } from '../../db/repositories/settingsRepo';
import type { KeychainStore } from '../../secrets/keychain';
import {
  CustomProviderAdapter,
  discoverCustomProviderModels,
  validateCustomProviderCredential
} from '../providers/customProvider';
import type { ProviderRegistry } from './providerRegistry';

export type CustomProviderServiceDeps = {
  repo: CustomProvidersRepo;
  modelsRepo: ModelsRepo;
  settingsRepo: SettingsRepo;
  keychain: KeychainStore;
  registry: ProviderRegistry;
  /** Invoked after any change so callers can refresh the model catalog. */
  onProvidersChanged?: () => void | Promise<void>;
  /** models.dev lookup used to fill in capabilities an endpoint cannot report. */
  modelsDev?: ModelsDevCatalog;
};

/**
 * Owns the lifecycle of user-configured providers: persistence, secret storage,
 * and keeping the live provider registry in step with the database.
 */
export class CustomProviderService {
  private readonly modelsDev: ModelsDevCatalog;

  constructor(private readonly deps: CustomProviderServiceDeps) {
    this.modelsDev = deps.modelsDev ?? new ModelsDevCatalog();
  }

  /** Known providers from models.dev, so users need not hunt for a base URL. */
  async listPresets(): Promise<ProviderPreset[]> {
    return this.modelsDev.listProviderPresets();
  }

  /** Rebuilds every custom adapter from the database. Safe to call repeatedly. */
  async syncRegistry() {
    const records = this.deps.repo.list();
    const wanted = new Set(records.map((record) => record.id));

    for (const [providerId, adapter] of this.deps.registry) {
      if (adapter instanceof CustomProviderAdapter && !wanted.has(providerId)) {
        this.deps.registry.delete(providerId);
      }
    }

    for (const record of records) {
      // A disabled provider stays configured but must not be selectable.
      if (!record.enabled) {
        this.deps.registry.delete(record.id);
        continue;
      }

      const hasApiKey = Boolean(await this.deps.keychain.getSecret(record.id));
      this.deps.registry.set(record.id, new CustomProviderAdapter({ ...record, hasApiKey }));
    }

    for (const record of records) {
      this.deps.settingsRepo.syncSecretPresence(record.id, Boolean(await this.deps.keychain.getSecret(record.id)));
    }
  }

  async list(): Promise<CustomProvider[]> {
    return Promise.all(this.deps.repo.list().map((record) => this.decorate(record)));
  }

  async create(request: CreateCustomProviderRequest): Promise<CustomProvider> {
    const name = normalizeProviderName(request.name);
    const baseUrl = normalizeBaseUrl(request.baseUrl);
    const models = normalizeModelInputs(request.models ?? []);
    const apiKey = request.apiKey?.trim();

    this.assertUniqueName(name, null);

    const providerId = buildCustomProviderId(randomUUID());

    if (apiKey) {
      await this.deps.keychain.setSecret(providerId, apiKey);
    }

    try {
      const record = this.deps.repo.create({
        id: providerId,
        name,
        baseUrl,
        apiFormat: request.apiFormat,
        models
      });

      this.deps.settingsRepo.syncSecretPresence(providerId, Boolean(apiKey));
      await this.afterChange();

      return this.decorate(record);
    } catch (error) {
      // Do not leave an orphaned secret behind for a provider that never saved.
      if (apiKey) {
        await this.deps.keychain.deleteSecret(providerId).catch(() => undefined);
      }

      throw error;
    }
  }

  async update(request: UpdateCustomProviderRequest): Promise<CustomProvider> {
    const existing = this.requireRecord(request.providerId);

    const name = request.name === undefined ? undefined : normalizeProviderName(request.name);
    const baseUrl = request.baseUrl === undefined ? undefined : normalizeBaseUrl(request.baseUrl);

    if (name) {
      this.assertUniqueName(name, existing.id);
    }

    if (request.apiKey !== undefined) {
      const trimmed = request.apiKey.trim();
      if (!trimmed) {
        throw new CustomProviderValidationError('API keys cannot be empty.', 'apiKey');
      }

      await this.deps.keychain.setSecret(existing.id, trimmed);
      this.deps.settingsRepo.updateCredentialStatus(existing.id, {
        hasSecret: true,
        // A changed key has not been proven to work yet.
        status: 'unknown',
        validatedAt: null
      });
    }

    const record = this.deps.repo.update(existing.id, {
      name,
      baseUrl,
      apiFormat: request.apiFormat,
      enabled: request.enabled
    });

    await this.afterChange();

    return this.decorate(record);
  }

  async setModels(request: SetCustomProviderModelsRequest): Promise<CustomProvider> {
    const existing = this.requireRecord(request.providerId);
    const models = normalizeModelInputs(request.models);
    const record = this.deps.repo.setModels(existing.id, models);

    await this.afterChange();

    return this.decorate(record);
  }

  async delete(providerId: ProviderId) {
    const existing = this.requireRecord(providerId);

    this.deps.repo.delete(existing.id);
    this.deps.modelsRepo.deleteByProvider(existing.id);
    this.deps.settingsRepo.deleteCredential(existing.id);
    this.deps.registry.delete(existing.id);
    await this.deps.keychain.deleteSecret(existing.id).catch(() => undefined);

    await this.afterChange();
  }

  async discoverModels(request: DiscoverCustomProviderModelsRequest): Promise<DiscoveredModel[]> {
    const probe = await this.resolveProbe(request);
    const discovered = await discoverCustomProviderModels(probe);

    // An OpenAI-compatible list is only ids. models.dev supplies the context
    // window, output ceiling, modalities and reasoning support behind them.
    return this.modelsDev.enrich(discovered, inferModelsDevProviderId(probe.baseUrl));
  }

  async testConnection(request: DiscoverCustomProviderModelsRequest) {
    await validateCustomProviderCredential(await this.resolveProbe(request));
  }

  /**
   * Resolves a probe from either a saved provider or the unsaved values in the
   * add-provider form, so the form can be tested before it is committed.
   */
  private async resolveProbe(request: DiscoverCustomProviderModelsRequest) {
    const saved = request.providerId ? this.requireRecord(request.providerId) : null;

    const baseUrl = normalizeBaseUrl(request.baseUrl ?? saved?.baseUrl ?? '');
    const apiFormat = request.apiFormat ?? saved?.apiFormat;
    if (!apiFormat) {
      throw new CustomProviderValidationError('Choose an API format first.', 'apiFormat');
    }

    const apiKey = request.apiKey?.trim() || (saved ? await this.deps.keychain.getSecret(saved.id) : null);
    if (!apiKey) {
      throw new CustomProviderValidationError('Enter an API key first.', 'apiKey');
    }

    return { baseUrl, apiFormat, apiKey };
  }

  private requireRecord(providerId: ProviderId): CustomProviderRecord {
    const record = this.deps.repo.getById(providerId);
    if (!record) {
      throw new Error('That provider no longer exists.');
    }

    return record;
  }

  private assertUniqueName(name: string, exceptId: ProviderId | null) {
    const clash = this.deps.repo
      .list()
      .some((provider) => provider.id !== exceptId && provider.name.toLowerCase() === name.toLowerCase());

    if (clash) {
      throw new CustomProviderValidationError('Another provider already uses that name.', 'name');
    }
  }

  private async decorate(record: CustomProviderRecord): Promise<CustomProvider> {
    return { ...record, hasApiKey: Boolean(await this.deps.keychain.getSecret(record.id)) };
  }

  private async afterChange() {
    await this.syncRegistry();
    await this.deps.onProvidersChanged?.();
  }
}

/**
 * Guesses the models.dev provider id from a base URL so capability lookups
 * prefer the right provider's entry. A miss just widens the search.
 */
function inferModelsDevProviderId(baseUrl: string): string | null {
  try {
    const host = new URL(baseUrl).hostname.replace(/^www\./, '');
    const [label] = host.split('.');
    return label || null;
  } catch {
    return null;
  }
}
