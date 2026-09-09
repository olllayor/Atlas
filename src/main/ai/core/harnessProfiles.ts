/**
 * Model-specific harness profiles (v1 heuristic).
 *
 * One prompt + one tool shape for all models costs extra reasoning tokens and
 * wrong tool choice (Cursor/OpenCode tune per model family). Full per-model
 * prompts are future work; this is the safe substrate: a pure function mapping
 * model id -> loop budget, consumed by `runProviderStream` as a ceiling on top
 * of configured `toolStepLimit`.
 *
 * Two rules keep this honest:
 * - Only *lightweight* models tighten the budget; everything else returns
 *   `null`, meaning "no opinion, use the configured cap". A substring table's
 *   failure mode is going stale, and going stale must not silently throttle a
 *   frontier model the table has never heard of — nor pin the cap at today's
 *   number if `DEFAULT_STREAM_CORE_CONFIG.toolStepLimit` is later raised.
 * - Patterns match on id *segments*, not raw substrings. `gemini` contains
 *   `mini`; matching raw substrings classified every Gemini as lightweight.
 */

/** Lightweight chat models rarely sustain long chains; cap the burn. */
const LIGHTWEIGHT_STEP_LIMIT = 32;

/** Behavioral hint for the lightweight tier (v1: budget + nudge, not a full per-model prompt). */
export const LIGHTWEIGHT_PROMPT_HINT =
  'You are running on a lightweight model: keep answers concise, prefer the fewest tool calls that answer the question, ' +
  'and avoid broad exploratory sweeps unless the user asked for them. If a task needs a long chain, say so instead of burning steps.';

export type HarnessProfile = {
  /**
   * Max tool-calling round trips, or `null` for "defer to the configured cap".
   * Callers apply it as a ceiling, never as a floor.
   */
  toolStepLimit: number | null;
  /**
   * Profile name, for logging and for the day the tiers carry distinct budgets.
   * `standard` and `heavy` are deliberately identical today: the split records
   * why a model was left alone, without inventing a limit nobody measured.
   */
  profile: 'lightweight' | 'standard' | 'heavy';
  /**
   * Short behavioral hint appended to the system prompt for this tier, or
   * `null` when the tier carries no extra instruction. Only the lightweight
   * tier speaks today: small chat models over-explore and burn their short
   * chain on broad sweeps, so the hint steers them at the source rather than
   * letting the step cap do all the work.
   */
  promptHint: string | null;
};

/**
 * Ids are split on non-alphanumerics, so `gpt-4o-mini` yields
 * ['gpt','4o','mini'] and `gemini-2.5-flash` yields ['gemini','2','5','flash'].
 * A pattern matches when it equals a segment, or when a segment starts with it
 * followed by a version digit (`opus4`, `o3`), which covers vendors that omit
 * the separator.
 */
function segmentsOf(modelId: string): string[] {
  return modelId.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function matches(segments: string[], patterns: readonly string[]): boolean {
  return segments.some((segment) =>
    patterns.some(
      (pattern) =>
        segment === pattern ||
        (segment.startsWith(pattern) && /^[0-9]/.test(segment.slice(pattern.length)))
    )
  );
}

const LIGHTWEIGHT_PATTERNS = [
  'haiku',
  'mini',
  'nano',
  'small',
  'lite',
  'flash', // `flash-lite` and `flash` alike; `2.5-flash` is a chat-tier model
  '8b',
  '7b',
  'turbo'
] as const;

const HEAVY_PATTERNS = [
  'opus',
  'sonnet',
  'fable',
  'pro',
  'reasoner',
  'thinking',
  'o1',
  'o3',
  'o4',
  'r1'
] as const;

export function resolveHarnessProfile(modelId: string): HarnessProfile {
  const segments = segmentsOf(modelId);
  // Heavy first: ids like `o3-mini` carry both markers, and the reasoning
  // family is the one that actually needs the long chain.
  if (matches(segments, HEAVY_PATTERNS)) {
    return { toolStepLimit: null, profile: 'heavy', promptHint: null };
  }
  if (matches(segments, LIGHTWEIGHT_PATTERNS)) {
    return { toolStepLimit: LIGHTWEIGHT_STEP_LIMIT, profile: 'lightweight', promptHint: LIGHTWEIGHT_PROMPT_HINT };
  }
  return { toolStepLimit: null, profile: 'standard', promptHint: null };
}

/**
 * Prompt hint for a model id, or null when its tier carries none.
 * Thin wrapper so prompt builders do not need the full profile.
 */
export function resolveHarnessPromptHint(modelId: string | undefined): string | null {
  if (!modelId) {
    return null;
  }
  return resolveHarnessProfile(modelId).promptHint;
}
