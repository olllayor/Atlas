import { Models } from '@opencode-ai/models';
import type { Model, Provider, ProviderMap } from '@opencode-ai/models';

import type { CustomProviderApiFormat, DiscoveredModel } from '../../../shared/customProviders';

/**
 * models.dev is an open database of model capabilities, limits and pricing.
 * A hand-configured endpoint only tells us model ids, so this fills in the
 * facts the endpoint cannot: context window, output ceiling, modalities,
 * reasoning and tool support.
 */

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;

export type ProviderPreset = {
  /** models.dev provider id, e.g. `openrouter`. */
  id: string;
  name: string;
  /** API root, present for providers that expose an OpenAI-compatible URL. */
  baseUrl: string | null;
  /** Documentation URL for the provider's model list. */
  docUrl: string;
  /** Best-guess wire format, derived from the SDK package the provider uses. */
  apiFormat: CustomProviderApiFormat;
  modelCount: number;
};

export type ModelFacts = {
  label: string;
  isFree: boolean;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsDocumentInput: boolean;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
};

/**
 * The npm package a provider uses tells us which wire format it speaks. Anything
 * not recognised is treated as OpenAI-compatible, which is the near-universal
 * default for third-party endpoints.
 */
export function inferApiFormat(provider: Pick<Provider, 'npm' | 'models'>): CustomProviderApiFormat {
  const npm = provider.npm ?? '';

  if (npm.includes('anthropic')) {
    return 'anthropic-messages';
  }

  // A provider whose models all pin the Responses shape speaks Responses.
  const models = Object.values(provider.models ?? {});
  if (models.length > 0 && models.every((model) => model.provider?.shape === 'responses')) {
    return 'responses';
  }

  return 'chat-completions';
}

export function toModelFacts(model: Model): ModelFacts {
  const inputModalities = model.modalities?.input ?? [];

  const cost = model.cost;

  return {
    label: model.name || model.id,
    // Absent pricing means subscription-only, not free; zeroed pricing means
    // the provider genuinely does not charge per token.
    isFree: cost != null && cost.input === 0 && cost.output === 0,
    contextWindow: positiveOrNull(model.limit?.context),
    maxOutputTokens: positiveOrNull(model.limit?.output),
    supportsTools: model.tool_call === true,
    supportsVision: inputModalities.includes('image'),
    supportsDocumentInput: inputModalities.includes('pdf'),
    supportsReasoning: model.reasoning === true,
    // Reasoning models commonly reject `temperature`; models.dev records this
    // explicitly, and an absent flag means the database has not said either way.
    supportsTemperature: model.temperature !== false
  };
}

function positiveOrNull(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Normalises the many ways the same model is named across gateways. */
export function normalizeModelKey(modelId: string) {
  return modelId
    .toLowerCase()
    .trim()
    // Gateways prefix with a vendor segment (`z-ai/glm-5`) that models.dev omits.
    .replace(/^[^/]+\//, '')
    // OpenRouter marks its free tier with a suffix that is not part of the model.
    .replace(/[:@](free|beta|preview|latest|nitro|extended|online)$/i, '');
}

export class ModelsDevCatalog {
  private cache: ProviderMap | null = null;
  private fetchedAt = 0;
  private inFlight: Promise<ProviderMap> | null = null;

  constructor(private readonly client = Models.make()) {}

  /**
   * Cached for a few hours: the database changes on the order of days, and a
   * settings screen should not re-download it on every keystroke.
   */
  async load(): Promise<ProviderMap> {
    if (this.cache && Date.now() - this.fetchedAt < CATALOG_TTL_MS) {
      return this.cache;
    }

    // Collapse concurrent callers onto one request.
    this.inFlight ??= this.fetchProviders().finally(() => {
      this.inFlight = null;
    });

    try {
      const providers = await this.inFlight;
      this.cache = providers;
      this.fetchedAt = Date.now();
      return providers;
    } catch (error) {
      // A stale catalog beats no catalog; metadata is an enrichment, not a
      // dependency, so a models.dev outage must not break provider setup.
      if (this.cache) {
        return this.cache;
      }

      throw error;
    }
  }

  private async fetchProviders() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    timeout.unref?.();

    try {
      return await this.client.providers({ signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async listProviderPresets(): Promise<ProviderPreset[]> {
    const providers = await this.load();

    return Object.values(providers)
      .map<ProviderPreset>((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.api ?? null,
        docUrl: provider.doc,
        apiFormat: inferApiFormat(provider),
        modelCount: Object.keys(provider.models ?? {}).length
      }))
      .filter((preset) => preset.modelCount > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Facts for one model. Prefers the provider's own entry, then any provider
   * offering a model with the same normalised id — the same weights served by a
   * gateway have the same context window and capabilities.
   */
  async lookup(modelId: string, providerHint?: string | null): Promise<ModelFacts | null> {
    const providers = await this.load().catch(() => null);
    if (!providers) {
      return null;
    }

    const key = normalizeModelKey(modelId);

    const preferred = providerHint ? providers[providerHint] : undefined;
    const direct = preferred ? findModel(preferred, modelId, key) : null;
    if (direct) {
      return toModelFacts(direct);
    }

    for (const provider of Object.values(providers)) {
      const match = findModel(provider, modelId, key);
      if (match) {
        return toModelFacts(match);
      }
    }

    return null;
  }

  /** Enriches discovered models in place, leaving unknown ones untouched. */
  async enrich(models: DiscoveredModel[], providerHint?: string | null): Promise<DiscoveredModel[]> {
    if (models.length === 0) {
      return models;
    }

    const providers = await this.load().catch(() => null);
    if (!providers) {
      return models;
    }

    return Promise.all(
      models.map(async (model) => {
        // A model the endpoint already described in full needs no help.
        if (model.detailed && model.contextWindow != null) {
          return model;
        }

        const facts = await this.lookup(model.id, providerHint);
        if (!facts) {
          return model;
        }

        return {
          ...model,
          label: model.label === model.id ? facts.label : model.label,
          contextWindow: model.contextWindow ?? facts.contextWindow,
          maxOutputTokens: model.maxOutputTokens ?? facts.maxOutputTokens,
          supportsVision: model.supportsVision || facts.supportsVision,
          supportsDocumentInput: model.supportsDocumentInput || facts.supportsDocumentInput,
          supportsTools: facts.supportsTools,
          supportsReasoning: facts.supportsReasoning,
          supportsTemperature: facts.supportsTemperature,
          // A `:free` suffix on the gateway id is authoritative over pricing
          // recorded for the underlying model.
          isFree: model.isFree || facts.isFree,
          detailed: true
        } satisfies DiscoveredModel;
      })
    );
  }
}

function findModel(provider: Provider, modelId: string, normalizedKey: string): Model | null {
  const models = provider.models ?? {};

  const exact = models[modelId];
  if (exact) {
    return exact;
  }

  for (const model of Object.values(models)) {
    if (normalizeModelKey(model.id) === normalizedKey) {
      return model;
    }
  }

  return null;
}
