import type { ProviderId } from '../../../shared/contracts';
import type { CustomProviderApiFormat, CustomProviderModel } from '../../../shared/customProviders';
import { buildCustomProviderId } from '../../../shared/customProviders';
import type { CustomProvidersRepo } from '../../db/repositories/customProvidersRepo';
import type { ModelsRepo } from '../../db/repositories/modelsRepo';
import type { SettingsRepo } from '../../db/repositories/settingsRepo';
import type { KeychainStore } from '../../secrets/keychain';

/**
 * Atlas used to ship hard-wired OpenRouter and GLM adapters. They are gone:
 * every provider is now user-configured. Anyone upgrading still has a key in
 * the keychain and a conversation history pointing at `openrouter`/`glm`, so
 * this converts those into ordinary custom providers instead of stranding them.
 */

export type LegacyProviderSpec = {
  providerId: ProviderId;
  name: string;
  baseUrl: string;
  apiFormat: CustomProviderApiFormat;
};

export const LEGACY_BUILT_IN_PROVIDERS: LegacyProviderSpec[] = [
  {
    providerId: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiFormat: 'chat-completions'
  },
  {
    providerId: 'glm',
    name: 'GLM',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    apiFormat: 'chat-completions'
  }
];

export type LegacyMigrationResult = {
  /** Old provider id → new `custom:` id, for rewriting message history. */
  remapped: Map<ProviderId, ProviderId>;
  migratedProviderNames: string[];
};

export type LegacyMigrationDeps = {
  customProvidersRepo: CustomProvidersRepo;
  modelsRepo: ModelsRepo;
  settingsRepo: SettingsRepo;
  keychain: Pick<KeychainStore, 'getSecret' | 'setSecret' | 'deleteSecret'>;
  /** Rewrites stored messages so old conversations keep resolving a provider. */
  remapConversationProvider: (from: ProviderId, to: ProviderId) => void;
};

/**
 * Idempotent: a provider that has already been migrated is skipped, and a
 * legacy id with neither a key nor cached models is simply dropped.
 */
export async function migrateLegacyBuiltInProviders(
  deps: LegacyMigrationDeps
): Promise<LegacyMigrationResult> {
  const remapped = new Map<ProviderId, ProviderId>();
  const migratedProviderNames: string[] = [];
  const existing = deps.customProvidersRepo.list();

  for (const spec of LEGACY_BUILT_IN_PROVIDERS) {
    const apiKey = await deps.keychain.getSecret(spec.providerId);
    const cachedModels = deps.modelsRepo
      .list({ includeArchived: true, allowStale: true })
      .filter((model) => model.providerId === spec.providerId);

    // Nothing to carry over: the user never configured this provider.
    if (!apiKey && cachedModels.length === 0) {
      continue;
    }

    // Already migrated in an earlier launch.
    const alreadyMigrated = existing.find(
      (provider) => provider.baseUrl === spec.baseUrl || provider.name === spec.name
    );

    if (alreadyMigrated) {
      remapped.set(spec.providerId, alreadyMigrated.id);
      continue;
    }

    const providerId = buildCustomProviderId(`legacy-${spec.providerId}`);

    const models = cachedModels.map<CustomProviderModel>((model) => ({
      id: model.id,
      label: model.label,
      isFree: model.isFree,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens ?? null,
      supportsTools: model.supportsTools,
      supportsVision: model.supportsVision,
      supportsDocumentInput: model.supportsDocumentInput,
      supportsReasoning: model.supportsReasoning ?? false,
      supportsTemperature: model.supportsTemperature ?? true
    }));

    deps.customProvidersRepo.create({
      id: providerId,
      name: spec.name,
      baseUrl: spec.baseUrl,
      apiFormat: spec.apiFormat,
      // A full OpenRouter catalog is thousands of entries; carrying the whole
      // thing over as a hand-managed list is unusable. The user re-fetches the
      // ones they want from the endpoint.
      models: models.slice(0, 50)
    });

    if (apiKey) {
      await deps.keychain.setSecret(providerId, apiKey);
      deps.settingsRepo.syncSecretPresence(providerId, true);
      // The key now lives under the new id; drop the old entry so it does not
      // linger in the keychain forever.
      await deps.keychain.deleteSecret(spec.providerId).catch(() => undefined);
    }

    deps.modelsRepo.deleteByProvider(spec.providerId);
    deps.settingsRepo.deleteCredential(spec.providerId);
    deps.remapConversationProvider(spec.providerId, providerId);

    remapped.set(spec.providerId, providerId);
    migratedProviderNames.push(spec.name);
  }

  return { remapped, migratedProviderNames };
}
