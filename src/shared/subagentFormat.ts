/**
 * Subagent timing display contract — shared between main (projections) and
 * renderer (catalog) so the formatting cannot drift between processes.
 *
 * `settledMs` sums persisted assistant-turn latencies; a child that has never
 * completed a turn reports 0, whose display contract is an em dash, never "0s".
 */

export type SubagentTiming = {
  /** Milliseconds accumulated across completed turns. */
  settledMs: number;
  /** Open turn interval, if the child is mid-turn right now. */
  active?: { since: number; through: number };
};

export function formatTiming(timing: SubagentTiming): string {
  if (timing.active) {
    return formatShortDuration(Math.max(0, timing.active.through - timing.active.since));
  }
  if (timing.settledMs === 0) return '—';
  return formatShortDuration(Math.max(0, timing.settledMs));
}

/**
 * Compact duration for subagent rows: `500ms` · `5s` · `1m 5s` · `1h 1m 1s`.
 *
 * Hours ported from t3code PR #9894, which added them to the shared
 * `formatDuration` after long runs rendered as ever-growing minute counts.
 * Zero parts are omitted above an hour (`1h`, not `1h 0m 0s`).
 */
function formatShortDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours === 0) {
    return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
  }
  const parts = [`${hours}h`];
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}
