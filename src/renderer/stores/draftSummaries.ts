import type { ChatToolPart } from '../../shared/contracts';
import type { DraftStateLike } from '../components/types';

export type PendingApprovalSummary = {
  approvalId: string;
  requestId: string;
  toolName: string;
  verb: string;
  subject: string;
  commandSnippet?: string;
};

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
  /** When waiting on approval, surfaces the tool call identifier and intent snippet. */
  pendingApproval?: PendingApprovalSummary | null;
};

export type DraftSummaryMap = Record<string, DraftSummary>;

export const EMPTY_DRAFT_SUMMARIES: DraftSummaryMap = {};

function hasPendingApproval(draft: DraftStateLike): boolean {
  return draft.parts.some((part) => part.type === 'tool' && part.state === 'approval-requested');
}

function extractPendingApproval(draft: DraftStateLike): PendingApprovalSummary | null {
  for (const part of draft.parts) {
    if (part.type === 'tool' && part.state === 'approval-requested' && part.approval?.id) {
      const toolPart = part as ChatToolPart;
      const approvalId = toolPart.approval?.id;
      if (!approvalId) continue;
      let commandSnippet: string | undefined;
      const input =
        toolPart.input && typeof toolPart.input === 'object'
          ? (toolPart.input as Record<string, unknown>)
          : null;

      if (input) {
        if (typeof input.CommandLine === 'string') commandSnippet = input.CommandLine;
        else if (typeof input.command === 'string') commandSnippet = input.command;
        else if (typeof input.cmd === 'string') commandSnippet = input.cmd;
        else if (typeof input.target_file === 'string') commandSnippet = input.target_file;
        else if (typeof input.path === 'string') commandSnippet = input.path;
        else if (typeof input.filePath === 'string') commandSnippet = input.filePath;
        else if (typeof input.query === 'string') commandSnippet = input.query;
      }

      if (!commandSnippet && typeof toolPart.title === 'string' && toolPart.title.trim()) {
        commandSnippet = toolPart.title.trim();
      }
      if (!commandSnippet && typeof toolPart.rawInput === 'string' && toolPart.rawInput.trim()) {
        commandSnippet = toolPart.rawInput.trim().slice(0, 80);
      }

      const toolName = toolPart.toolName || 'tool';
      let verb = 'Approve';
      if (toolName.includes('command') || toolName.includes('bash') || toolName.includes('terminal')) {
        verb = 'Approve command';
      } else if (toolName.includes('write') || toolName.includes('edit') || toolName.includes('create_file')) {
        verb = 'Approve edit to';
      }

      const subject = commandSnippet || toolName;

      return {
        approvalId,
        requestId: toolPart.requestId || draft.requestId,
        toolName,
        verb,
        subject,
        commandSnippet,
      };
    }
  }
  return null;
}

function isSameSummary(left: DraftSummary, right: DraftSummary): boolean {
  return (
    left.status === right.status &&
    left.startedAt === right.startedAt &&
    left.errorMessage === right.errorMessage &&
    left.hasPendingApproval === right.hasPendingApproval &&
    left.pendingApproval?.approvalId === right.pendingApproval?.approvalId &&
    left.pendingApproval?.commandSnippet === right.pendingApproval?.commandSnippet
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
      pendingApproval: extractPendingApproval(draft),
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
