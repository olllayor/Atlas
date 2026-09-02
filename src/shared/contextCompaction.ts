/**
 * Shared compaction threshold policy.
 *
 * Single source of truth for min/max/default and conversions, so the
 * database, the context manager and the renderer cannot drift.
 */

export const COMPACTION_THRESHOLD_MIN = 50;
export const COMPACTION_THRESHOLD_MAX = 95;
export const COMPACTION_THRESHOLD_DEFAULT = 85;

/**
 * Normalize any stored or incoming value to an integer in [50,95].
 * Handles missing, string, NaN, Infinity, out-of-range. Rounds to nearest int.
 */
export function normalizeCompactionThresholdPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return COMPACTION_THRESHOLD_DEFAULT;
  }
  const rounded = Math.round(value);
  if (rounded < COMPACTION_THRESHOLD_MIN) return COMPACTION_THRESHOLD_MIN;
  if (rounded > COMPACTION_THRESHOLD_MAX) return COMPACTION_THRESHOLD_MAX;
  return rounded;
}

/**
 * Clamp a known-number to [50,95] with rounding. Use after validation.
 */
export function clampCompactionThresholdPercent(value: number): number {
  const rounded = Math.round(value);
  return Math.min(COMPACTION_THRESHOLD_MAX, Math.max(COMPACTION_THRESHOLD_MIN, rounded));
}

export function compactionPercentToRatio(percent: number): number {
  const normalized = clampCompactionThresholdPercent(percent);
  return normalized / 100;
}

/** For display: tokens -> formatted, but keep raw number here. */
