import type { DraftStateLike } from '../components/types';

/**
 * The slice of a live draft that surfaces outside the transcript.
 *
 * The sidebar, the titlebar and the composer all need to know *that* a
 * conversation is streaming, failed or waiting on an approval. None of them
 * needs the tokens. Keeping the two apart matters because `parts` is replaced
 * on every 33ms stream flush while every field below is stable for the whole
 * turn: a subscriber that reads the summary re-renders when the turn changes
 * state, not thirty times a second.
 */
export type DraftSummary = {
  status: DraftStateLike['status'];
  startedAt: string;
  errorMessage?: string;
  /** A tool call in this turn is blocked on the user. Drives the row's mark. */
  hasPendingApproval: boolean;
};

export type DraftSummaryMap = Record<string, DraftSummary>;

export const EMPTY_DRAFT_SUMMARIES: DraftSummaryMap = {};

function hasPendingApproval(draft: DraftStateLike): boolean {
  return draft.parts.some((part) => part.type === 'tool' && part.state === 'approval-requested');
}

function isSameSummary(left: DraftSummary, right: DraftSummary): boolean {
  return (
    left.status === right.status &&
    left.startedAt === right.startedAt &&
    left.errorMessage === right.errorMessage &&
    left.hasPendingApproval === right.hasPendingApproval
  );
}

/**
 * Project the live drafts down to their summaries, reusing `previous` wherever
 * nothing changed.
 *
 * The identity discipline is the whole point and is what callers rely on:
 *
 * - an unchanged conversation keeps its previous summary object, so a shallow
 *   compare of the map passes;
 * - a map whose every entry is unchanged returns `previous` itself, so a
 *   subscriber using `Object.is` never re-renders.
 *
 * Pure, so the caller owns the cache (`useDraftSummaries` holds it in a ref).
 */
export function projectDraftSummaries(
  drafts: Record<string, DraftStateLike | undefined>,
  previous: DraftSummaryMap = EMPTY_DRAFT_SUMMARIES
): DraftSummaryMap {
  const next: DraftSummaryMap = {};
  let changed = false;
  let count = 0;

  for (const [conversationId, draft] of Object.entries(drafts)) {
    if (!draft) continue;
    count += 1;

    const summary: DraftSummary = {
      status: draft.status,
      startedAt: draft.startedAt,
      errorMessage: draft.errorMessage,
      hasPendingApproval: hasPendingApproval(draft),
    };

    const before = previous[conversationId];
    if (before && isSameSummary(before, summary)) {
      next[conversationId] = before;
      continue;
    }

    next[conversationId] = summary;
    changed = true;
  }

  // A dropped conversation leaves the surviving entries equal but the map
  // smaller, which the loop above cannot see.
  if (!changed && count === Object.keys(previous).length) {
    return previous;
  }

  return next;
}
