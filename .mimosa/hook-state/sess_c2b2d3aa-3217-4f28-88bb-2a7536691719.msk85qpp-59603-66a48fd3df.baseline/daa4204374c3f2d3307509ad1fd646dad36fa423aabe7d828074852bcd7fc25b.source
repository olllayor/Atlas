import type { ReasoningEffort } from '../../../shared/chatParameters';
import { clampReasoningEffort } from '../../../shared/chatParameters';
import type { CustomProviderApiFormat } from '../../../shared/customProviders';

/**
 * Every provider spells "think harder" differently. This is the one place that
 * knows the translations, so adapters stay declarative about which dialect they
 * speak rather than each inventing its own mapping.
 */

/** Provider options must be JSON-serialisable to cross into the SDK request. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type ProviderOptionsValue = Record<string, JsonValue>;

/**
 * Snaps the requested effort onto the levels the catalog says the model
 * accepts. `undefined` allowed-list means the catalog was silent — pass the
 * effort through and let each dialect degrade it. An empty list means the
 * model reasons on its own terms and takes no parameter at all.
 */
function resolveEffort(
  effort: ReasoningEffort | undefined,
  allowedEfforts: ReasoningEffort[] | null | undefined
): { effort: ReasoningEffort | undefined; send: boolean } {
  if (!effort || allowedEfforts == null) {
    return { effort, send: true };
  }

  if (allowedEfforts.length === 0) {
    return { effort: undefined, send: false };
  }

  return { effort: clampReasoningEffort(effort, allowedEfforts), send: true };
}

/**
 * OpenRouter forwards `reasoning.effort` to the upstream model. Its catalog
 * advertises `max` alongside the effort levels the AI SDK types enumerate, so
 * the value is passed through as-is.
 */
export function buildOpenRouterReasoningOptions(
  effort: ReasoningEffort | undefined,
  supportsReasoning: boolean | undefined,
  allowedEfforts?: ReasoningEffort[] | null
): ProviderOptionsValue | null {
  if (!effort || supportsReasoning === false) {
    return null;
  }

  const resolved = resolveEffort(effort, allowedEfforts);
  if (!resolved.send || !resolved.effort) {
    return null;
  }

  if (resolved.effort === 'off') {
    return { reasoning: { enabled: false, exclude: true } };
  }

  // A binary-thinking model has no level to name, only the switch.
  if (resolved.effort === 'on') {
    return { reasoning: { enabled: true } };
  }

  return { reasoning: { effort: resolved.effort } };
}

/**
 * z.ai exposes a binary thinking switch rather than graded effort, so anything
 * above `off` enables it. Sending the parameter to a model without a thinking
 * mode is a request error, hence the capability check.
 */
export function buildGlmThinkingOptions(
  effort: ReasoningEffort | undefined,
  supportsReasoning: boolean | undefined
): ProviderOptionsValue | null {
  if (!supportsReasoning) {
    return null;
  }

  return { thinking: { type: effort && effort !== 'off' ? 'enabled' : 'disabled' } };
}

/**
 * Anthropic budgets thinking in tokens rather than levels. The ladder stays
 * well under a typical `maxOutputTokens` so the budget cannot swallow the whole
 * completion allowance.
 */
const ANTHROPIC_THINKING_BUDGETS: Record<Exclude<ReasoningEffort, 'off'>, number> = {
  on: 4_096,
  minimal: 1_024,
  low: 2_048,
  medium: 4_096,
  high: 8_192,
  xhigh: 12_288,
  max: 16_384
};

export function buildAnthropicThinkingOptions(
  effort: ReasoningEffort | undefined,
  supportsReasoning: boolean | undefined,
  maxOutputTokens: number
): ProviderOptionsValue | null {
  if (!effort || effort === 'off' || !supportsReasoning) {
    return null;
  }

  // The budget must leave room for the answer itself.
  const budgetTokens = Math.min(ANTHROPIC_THINKING_BUDGETS[effort], Math.floor(maxOutputTokens / 2));
  if (budgetTokens < 1_024) {
    return null;
  }

  return { thinking: { type: 'enabled', budgetTokens } };
}

/**
 * The OpenAI-compatible convention is a `reasoning_effort` string. When the
 * catalog listed the model's accepted levels, the clamped value is sent
 * verbatim — that is what the provider advertised. Without a list, anything
 * beyond the standard OpenAI vocabulary degrades to the highest standard level.
 */
export function buildOpenAICompatibleReasoningOptions(
  effort: ReasoningEffort | undefined,
  supportsReasoning: boolean | undefined,
  allowedEfforts?: ReasoningEffort[] | null
): ProviderOptionsValue | null {
  if (!effort || !supportsReasoning) {
    return null;
  }

  const resolved = resolveEffort(effort, allowedEfforts);
  if (!resolved.send || !resolved.effort) {
    return null;
  }

  if (resolved.effort === 'off') {
    return { reasoningEffort: 'none' };
  }

  // A toggle-only model has no named level; `medium` is the safest spelling of
  // "enabled" for endpoints that expect a graded value.
  if (resolved.effort === 'on') {
    return { reasoningEffort: 'medium' };
  }

  if (allowedEfforts == null && (resolved.effort === 'max' || resolved.effort === 'xhigh')) {
    return { reasoningEffort: 'high' };
  }

  return { reasoningEffort: resolved.effort };
}

/** Dispatches to the right dialect for a user-configured endpoint. */
export function buildCustomProviderReasoningOptions({
  apiFormat,
  effort,
  supportsReasoning,
  allowedEfforts,
  maxOutputTokens
}: {
  apiFormat: CustomProviderApiFormat;
  effort: ReasoningEffort | undefined;
  supportsReasoning: boolean | undefined;
  allowedEfforts?: ReasoningEffort[] | null;
  maxOutputTokens: number;
}): { namespace: string; options: ProviderOptionsValue } | null {
  if (apiFormat === 'anthropic-messages') {
    const resolved = resolveEffort(effort, allowedEfforts);
    if (!resolved.send) {
      return null;
    }

    const options = buildAnthropicThinkingOptions(resolved.effort, supportsReasoning, maxOutputTokens);
    return options ? { namespace: 'anthropic', options } : null;
  }

  const options = buildOpenAICompatibleReasoningOptions(effort, supportsReasoning, allowedEfforts);
  if (!options) {
    return null;
  }

  return { namespace: apiFormat === 'responses' ? 'openai' : 'custom', options };
}
