import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

import type { ModelSummary, ProviderId } from '../../../shared/contracts';
import type {
  CustomProvider as CustomProviderConfig,
  CustomProviderApiFormat,
  DiscoveredModel
} from '../../../shared/customProviders';
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderStreamRequest,
  ProviderStreamResult
} from '../core/ProviderAdapter';
import { createClientCache, fetchWithTimeout, throwForBadResponse } from './httpSupport';
import { buildCustomProviderReasoningOptions } from './reasoningOptions';
import { resolveMaxOutputTokens, runProviderStream, DEFAULT_STREAM_CORE_CONFIG } from './streamCore';

const ANTHROPIC_VERSION = '2023-06-01';
const DISCOVERY_TIMEOUT_MS = 30_000;
const VALIDATE_TIMEOUT_MS = 20_000;

/**
 * Anthropic authenticates with `x-api-key` and requires a version header; the
 * OpenAI-shaped formats use a bearer token. Getting this wrong is the single
 * most common reason a hand-configured endpoint returns 401.
 */
export function buildAuthHeaders(apiFormat: CustomProviderApiFormat, apiKey: string): Record<string, string> {
  if (apiFormat === 'anthropic-messages') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json'
    };
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
}

/** Every supported format exposes model discovery at `{base}/models`. */
export function buildModelsUrl(baseUrl: string) {
  return `${baseUrl.replace(/\/+$/, '')}/models`;
}

type AnthropicModelsResponse = {
  data?: Array<{
    id?: unknown;
    display_name?: unknown;
    max_input_tokens?: unknown;
    max_tokens?: unknown;
    capabilities?: {
      image_input?: { supported?: unknown };
      pdf_input?: { supported?: unknown };
      thinking?: { supported?: unknown };
    };
  }>;
};

type OpenAIModelsResponse = {
  data?: Array<{ id?: unknown; owned_by?: unknown }>;
};

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Anthropic's list endpoint reports real capability metadata, so a discovered
 * model needs no guesswork. The OpenAI-compatible shape carries only an id,
 * which is why those models still need a hand-entered context window.
 */
