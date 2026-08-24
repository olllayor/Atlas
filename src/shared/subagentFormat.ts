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
    const ms = Math.max(0, timing.active.through - timing.active.since);
    if (ms < 1000) return `${ms}ms`;
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    return `${min}m ${remSec}s`;
  }
  if (timing.settledMs === 0) return '—';
  const sec = Math.floor(timing.settledMs / 1000);
  return `${sec}s`;
}
