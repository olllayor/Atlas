/**
 * Scroll anchoring for disclosure toggles in the transcript.
 *
 * Expanding a reasoning block, tool detail, or activity fold above the
 * viewport grows the scrollable content above the reader, which shoves the
 * visible text downward. The fix is FLIP-style: record where the toggled
 * block sits relative to the viewport before the change, then restore that
 * offset after layout. Measuring positions (not adding height deltas) keeps
 * this safe alongside the virtualizer's own scroll correction — whatever it
 * already compensated shows up as a ~0 residual and becomes a no-op.
 */

type ScrollGeometry = Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>;

/** How long a disclosure's open animation is tracked after a toggle. */
export const DISCLOSURE_ANCHOR_MS = 260;

/** Inside this distance from the bottom the live-follow owns the position. */
export const LIVE_EDGE_THRESHOLD_PX = 40;

/**
 * True while the view follows the live edge. Anchoring must stand down
 * there — restoring a block offset would fight the stick-to-bottom pin
 * (e.g. an activity fold auto-collapsing as the answer streams in).
 */
export function isPinnedToBottom(el: ScrollGeometry, threshold = LIVE_EDGE_THRESHOLD_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/**
 * True when a toggle at this position can move the reader. A block fully
 * below the viewport grows downward into unseen space, so there is nothing
 * to hold still; anything at or above the bottom edge can shove content.
 */
export function shouldAnchorDisclosure(blockTop: number, viewportBottom: number): boolean {
  return blockTop <= viewportBottom;
}