export function parseDiscoveredModels(apiFormat: CustomProviderApiFormat, payload: unknown): DiscoveredModel[] {
  if (apiFormat === 'anthropic-messages') {
    const anthropic = payload as AnthropicModelsResponse;
    if (!Array.isArray(anthropic?.data)) {
      return [];
    }

    return anthropic.data
      .filter((entry): entry is NonNullable<AnthropicModelsResponse['data']>[number] => typeof entry?.id === 'string')
      .map((entry) => {
        const id = entry.id as string;
        const capabilities = entry.capabilities;

        return {
          id,
          label: typeof entry.display_name === 'string' ? entry.display_name : id,
          contextWindow: isPositiveNumber(entry.max_input_tokens) ? entry.max_input_tokens : null,
          maxOutputTokens: isPositiveNumber(entry.max_tokens) ? entry.max_tokens : null,
          supportsVision: capabilities?.image_input?.supported === true,
          supportsDocumentInput: capabilities?.pdf_input?.supported === true,
          // The endpoint states thinking support outright; without capability
          // metadata, leave it unset so the optimistic default applies.
          ...(capabilities != null ? { supportsReasoning: capabilities.thinking?.supported === true } : {}),
          detailed: capabilities != null
        } satisfies DiscoveredModel;
      });
  }

  const openai = payload as OpenAIModelsResponse;
  if (!Array.isArray(openai?.data)) {
    return [];
  }

  return openai.data
    .map((entry) => entry?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map((id) => ({
      id,
      label: id,
      contextWindow: null,
      maxOutputTokens: null,
      // Unknown, not unsupported: this list is ids and nothing else, and
      // writing `false` here is what made Atlas refuse images on models that
      // take them perfectly well.
      supportsVision: null,
      supportsDocumentInput: null,
      detailed: false
    }));
}

export type CustomProviderProbe = {
  baseUrl: string;
  apiFormat: CustomProviderApiFormat;
  apiKey: string;
};

/** Shared by the settings "test connection" action and by model discovery. */
export async function discoverCustomProviderModels(probe: CustomProviderProbe): Promise<DiscoveredModel[]> {
  const response = await fetchWithTimeout(buildModelsUrl(probe.baseUrl), {
    headers: buildAuthHeaders(probe.apiFormat, probe.apiKey),
    timeoutMs: DISCOVERY_TIMEOUT_MS
  });

  await throwForBadResponse(response);

  const payload = await response.json().catch(() => null);
  return parseDiscoveredModels(probe.apiFormat, payload);
}

export async function validateCustomProviderCredential(probe: CustomProviderProbe) {
  const response = await fetchWithTimeout(buildModelsUrl(probe.baseUrl), {
    headers: buildAuthHeaders(probe.apiFormat, probe.apiKey),
    timeoutMs: VALIDATE_TIMEOUT_MS
  });

  // Some gateways implement chat but not `/models`. A 404 proves the host is
  // reachable and the key was not rejected, which is all validation claims.
  if (response.status === 404 || response.status === 405) {
    return;
  }

  await throwForBadResponse(response);
}

/**
 * One adapter serving every user-configured endpoint. The config is captured at
 * construction; the registry rebuilds the adapter when settings change rather
 * than mutating it in place, so an in-flight turn keeps its original config.
 */
export class CustomProviderAdapter implements ProviderAdapter {
  readonly providerId: ProviderId;

  readonly capabilities: ProviderCapabilities = {
    // The configured model list is the catalog; no network call, no key needed.
    requiresApiKeyForCatalog: false,
    returnsCompleteCatalog: true
  };

  private readonly getClient: (apiKey: string) => LanguageModelFactory;

  constructor(private readonly config: CustomProviderConfig) {
    this.providerId = config.id;
    this.getClient = createClientCache((apiKey: string) => createLanguageModelFactory(config, apiKey));
  }

  get name() {
    return this.config.name;
  }

  get apiFormat() {
    return this.config.apiFormat;
  }

  async validateCredential(apiKey: string) {
    await validateCustomProviderCredential({
      baseUrl: this.config.baseUrl,
      apiFormat: this.config.apiFormat,
      apiKey
    });
  }

  async listModels(): Promise<ModelSummary[]> {
    const syncedAt = new Date().toISOString();

    return this.config.models.map<ModelSummary>((model) => ({
      id: model.id,
      providerId: this.config.id,
      label: model.label,
      contextWindow: model.contextWindow,
      isFree: model.isFree,
      supportsVision: model.supportsVision,
      supportsDocumentInput: model.supportsDocumentInput,
      supportsTools: model.supportsTools,
      supportsTemperature: model.supportsTemperature,
      supportsReasoning: model.supportsReasoning,
      reasoningEfforts: model.reasoningEfforts,
      maxOutputTokens: model.maxOutputTokens,
      archived: false,
      lastSyncedAt: syncedAt,
      lastSeenFreeAt: null
    }));
  }

  async discoverModels(apiKey: string) {
    return discoverCustomProviderModels({
      baseUrl: this.config.baseUrl,
      apiFormat: this.config.apiFormat,
      apiKey
    });
  }

  async streamChat(request: ProviderStreamRequest): Promise<ProviderStreamResult> {
    const factory = this.getClient(request.apiKey);
    // Anthropic budgets thinking in tokens, so the mapper needs the same
    // completion ceiling the stream will actually request.
    const reasoning = buildCustomProviderReasoningOptions({
      apiFormat: this.config.apiFormat,
      effort: request.reasoningEffort,
      supportsReasoning: request.modelHints?.supportsReasoning,
      allowedEfforts: request.modelHints?.reasoningEfforts,
      maxOutputTokens: resolveMaxOutputTokens(
        request.maxOutputTokens,
        request.modelHints,
        DEFAULT_STREAM_CORE_CONFIG
      )
    });

    return runProviderStream({
      model: factory(request.modelId),
      request,
      providerOptions: reasoning ? { [reasoning.namespace]: reasoning.options } : undefined
    });
  }
}

type LanguageModelFactory = (modelId: string) => LanguageModel;

function createLanguageModelFactory(config: CustomProviderConfig, apiKey: string): LanguageModelFactory {
  switch (config.apiFormat) {
    case 'anthropic-messages': {
      const anthropic = createAnthropic({ baseURL: config.baseUrl, apiKey });
      return (modelId) => anthropic.messages(modelId);
    }

    case 'responses': {
      const openai = createOpenAI({ baseURL: config.baseUrl, apiKey, name: config.name });
      return (modelId) => openai.responses(modelId);
    }

    case 'chat-completions':
    default: {
      const compatible = createOpenAICompatible({
        // The SDK uses this name to namespace providerOptions.
        name: 'custom',
        baseURL: config.baseUrl,
        apiKey
      });
      return (modelId) => compatible(modelId);
    }
  }
}
