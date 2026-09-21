/**
 * Auto-load-older decision for the chat transcript scroller.
 *
 * Extracted from ChatWindow so the hysteresis can be unit-tested without a
 * DOM. The bug this encodes: a post-prepend `scrollToIndex` lands at the
 * estimated height of the prepended page (almost always past the re-arm
 * threshold), and if that programmatic scroll were allowed to re-arm paging,
 * a later measurement undershoot back into the load zone would drain the
 * whole conversation. Re-arm therefore requires a real user gesture since
 * the last programmatic reset (conversation open, or a page load).
 */

/** Pixels from the top of the scroller that fire a page load. */
export const OLDER_LOAD_PX = 160;
/**
 * Pixels from the top the reader must pass before the next page can arm.
 * The gap between this and `OLDER_LOAD_PX` absorbs a restore that
 * undershoots: the reader has to be a clear screenful away first.
 */
export const OLDER_REARM_PX = 800;

export type AutoLoadInput = {
  scrollTop: number;
  armed: boolean;
  /**
   * True while paging must wait for a user gesture before it may re-arm.
   * Set on conversation open and whenever a load fires; cleared by wheel,
   * touch, or scroll keys — never by `scrollToIndex` or virtualizer
   * corrections.
   */
  needsUserGesture: boolean;
  folded: boolean;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  cursor: string | null;
  lastCursor: string | null;
};

export type AutoLoadAction =
  | { type: 'ignore' }
  | { type: 'rearm' }
  | { type: 'load' };

/**
 * Decide what one scroll event should do to the auto-load state machine.
 *
 * Pure: the caller applies `rearm`/`load` to its refs and side effects.
 */
export function decideAutoLoad(input: AutoLoadInput): AutoLoadAction {
  if (input.scrollTop > OLDER_REARM_PX) {
    // Programmatic restores and the open-at-bottom pin both land here.
    // They must not arm the next page.
    if (input.needsUserGesture) {
      return { type: 'ignore' };
    }
    return { type: 'rearm' };
  }

  if (input.scrollTop > OLDER_LOAD_PX || !input.armed) {
    return { type: 'ignore' };
  }

  // While folded, the top of the *visible* list is the fold boundary, not
  // the top of the history — auto-loading there would page messages the
  // fold is hiding.
  if (input.folded || !input.hasOlder || input.isLoadingOlder || !input.cursor) {
    return { type: 'ignore' };
  }

  if (input.lastCursor === input.cursor) {
    return { type: 'ignore' };
  }

  return { type: 'load' };
}
