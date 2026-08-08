import { useEffect, useRef, useState, type MutableRefObject } from 'react';

/**
 * The transcript's own read of the scroll container.
 *
 * `use-stick-to-bottom` already listens for `wheel`, but its handler walks
 * up from the event target until it finds an ancestor whose computed
 * `overflow` is `scroll`/`auto` and bails unless that ancestor *is* the
 * scroller. Every `<pre>` in the transcript sets `overflow-x: auto`, which
 * computes `overflow-y: auto` as well, so wheeling up with the pointer over
 * a code block, a diff or terminal output never released the streaming
 * lock — the view yanked itself back down while the user was reading. The
 * same is true for `keydown` (PageUp/Home) and for touch, which the library
 * does not observe at all.
 *
 * So the transcript owns its own intent detection: *any* upward scroll
 * gesture, wherever the pointer is, escapes the lock immediately. Double
 * handling with the library is harmless — both paths converge on the same
 * `stopScroll()`, which is idempotent.
 *
 * The same listener set answers two other questions the library answers
 * badly: whether the user has ever scrolled at all (so auto-load-older does
 * not fire on first paint), and how far from the bottom we are with
 * hysteresis (so the jump-to-latest pill does not strobe at the threshold).
 */

const UPWARD_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);
const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
  'Spacebar',
]);

export type TranscriptScrollState = {
  /**
   * True once the user has moved the scroller themselves. Programmatic
   * scrolls (stick-to-bottom, virtualizer corrections, prepend
   * compensation) never set it.
   */
  userHasScrolledRef: MutableRefObject<boolean>;
  /** Hysteretic "the user is reading history, not the live edge" flag. */
  isScrolledUp: boolean;
  /** Live distance from the bottom, in px. Not reactive — read on demand. */
  distanceFromBottomRef: MutableRefObject<number>;
};

export function useTranscriptScroll({
  element,
  onUserScrollUp,
  showAt = 120,
  hideAt = 40,
}: {
  element: HTMLElement | null;
  /** Called on any upward scroll gesture. Expected to be idempotent. */
  onUserScrollUp: () => void;
  /** Distance from bottom at which "scrolled up" turns on. */
  showAt?: number;
  /** Distance from bottom at which it turns back off. */
  hideAt?: number;
}): TranscriptScrollState {
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const userHasScrolledRef = useRef(false);
  const distanceFromBottomRef = useRef(0);
  const onUserScrollUpRef = useRef(onUserScrollUp);
  onUserScrollUpRef.current = onUserScrollUp;

  useEffect(() => {
    if (!element) {
      return;
    }

    let touchStartY = 0;

    const escapeUp = () => {
      userHasScrolledRef.current = true;
      onUserScrollUpRef.current();
    };

    const handleWheel = (event: WheelEvent) => {
      // Nothing to escape from, and macOS rubber-banding at the bottom
      // emits sub-pixel negative deltas that must not break the lock.
      if (element.scrollHeight <= element.clientHeight) {
        return;
      }
      if (event.deltaY < -1) {
        escapeUp();
      } else if (event.deltaY > 1) {
        userHasScrolledRef.current = true;
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    };

    const handleTouchMove = (event: TouchEvent) => {
      userHasScrolledRef.current = true;
      const y = event.touches[0]?.clientY ?? touchStartY;
      // Finger travelling *down* the screen drags the content down, i.e.
      // scrolls the transcript up.
      if (y - touchStartY > 2) {
        escapeUp();
      }
      touchStartY = y;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(event.key)) {
        return;
      }
      if (UPWARD_KEYS.has(event.key) || (event.key === ' ' && event.shiftKey)) {
        escapeUp();
        return;
      }
      userHasScrolledRef.current = true;
    };

    const measure = () => {
      const distance = Math.max(
        0,
        element.scrollHeight - element.clientHeight - element.scrollTop
      );
      distanceFromBottomRef.current = distance;
      setIsScrolledUp((current) => {
        if (current) {
          return distance > hideAt;
        }
        return distance > showAt;
      });
    };

    element.addEventListener('wheel', handleWheel, { passive: true });
    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: true });
    element.addEventListener('keydown', handleKeyDown);
    element.addEventListener('scroll', measure, { passive: true });

    // The container can also change size without a scroll event (window
    // resize, sidebar collapse, workbench opening).
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
    measure();

    return () => {
      element.removeEventListener('wheel', handleWheel);
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('keydown', handleKeyDown);
      element.removeEventListener('scroll', measure);
      resizeObserver.disconnect();
    };
  }, [element, hideAt, showAt]);

  return { userHasScrolledRef, isScrolledUp, distanceFromBottomRef };
}
