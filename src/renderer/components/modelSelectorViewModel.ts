import type { CustomProvider, ModelSummary, ProviderCredentialSummary } from '../../shared/contracts';
import { OPENCODE_PROVIDER_ID } from '../../shared/opencodeSettings';
import { resolveProviderLabel } from '../../shared/providerMetadata';

/**
 * OpenCode signs in on its own (`opencode auth login`), so Atlas never holds a
 * key for it. Without this its models would sort below the configured ones and
 * offer an API-key prompt that fixes nothing.
 */
function providerAuthenticatesItself(providerId: string) {
  return providerId === OPENCODE_PROVIDER_ID;
}

export type ProviderRef = Pick<CustomProvider, 'id' | 'name'>;

export type ModelGroup = {
  /** Provider display name, used as the group heading. */
  label: string;
  models: ModelSummary[];
  /** False when no API key is saved for the provider backing this group. */
  configured: boolean;
};

export type ModelSelectorViewModel = {
  groups: ModelGroup[];
  totalCount: number;
  /** Drives whether the free/all toggle is worth showing at all. */
  hasFreeModels: boolean;
};

export function buildModelSelectorViewModel({
  models,
  customProviders = [],
  credentials,
  showFreeOnly
}: {
  models: ModelSummary[];
  customProviders?: ProviderRef[];
  credentials?: ProviderCredentialSummary[];
  showFreeOnly: boolean;
}): ModelSelectorViewModel {
  const hasFreeModels = models.some((model) => model.isFree);

  // A catalog made only of user-configured endpoints has nothing free in it, so
  // applying the filter would empty the list with no way to recover.
  const freeFilterActive = showFreeOnly && hasFreeModels;

  // Without any credential data, assume everything is usable rather than
  // flagging the whole catalog as unconfigured.
  const knowsCredentials = (credentials?.length ?? 0) > 0;
  const configuredProviderIds = new Set(
    (credentials ?? []).filter((entry) => entry.hasSecret).map((entry) => entry.providerId)
  );
  const isConfigured = (model: ModelSummary) =>
    !knowsCredentials ||
    providerAuthenticatesItself(model.providerId) ||
    configuredProviderIds.has(model.providerId);

  const filtered = models.filter((model) => !freeFilterActive || model.isFree);

  const byLabel = new Map<string, ModelSummary[]>();
  for (const model of filtered) {
    const label = resolveProviderLabel(model.providerId, customProviders);
    const bucket = byLabel.get(label);
    if (bucket) {
      bucket.push(model);
    } else {
      byLabel.set(label, [model]);
    }
  }

  const groups = [...byLabel.entries()]
    .map<ModelGroup>(([label, groupModels]) => ({
      label,
      models: groupModels,
      configured: groupModels.some(isConfigured)
    }))
    // Providers you can actually send to come first.
    .sort((a, b) => {
      if (a.configured !== b.configured) {
        return a.configured ? -1 : 1;
      }

      return a.label.localeCompare(b.label);
    });

  return {
    groups,
    totalCount: groups.reduce((sum, group) => sum + group.models.length, 0),
    hasFreeModels
  };
}

/** True when the model's provider has no key saved and we know that for sure. */
export function modelNeedsApiKey(model: ModelSummary, credentials?: ProviderCredentialSummary[]) {
  if ((credentials?.length ?? 0) === 0 || providerAuthenticatesItself(model.providerId)) {
    return false;
  }

  return !credentials!.some((entry) => entry.providerId === model.providerId && entry.hasSecret);
}
