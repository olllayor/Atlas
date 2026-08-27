import type { ProviderId } from './contracts';
import type { CustomProvider } from './customProviders';
import { isCustomProviderId } from './customProviders';
import { OPENCODE_PROVIDER_ID } from './opencodeSettings';

export type ProviderMetadata = {
  id: ProviderId;
  label: string;
  keyLabel: string;
  keyPlaceholder: string;
  configuredLabel: string;
  needsAttentionLabel: string;
  savedLabel: string;
};

function buildProviderMetadata(providerId: ProviderId, name: string): ProviderMetadata {
  return {
    id: providerId,
    label: name,
    keyLabel: 'API key',
    keyPlaceholder: 'Enter API key',
    configuredLabel: `${name} configured`,
    needsAttentionLabel: `${name} needs attention`,
    savedLabel: `${name} key saved`
  };
}

/**
 * Metadata for any provider id. Every provider is user-configured now, so the
 * display name comes from the saved configuration rather than a built-in table.
 */
export function resolveProviderMetadata(
  providerId: ProviderId,
  customProviders: Pick<CustomProvider, 'id' | 'name'>[] = []
): ProviderMetadata {
  const configured = customProviders.find((provider) => provider.id === providerId);
  if (configured) {
    return buildProviderMetadata(providerId, configured.name);
  }

  // OpenCode is not a saved endpoint — it is its own integration, with its own
  // credentials — so its display name comes from here rather than the table.
  if (providerId === OPENCODE_PROVIDER_ID) {
    return buildProviderMetadata(providerId, 'OpenCode');
  }

  // A provider that was deleted, or a legacy id from before the migration.
  const fallbackName = isCustomProviderId(providerId) ? 'Removed provider' : providerId;
  return buildProviderMetadata(providerId, fallbackName);
}

export function resolveProviderLabel(
  providerId: ProviderId,
  customProviders: Pick<CustomProvider, 'id' | 'name'>[] = []
) {
  return resolveProviderMetadata(providerId, customProviders).label;
}
