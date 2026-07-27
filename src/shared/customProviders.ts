import type { ProviderId } from './contracts';

/**
 * Wire formats a user-configured endpoint can speak. Each maps to a different
 * request/response shape, not just a different path, so the adapter picks a
 * different AI SDK provider for each.
 */
export type CustomProviderApiFormat = 'anthropic-messages' | 'chat-completions' | 'responses';

export const CUSTOM_PROVIDER_API_FORMATS: Array<{
  value: CustomProviderApiFormat;
  label: string;
  hint: string;
}> = [
  {
    value: 'anthropic-messages',
    label: 'Anthropic messages (/v1/messages)',
    hint: 'Claude and Anthropic-compatible gateways.'
  },
  {
    value: 'chat-completions',
    label: 'Chat completions (/chat/completions)',
    hint: 'The OpenAI-compatible default. Works with most gateways, vLLM, Ollama and LM Studio.'
  },
  {
    value: 'responses',
    label: 'Responses (/responses)',
    hint: "OpenAI's newer Responses API. Only pick this if the endpoint documents it."
  }
];

export const DEFAULT_CUSTOM_PROVIDER_API_FORMAT: CustomProviderApiFormat = 'chat-completions';

/** Context window assumed for a hand-entered model, matching the dialog default. */
export const DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW = 200_000;

const CUSTOM_PROVIDER_ID_PREFIX = 'custom:';

export function buildCustomProviderId(slug: string): ProviderId {
  return `${CUSTOM_PROVIDER_ID_PREFIX}${slug}`;
}

export function isCustomProviderId(providerId: ProviderId): boolean {
  return providerId.startsWith(CUSTOM_PROVIDER_ID_PREFIX);
}

export type CustomProviderModel = {
  id: string;
  label: string;
  /** Free to call. Gateways mark this with a `:free` suffix; models.dev knows the price. */
  isFree: boolean;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsDocumentInput: boolean;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
};

export type CustomProvider = {
  id: ProviderId;
  name: string;
  baseUrl: string;
  apiFormat: CustomProviderApiFormat;
  enabled: boolean;
  /** Whether a key is stored in the OS keychain. The key itself never crosses IPC. */
  hasApiKey: boolean;
  models: CustomProviderModel[];
  createdAt: string;
  updatedAt: string;
};

export type CustomProviderModelInput = {
  id: string;
  label?: string | null;
  isFree?: boolean;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsDocumentInput?: boolean;
  supportsReasoning?: boolean;
  supportsTemperature?: boolean;
};

export type CreateCustomProviderRequest = {
  name: string;
  baseUrl: string;
  apiFormat: CustomProviderApiFormat;
  apiKey?: string;
  models?: CustomProviderModelInput[];
};

export type UpdateCustomProviderRequest = {
  providerId: ProviderId;
  name?: string;
  baseUrl?: string;
  apiFormat?: CustomProviderApiFormat;
  enabled?: boolean;
  /** Omit to leave the stored key untouched; empty string is rejected. */
  apiKey?: string;
};

export type SetCustomProviderModelsRequest = {
  providerId: ProviderId;
  models: CustomProviderModelInput[];
};

export type DiscoverCustomProviderModelsRequest = {
  providerId?: ProviderId;
  /** Lets the Add-provider form probe an endpoint before it has been saved. */
  baseUrl?: string;
  apiFormat?: CustomProviderApiFormat;
  apiKey?: string;
};

export type DiscoveredModel = {
  id: string;
  label: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsDocumentInput: boolean;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  supportsTemperature?: boolean;
  isFree?: boolean;
  /**
   * True when the capabilities came from the endpoint or the models.dev
   * database rather than from our defaults.
   */
  detailed: boolean;
};

/** A known provider from models.dev, offered as a starting point in the form. */
export type ProviderPreset = {
  id: string;
  name: string;
  baseUrl: string | null;
  docUrl: string;
  apiFormat: CustomProviderApiFormat;
  modelCount: number;
};

export class CustomProviderValidationError extends Error {
  constructor(
    message: string,
    readonly field: 'name' | 'baseUrl' | 'apiFormat' | 'apiKey' | 'models'
  ) {
    super(message);
    this.name = 'CustomProviderValidationError';
  }
}

export function normalizeProviderName(value: string) {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) {
    throw new CustomProviderValidationError('Give the provider a name.', 'name');
  }

  if (name.length > 60) {
    throw new CustomProviderValidationError('Provider names are limited to 60 characters.', 'name');
  }

  return name;
}

/**
 * Accepts the API root, not a completion path. Trailing slashes and an
 * accidentally pasted `/chat/completions` are the two mistakes people actually
 * make, so both are corrected rather than rejected.
 */
export function normalizeBaseUrl(value: string) {
  const raw = value.trim();
  if (!raw) {
    throw new CustomProviderValidationError('Enter the API base URL.', 'baseUrl');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CustomProviderValidationError('That is not a valid URL. Include the scheme, e.g. https://…', 'baseUrl');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CustomProviderValidationError('Base URLs must use http or https.', 'baseUrl');
  }

  // Plain http is only reasonable for a local runtime such as Ollama.
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new CustomProviderValidationError(
      'Plain http is only allowed for localhost. Use https for remote endpoints.',
      'baseUrl'
    );
  }

  url.hash = '';
  url.search = '';

  let path = url.pathname.replace(/\/+$/, '');
  for (const suffix of ['/chat/completions', '/completions', '/responses', '/messages']) {
    if (path.endsWith(suffix)) {
      path = path.slice(0, -suffix.length);
      break;
    }
  }

  url.pathname = path;

  return `${url.origin}${path}`;
}

function isLoopbackHost(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}

export function normalizeModelInput(input: CustomProviderModelInput): CustomProviderModel {
  const id = input.id.trim();
  if (!id) {
    throw new CustomProviderValidationError('Model IDs cannot be empty.', 'models');
  }

  const contextWindow = normalizePositiveInteger(input.contextWindow);
  const maxOutputTokens = normalizePositiveInteger(input.maxOutputTokens);

  return {
    id,
    label: input.label?.trim() || id,
    // Gateways advertise a free tier with an id suffix; nothing else in an
    // OpenAI-compatible model list says anything about price.
    isFree: input.isFree ?? /[:@]free$/i.test(id),
    contextWindow,
    maxOutputTokens,
    supportsTools: input.supportsTools ?? true,
    supportsVision: input.supportsVision ?? false,
    supportsDocumentInput: input.supportsDocumentInput ?? false,
    supportsReasoning: input.supportsReasoning ?? false,
    supportsTemperature: input.supportsTemperature ?? true
  };
}

export function normalizeModelInputs(inputs: CustomProviderModelInput[]): CustomProviderModel[] {
  const seen = new Set<string>();
  const models: CustomProviderModel[] = [];

  for (const input of inputs) {
    const model = normalizeModelInput(input);
    if (seen.has(model.id)) {
      continue;
    }

    seen.add(model.id);
    models.push(model);
  }

  return models;
}

function normalizePositiveInteger(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.floor(value);
}

/** `16.4K` style badge used next to each model in the settings list. */
export function formatContextWindow(contextWindow: number | null | undefined) {
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null;
  }

  if (contextWindow >= 1_000_000) {
    return `${trimZero(contextWindow / 1_000_000)}M`;
  }

  if (contextWindow >= 1_000) {
    return `${trimZero(contextWindow / 1_000)}K`;
  }

  return String(contextWindow);
}

function trimZero(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
