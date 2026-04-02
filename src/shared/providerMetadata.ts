import type { ProviderId } from './contracts';

export type ProviderMetadata = {
  id: ProviderId;
  label: string;
  keyLabel: string;
  keyPlaceholder: string;
  keyLink: string;
  keyLinkLabel: string;
  configuredLabel: string;
  needsAttentionLabel: string;
  savedLabel: string;
};

export const PROVIDER_ORDER: ProviderId[] = ['openrouter', 'glm', 'openai', 'gemini'];

export const PROVIDER_METADATA: Record<ProviderId, ProviderMetadata> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    keyLabel: 'OpenRouter API key',
    keyPlaceholder: 'sk-or-v1-...',
    keyLink: 'https://openrouter.ai/keys',
    keyLinkLabel: 'openrouter.ai/keys',
    configuredLabel: 'OpenRouter configured',
    needsAttentionLabel: 'OpenRouter needs attention',
    savedLabel: 'OpenRouter key saved'
  },
  glm: {
    id: 'glm',
    label: 'GLM',
    keyLabel: 'GLM API key',
    keyPlaceholder: 'zai-...',
    keyLink: 'https://z.ai/',
    keyLinkLabel: 'z.ai',
    configuredLabel: 'GLM configured',
    needsAttentionLabel: 'GLM needs attention',
    savedLabel: 'GLM key saved'
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyLabel: 'OpenAI API key',
    keyPlaceholder: 'sk-...',
    keyLink: 'https://platform.openai.com/api-keys',
    keyLinkLabel: 'platform.openai.com/api-keys',
    configuredLabel: 'OpenAI configured',
    needsAttentionLabel: 'OpenAI needs attention',
    savedLabel: 'OpenAI key saved'
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    keyLabel: 'Gemini API key',
    keyPlaceholder: 'AIza...',
    keyLink: 'https://aistudio.google.com/app/apikey',
    keyLinkLabel: 'aistudio.google.com/app/apikey',
    configuredLabel: 'Gemini configured',
    needsAttentionLabel: 'Gemini needs attention',
    savedLabel: 'Gemini key saved'
  }
};
