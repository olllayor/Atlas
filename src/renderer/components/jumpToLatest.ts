/**
 * When the jump-to-latest pill shows, and what number it wears.
 *
 * Extracted from `ChatWindow` so the detached state and the below-viewport
 * count stay pure and testable.
 */

export type JumpState = {
  /** The user is reading history and the view is not following the live edge. */
  isDetached: boolean;
  /**
   * Transcript rows the user would land past by jumping: history after the
   * last visible virtualizer row, plus the live streaming row when present.
   */
  messagesBelow: number;
};

/**
 * How many transcript rows sit at or after `lastVisibleIndex + 1`.
 *
 * `lastVisibleIndex` is the virtualizer's visible-range end (not the
 * overscanned render list), so a partially visible last row is already
 * "seen" and is not counted below. `-1` means nothing has been rendered yet.
 */
export function countMessagesBelowViewport({
  messageCount,
  lastVisibleIndex,
  hasStreamingRow = false,
}: {
  messageCount: number;
  lastVisibleIndex: number;
  hasStreamingRow?: boolean;
}): number {
  if (messageCount <= 0) {
    return hasStreamingRow ? 1 : 0;
  }

  const historyBelow = Math.max(0, messageCount - 1 - lastVisibleIndex);
  return historyBelow + (hasStreamingRow ? 1 : 0);
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
  messageCount,
  lastVisibleIndex,
  hasStreamingRow = false,
}: {
  isScrolledUp: boolean;
  isAtBottom: boolean;
  messageCount: number;
  lastVisibleIndex: number;
  hasStreamingRow?: boolean;
}): JumpState {
  const isDetached = isScrolledUp && !isAtBottom;

  return {
    isDetached,
    messagesBelow: isDetached
      ? countMessagesBelowViewport({ messageCount, lastVisibleIndex, hasStreamingRow })
      : 0,
  };
}
