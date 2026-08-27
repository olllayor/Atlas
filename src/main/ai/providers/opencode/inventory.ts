/**
 * Turns opencode's `GET /provider` inventory into ordinary Atlas catalog rows.
 *
 * Blueprint: pingdotgg/t3code `Layers/OpenCodeProvider.ts`
 * (`flattenOpenCodeModels`, `providerModelsFromSettings`) and the composite
 * slug parser at `opencodeRuntime.ts:318-335`.
 *
 * Everything here is pure so the whole matrix runs under `node --test` from
 * canned inventory fixtures.
 */

import type { ModelSummary } from '../../../../shared/contracts.js';
import { OPENCODE_PROVIDER_ID } from '../../../../shared/opencodeSettings.js';
import type { OpenCodeProviderListResult } from './OpenCodeClient.js';

/**
 * Fallbacks for a model Atlas knows only as a hand-typed slug. Unknown
 * capabilities stay `null` rather than `false`: Atlas' three-valued modality
 * flags treat `null` as "nobody has said", which lets the first real request
 * settle it (see `ModelSummary.supportsVision`).
 */
export const DEFAULT_OPENCODE_MODEL_CAPABILITIES = {
  contextWindow: null,
  maxOutputTokens: null,
  supportsVision: null,
  supportsDocumentInput: null,
  supportsTools: null
} as const;

/** `<providerID>/<modelID>` — how opencode addresses every model. */
export interface OpenCodeModelSlug {
  readonly providerID: string;
  readonly modelID: string;
}

/**
 * Split a composite slug. Lenient about the halves (third-party ids carry
 * dots, plus signs, mixed casing) and strict about the structure: exactly one
 * separating slash with non-empty sides. A model id may itself contain
 * slashes (`openrouter/anthropic/claude-3`), so only the first one splits.
 */
export function parseOpenCodeModelSlug(slug: string): OpenCodeModelSlug | null {
  const trimmed = slug.trim();
  const separator = trimmed.indexOf('/');
  if (separator <= 0 || separator === trimmed.length - 1) {
    return null;
  }

  const providerID = trimmed.slice(0, separator);
  const modelID = trimmed.slice(separator + 1);
  if (/\s/.test(trimmed) || providerID.length === 0 || modelID.length === 0) {
    return null;
  }

  return { providerID, modelID };
}

export function formatOpenCodeModelSlug(slug: OpenCodeModelSlug): string {
  return `${slug.providerID}/${slug.modelID}`;
}

export interface FlattenOpenCodeModelsInput {
  readonly inventory: OpenCodeProviderListResult;
  /** Extra slugs the user typed in Settings; merged after the live catalog. */
  readonly customModels?: readonly string[];
  /** Timestamp stamped on every row; injectable so tests stay deterministic. */
  readonly syncedAt?: string;
  /**
   * When true, providers opencode has not authenticated are listed anyway.
   * Off by default: a model that cannot be sent to has no business in the
   * picker (t3 gates the same way on `connected`).
   */
  readonly includeUnconnected?: boolean;
}

/** opencode marks retired models; they stay addressable but out of the picker. */
function isOfferable(status: string | undefined): boolean {
  return status !== 'deprecated';
}

/**
 * Flatten the inventory into `ModelSummary` rows under `providerId:
 * "opencode"`, id'd by their composite slug.
 *
 * Labels stay short (the upstream model's own name) and only gain a provider
 * suffix when two upstream providers ship the same name — otherwise a picker
 * full of "Claude Opus 4.7 (OpenCode Zen)" buries the part that differs.
 */
export function flattenOpenCodeModels(input: FlattenOpenCodeModelsInput): ModelSummary[] {
  const syncedAt = input.syncedAt ?? new Date().toISOString();
  const connected = new Set(input.inventory.connected);
  const usableProviders = input.inventory.providers.filter(
    (provider) => input.includeUnconnected === true || connected.has(provider.id)
  );

  const nameCounts = new Map<string, number>();
  for (const provider of usableProviders) {
    for (const model of provider.models) {
      if (!isOfferable(model.status)) continue;
      nameCounts.set(model.name, (nameCounts.get(model.name) ?? 0) + 1);
    }
  }

  const rows = new Map<string, ModelSummary>();

  for (const provider of usableProviders) {
    for (const model of provider.models) {
      if (!isOfferable(model.status)) continue;

      const id = formatOpenCodeModelSlug({ providerID: provider.id, modelID: model.id });
      const ambiguous = (nameCounts.get(model.name) ?? 0) > 1;

      rows.set(id, {
        id,
        providerId: OPENCODE_PROVIDER_ID,
        label: ambiguous ? `${model.name} (${provider.name})` : model.name,
        contextWindow: model.contextWindow,
        isFree: model.costPerMillion
          ? model.costPerMillion.input === 0 && model.costPerMillion.output === 0
          : false,
        supportsVision: model.capabilities.image,
        supportsDocumentInput: model.capabilities.pdf,
        supportsTools: model.capabilities.toolcall,
        archived: false,
        lastSyncedAt: syncedAt,
        lastSeenFreeAt: null,
        maxOutputTokens: model.maxOutputTokens,
        // Sampling belongs to opencode: `session/prompt` takes no temperature,
        // token ceiling, or effort, so Atlas has nothing to offer here however
        // the upstream model is described (see `OpenCodeAgentAdapter`).
        supportsTemperature: false,
        supportsReasoning: model.capabilities.reasoning === true,
        reasoningEfforts: null
      });
    }
  }

  // Hand-typed slugs come last and never overwrite live metadata: the catalog
  // knows more than the user typed, and a duplicate entry is just the same
  // model spelled out.
  for (const raw of input.customModels ?? []) {
    const slug = parseOpenCodeModelSlug(raw);
    if (!slug) continue;

    const id = formatOpenCodeModelSlug(slug);
    if (rows.has(id)) continue;

    rows.set(id, {
      id,
      providerId: OPENCODE_PROVIDER_ID,
      label: slug.modelID,
      isFree: false,
      archived: false,
      lastSyncedAt: syncedAt,
      lastSeenFreeAt: null,
      reasoningEfforts: null,
      supportsTemperature: false,
      ...DEFAULT_OPENCODE_MODEL_CAPABILITIES
    });
  }

  return [...rows.values()];
}
