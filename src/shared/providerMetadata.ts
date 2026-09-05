import type { ProviderId } from './contracts';
import type { CustomProvider } from './customProviders';
import { isCustomProviderId } from './customProviders';
import { findLocalAgent } from './localAgents';

export type ProviderMetadata = {
  id: ProviderId;
  label: string;
  keyLabel: string;
  keyPlaceholder: string;
  configuredLabel: string;
  needsAttentionLabel: string;
  savedLabel: string;
};

const KNOWN_PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  ollama: 'Ollama',
  groq: 'Groq',
  mistral: 'Mistral',
  together: 'Together AI',
  xai: 'xAI',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
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

  // Local agents are not saved endpoints — they are their own integrations,
  // with their own credentials — so their display names come from the catalog
  // rather than the table. (OpenCode is one of them.)
  const localAgent = findLocalAgent(providerId);
  if (localAgent) {
    return buildProviderMetadata(providerId, localAgent.label);
  }

  const known = KNOWN_PROVIDER_LABELS[providerId.toLowerCase()];
  if (known) {
    return buildProviderMetadata(providerId, known);
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
