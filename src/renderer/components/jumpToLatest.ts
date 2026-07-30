import type { ChatMessage } from '../../shared/contracts';

/**
 * When the jump-to-latest pill shows, and what number it wears.
 *
 * Extracted from `ChatWindow` because both halves had a bug that was invisible
 * inside a component: the pill appeared over threads nobody had scrolled, and
 * it counted the user's own message as unread.
 */

export type JumpState = {
  /** The user is reading history and the view is not following the live edge. */
  isDetached: boolean;
  /** Assistant replies that landed while detached. */
  unreadCount: number;
};

/**
 * Assistant turns that have *finished*.
 *
 * The transcript's message count is the wrong basis. Sending grows it by two in
 * one commit — the optimistic user row plus the assistant row opened for the
 * reply — so a message-count anchor scored "2 new" for text the user had just
 * typed and an answer streaming in front of them. Neither is news:
 *
 * - the user's own send is theirs, and is never an assistant row;
 * - the reply still streaming is visibly happening, and is not yet `complete`.
 */
export function countCompletedAssistantTurns(messages: Pick<ChatMessage, 'role' | 'status'>[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.role === 'assistant' && message.status === 'complete') {
      count += 1;
    }
  }
  return count;
}

/**
 * `isScrolledUp` is a pixel distance and cannot tell "the user scrolled away"
 * from "the content grew underneath us". The virtualizer sizes unmeasured rows
 * from an estimate, so scroll height jumps whenever a streaming row mounts or
 * the calibration shifts — which moved the transcript away from its own bottom
 * with no user input, and raised the pill on an untouched thread.
 *
 * `isAtBottom` comes from the library actively following the bottom, so while it
 * is still following there is nothing to jump to regardless of the pixels.
 */
export function deriveJumpState({
  isScrolledUp,
  isAtBottom,
  completedAssistantCount,
  seenAssistantCount,
}: {
  isScrolledUp: boolean;
  isAtBottom: boolean;
  completedAssistantCount: number;
  seenAssistantCount: number;
}): JumpState {
  const isDetached = isScrolledUp && !isAtBottom;

  return {
    isDetached,
    unreadCount: isDetached ? Math.max(0, completedAssistantCount - seenAssistantCount) : 0,
  };
}
