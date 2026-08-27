import type { ChatMessagePart, ConversationStatus } from '../../shared/contracts.js';

/**
 * Attention projection — the Codex "Activity" model folded into one level per
 * conversation: what in this thread needs a human, right now?
 *
 * Pure data-in/level-out so it unit-tests without a store and can be reused
 * by sidebar rows, the activity popover, and the ⌘⌥A cycle.
 */

export type AttentionLevel = 'needsInput' | 'running' | 'queued' | 'unread' | 'idle';

export type BackgroundLiveness = 'working' | 'monitoring' | null;

export interface AttentionInput {
  /** Live draft status for this conversation, if one exists. */
  readonly draftStatus?: 'queued' | 'streaming' | 'error' | 'aborted';
  /** A tool call is sitting on an approval card. */
  readonly hasPendingApproval?: boolean;
  /** Subagent-runtime liveness (S6): a parent with working children is busy. */
  readonly backgroundLiveness?: BackgroundLiveness;
  /** Live background jobs (`run_in_background`) owned by this conversation. */
  readonly backgroundJobsLive?: number;
  /** Persisted status — covers turns started before a reload or in another window. */
  readonly conversationStatus?: ConversationStatus;
  /** Follow-ups waiting to run (the durable queue). */
  readonly queuedFollowups?: number;
  /** Assistant turns that finished while this conversation was not selected. */
  readonly unreadCount?: number;
  /**
   * An active /goal: end-of-turn "unread" is expected continuation, not a
   * human's turn (Codex suppresses the same notification). Needs-input and
   * running still surface — only the idle-unread bump is suppressed.
   */
  readonly hasActiveGoal?: boolean;
}

/** Ordering used by both row rendering precedence and the activity popover. */
export const ATTENTION_LEVEL_ORDER: readonly AttentionLevel[] = [
  'needsInput',
  'running',
  'queued',
  'unread',
  'idle',
];

export function deriveAttentionState(input: AttentionInput): AttentionLevel {
  if (input.hasPendingApproval || input.draftStatus === 'error') return 'needsInput';

  const running =
    input.draftStatus === 'streaming' ||
    input.backgroundLiveness === 'working' ||
    (input.backgroundJobsLive ?? 0) > 0 ||
    input.conversationStatus === 'running';
  if (running) return 'running';

  const queued =
    input.draftStatus === 'queued' ||
    input.conversationStatus === 'queued' ||
    (input.queuedFollowups ?? 0) > 0;
  if (queued) return 'queued';

  // While a goal is active, a finished turn is mid-loop, so the unread bump
  // that would otherwise fire on every outer turn stays quiet. A stalled or
  // completed goal clears this flag at the source (status != active).
  const effectiveUnread = input.hasActiveGoal ? 0 : (input.unreadCount ?? 0);
  if (effectiveUnread > 0) return 'unread';

  return 'idle';
}

/** A tool call is awaiting approval when any tool part sits in `approval-requested`. */
export function hasPendingApprovalInParts(parts: readonly ChatMessagePart[] | undefined): boolean {
  if (!parts) return false;
  return parts.some((part) => part.type === 'tool' && part.state === 'approval-requested');
}

/**
 * ⌘⌥A "next chat needing attention". Needs-input first, then running,
 * queued, unread; within a tier most-recent first. The current selection is
 * skipped so mashing the shortcut cycles through *other* threads.
 *
 * @param items - conversations with their attention levels and recency.
 * @param selectedId - currently open conversation, or null.
 * @returns the id to jump to, or null when nothing else needs attention.
 */
export function pickNextAttentionConversation(
  items: ReadonlyArray<{
    readonly id: string;
    readonly level: AttentionLevel;
    readonly timestampMs: number | null;
  }>,
  selectedId: string | null
): string | null {
  let best: { id: string; rank: number; timestampMs: number } | null = null;

  for (const item of items) {
    if (item.level === 'idle' || item.id === selectedId) continue;

    const rank = ATTENTION_LEVEL_ORDER.indexOf(item.level);
    // Unparseable timestamps sort as oldest within their tier.
    const time = item.timestampMs ?? Number.NEGATIVE_INFINITY;

    if (
      best === null ||
      rank < best.rank ||
      (rank === best.rank && time > best.timestampMs)
    ) {
      best = { id: item.id, rank, timestampMs: time };
    }
  }

  return best?.id ?? null;
}
