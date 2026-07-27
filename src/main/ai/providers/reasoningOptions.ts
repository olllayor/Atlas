import type { ReasoningEffort } from '../../../shared/chatParameters';
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
 * OpenRouter forwards `reasoning.effort` to the upstream model. Its catalog
 * advertises `max` alongside the effort levels the AI SDK types enumerate, so
 * the value is passed through as-is.
 */
export function buildOpenRouterReasoningOptions(
  effort: ReasoningEffort | undefined,
  supportsReasoning: boolean | undefined
): ProviderOptionsValue | null {
  if (!effort || supportsReasoning === false) {
    return null;
  }

  if (effort === 'off') {
    return { reasoning: { enabled: false, exclude: true } };
  }

  return { reasoning: { effort } };
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
  low: 2_048,
  medium: 4_096,
  high: 8_192,
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
 * The OpenAI-compatible convention is a `reasoning_effort` string. `max` is not
 * part of that vocabulary, so it degrades to the highest standard level.
 */
export function buildOpenAICompatibleReasoningOptions(
  effort: ReasoningEffort | undefined,
  supportsReasoning: boolean | undefined
): ProviderOptionsValue | null {
  if (!effort || !supportsReasoning) {
    return null;
  }

  if (effort === 'off') {
    return { reasoningEffort: 'none' };
  }

  return { reasoningEffort: effort === 'max' ? 'high' : effort };
}

/** Dispatches to the right dialect for a user-configured endpoint. */
export function buildCustomProviderReasoningOptions({
  apiFormat,
  effort,
  supportsReasoning,
  maxOutputTokens
}: {
  apiFormat: CustomProviderApiFormat;
  effort: ReasoningEffort | undefined;
  supportsReasoning: boolean | undefined;
  maxOutputTokens: number;
}): { namespace: string; options: ProviderOptionsValue } | null {
  if (apiFormat === 'anthropic-messages') {
    const options = buildAnthropicThinkingOptions(effort, supportsReasoning, maxOutputTokens);
    return options ? { namespace: 'anthropic', options } : null;
  }

  const options = buildOpenAICompatibleReasoningOptions(effort, supportsReasoning);
  if (!options) {
    return null;
  }

  return { namespace: apiFormat === 'responses' ? 'openai' : 'custom', options };
}
