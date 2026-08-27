import type { JobSnapshotView } from '../../shared/contracts';

/**
 * Whole-app projection of the background-job registry.
 *
 * Per-conversation surfaces (chip, Tasks-tab section) read one conversation's
 * roster. The sidebar, activity bell, and ⌘⌥A cycling need the cross-
 * conversation rollup: which conversations have live work right now? Pure
 * data-in/map-out so it unit-tests without a store and both attention
 * derivation sites share one fold.
 */

/** Per-conversation job rollup — the only numbers attention cares about. */
export interface ConversationJobSummary {
  /** Jobs still `running` or `stopping`. */
  readonly live: number;
  /** All jobs ever registered for the conversation (live or settled). */
  readonly total: number;
}

export const EMPTY_JOB_SUMMARY: ConversationJobSummary = { live: 0, total: 0 };

function isLive(job: JobSnapshotView): boolean {
  return job.status === 'running' || job.status === 'stopping';
}

/**
 * Fold snapshots into per-conversation summaries. Registration order is
 * irrelevant here; only counts survive.
 */
export function summarizeJobsByConversation(
  jobs: readonly JobSnapshotView[]
): Map<string, ConversationJobSummary> {
  const byConversation = new Map<string, { live: number; total: number }>();
  for (const job of jobs) {
    const entry = byConversation.get(job.conversationId) ?? { live: 0, total: 0 };
    entry.total += 1;
    if (isLive(job)) entry.live += 1;
    byConversation.set(job.conversationId, entry);
  }
  return byConversation;
}

/**
 * Attention input for one conversation: how many of its jobs are live.
 * Zero when the conversation owns no jobs or they have all settled —
 * settled work must not keep a thread glowing. An absent map (callers that
 * were never handed rollups) is equally quiet.
 */
export function liveJobCountFor(
  summaries: ReadonlyMap<string, ConversationJobSummary> | undefined,
  conversationId: string
): number {
  return summaries?.get(conversationId)?.live ?? 0;
}
