import { randomUUID } from 'node:crypto';

import type { ProviderId } from '../../../shared/contracts';
import type {
  CreateCustomProviderRequest,
  CustomProvider,
  CustomProviderModel,
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
import type { RejectedCapability } from './ErrorNormalizer';
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

/**
 * Which stored flag a refusal writes to. Keyed by what the provider complained
 * about rather than by the field name, so the call site never has to know the
 * schema.
 */
const CAPABILITY_FIELDS = {
  image: 'supportsVision',
  document: 'supportsDocumentInput',
  tools: 'supportsTools',
} as const satisfies Record<RejectedCapability, keyof CustomProviderModel>;

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

  /**
   * Re-syncs saved custom models against models.dev.
   *
   * Two kinds of drift matter. Reasoning levels were simply not recorded before
   * the catalog carried them. Limits are worse: an OpenAI-compatible `/models`
   * list reports nothing but ids, so a context window that was typed by hand —
   * or copied from a catalog entry that has since been corrected — outlives the
   * fact it described, and every context reading downstream is scaled by it. A
   * saved `16384` against a model that actually takes a million tokens makes an
   * empty conversation read as a third of the window consumed.
   *
   * The catalog is authoritative for limits whenever it knows the model; a
   * model it does not know keeps exactly what was saved, which is the only
   * thing anyone can say about an endpoint models.dev has never seen.
   *
   * Best-effort by design: a models.dev outage just means the stale values stay
   * until the next launch, so failures are swallowed.
   */
  async backfillModelFacts() {
    const records = this.deps.repo.list();
    let changed = false;

    for (const record of records) {
      const providerHint = inferModelsDevProviderId(record.baseUrl);
      const updates = new Map<string, Partial<CustomProviderModel>>();

      for (const model of record.models) {
        const facts = await this.modelsDev.lookup(model.id, providerHint).catch(() => null);
        if (!facts) {
          continue;
        }

        const update: Partial<CustomProviderModel> = {};

        if (facts.contextWindow != null && facts.contextWindow !== model.contextWindow) {
          update.contextWindow = facts.contextWindow;
        }

        if (facts.maxOutputTokens != null && facts.maxOutputTokens !== model.maxOutputTokens) {
          update.maxOutputTokens = facts.maxOutputTokens;
        }

        // Modalities are filled, never overwritten. A stored value here is
        // either the catalog's own answer from a previous run or a rejection
        // this app watched happen, and the second one outranks the database.
        if (model.supportsVision == null && facts.supportsVision != null) {
          update.supportsVision = facts.supportsVision;
        }

        if (model.supportsDocumentInput == null && facts.supportsDocumentInput != null) {
          update.supportsDocumentInput = facts.supportsDocumentInput;
        }

        if (model.supportsTools == null && facts.supportsTools != null) {
          update.supportsTools = facts.supportsTools;
        }

        // Reasoning levels are only filled in, never overwritten: the menu is a
        // user-facing choice, and a model already carrying levels has nothing to
        // gain from being rewritten on every launch. Correcting the optimistic
        // `supportsReasoning` default is part of the same fill.
        if (
          model.supportsReasoning &&
          model.reasoningEfforts == null &&
          (facts.reasoningEfforts != null || !facts.supportsReasoning)
        ) {
          update.supportsReasoning = facts.supportsReasoning;
          update.reasoningEfforts = facts.reasoningEfforts;
        }

        if (Object.keys(update).length > 0) {
          updates.set(model.id, update);
        }
      }

      if (updates.size === 0) {
        continue;
      }

      this.deps.repo.setModels(
        record.id,
        record.models.map((model) => {
          const update = updates.get(model.id);
          return update ? { ...model, ...update } : model;
        })
      );
      changed = true;
    }

    if (changed) {
      await this.afterChange();
    }

    return changed;
  }

  /**
   * Record that a provider refused a capability for one model.
   *
   * Written to `custom_provider_models`, not just the cache: the cache is
   * rebuilt from the provider's configured list on every refresh, so a fact
   * recorded only there would survive until the next catalog sync and no
   * longer. `afterChange` rebuilds the catalog and tells the windows, which is
   * what makes the attach affordance disappear without a restart.
   *
   * Returns true when something changed, so a repeat rejection is not a write.
   */
  async recordCapabilityRejection(modelId: string, capability: RejectedCapability) {
    const field = CAPABILITY_FIELDS[capability];

    for (const record of this.deps.repo.list()) {
      const model = record.models.find((entry) => entry.id === modelId);
      if (!model || model[field] === false) {
        continue;
      }

      this.deps.repo.setModels(
        record.id,
        record.models.map((entry) => (entry.id === modelId ? { ...entry, [field]: false } : entry)),
      );
      await this.afterChange();
      return true;
    }

    return false;
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
