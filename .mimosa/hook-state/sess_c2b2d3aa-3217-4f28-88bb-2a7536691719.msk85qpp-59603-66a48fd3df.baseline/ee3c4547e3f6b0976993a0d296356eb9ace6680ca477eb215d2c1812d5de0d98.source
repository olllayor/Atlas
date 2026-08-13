import type { ProviderId } from '../../../shared/contracts';
import type { ProviderAdapter } from './ProviderAdapter';

export type ProviderRegistry = Map<ProviderId, ProviderAdapter>;

export function getProviderOrThrow(registry: ProviderRegistry, providerId: ProviderId): ProviderAdapter {
  const provider = registry.get(providerId);
  if (!provider) {
    // Every provider is user-configured now, so a miss means the endpoint was
    // disabled or deleted — not that the build lacks it, which is what this
    // used to claim and which nobody could act on.
    throw new Error(
      'That model’s provider is disabled or no longer configured. Re-enable it in Model settings, or pick a model from another provider.'
    );
  }

  return provider;
}
