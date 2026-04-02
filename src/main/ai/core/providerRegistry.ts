import type { ProviderId } from '../../../shared/contracts';
import type { ProviderAdapter } from './ProviderAdapter';

export type ProviderRegistry = Map<ProviderId, ProviderAdapter>;

export function getProviderOrThrow(registry: ProviderRegistry, providerId: ProviderId): ProviderAdapter {
  const provider = registry.get(providerId);
  if (!provider) {
    throw new Error(`Provider "${providerId}" is not available in this build.`);
  }

  return provider;
}
