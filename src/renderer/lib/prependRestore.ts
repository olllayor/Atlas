/**
 * Prepend restore after auto-load-older.
 *
 * The old restore always called `scrollToIndex(prependedCount, { align: 'start' })`,
 * which pins the previously-first row to the top of the viewport. That is only
 * correct when the reader sat at `scrollTop === 0` and never moved while the
 * page was in flight. During long scrolls and long streams the reader is almost
 * never at 0 — they are somewhere in the first screen of the loaded page, and
 * they keep scrolling while `getPage` resolves. Pinning the old first row to
 * y=0 yanks the view.
 *
 * The intended restore keeps a named row at the same viewport offset it had
 * when the load started, then adds whatever the reader scrolled during the
 * in-flight load. The previously-first row is just the usual anchor for a
 * reader parked at the head of the loaded page.
 *
 * The absolute head is the one exception: if `scrollTopNow` is 0 the reader
 * asked for the start of the conversation and the caller should show the
 * newly prepended head rather than re-anchor.
 */

export type PrependRestoreInput = {
  /** Index of the anchor row in the list *before* the prepend. */
  anchorIndex: number;
  /** Pixels from that row's start to `scrollTop` when the load started. */
  pixelDelta: number;
  scrollTopAtStart: number;
  scrollTopNow: number;
  prependedCount: number;
};

export type PrependRestoreTarget = {
  /** Index of the anchor row in the list *after* the prepend. */
  index: number;
  /** Extra pixels to apply after `scrollToIndex(..., { align: 'start' })`. */
  pixelDelta: number;
};

export function computePrependRestore(input: PrependRestoreInput): PrependRestoreTarget {
  const userDelta = input.scrollTopNow - input.scrollTopAtStart;
  return {
    index: input.anchorIndex + input.prependedCount,
    pixelDelta: input.pixelDelta + userDelta,
  };
}
