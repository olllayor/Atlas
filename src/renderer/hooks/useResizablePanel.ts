import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pointer-drag resizing for a side panel, with the width persisted.
 *
 * The sidebar previously had no drag affordance at all and its collapsed
 * state lived in component-local React state, so neither survived a
 * restart.
 *
 * Three things this hook is deliberately careful about:
 * 1. **Persistence happens on pointer-up**, not on every animation frame —
 *    a single drag used to write to `localStorage` 60×/second.
 * 2. **The drag is cancel-safe.** `pointercancel` and `lostpointercapture`
 *    end the gesture, so an OS-level interruption cannot leave the panel
 *    stuck in resize mode with listeners still attached.
 * 3. **The whole document gets `col-resize` + `user-select: none`** while
 *    dragging, so the cursor stops flickering to an I-beam and the drag
 *    never selects the text it passes over.
 */
export function useResizablePanel({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  edge = 'start',
  axis = 'horizontal',
}: {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** Which side of the panel the handle sits on. */
  edge?: 'start' | 'end';
  /**
   * `vertical` makes the measured dimension a height and the drag a
   * top-edge drag — what a bottom-docked panel needs. Everything else
   * (persistence, clamping, keyboard steps) is identical.
   */
  axis?: 'horizontal' | 'vertical';
}) {
  const isVertical = axis === 'vertical';
  const [width, setWidth] = useState(() => readStoredNumber(storageKey, defaultWidth, minWidth, maxWidth));
  const [isResizing, setIsResizing] = useState(false);
  const frame = useRef<number | null>(null);
  // Read by the pointerdown handler so it never has to re-create itself (and
  // re-bind) on every pixel of a drag.
  const widthRef = useRef(width);
  widthRef.current = width;

  const persist = useCallback(
    (value: number) => {
      try {
        window.localStorage.setItem(storageKey, String(Math.round(value)));
      } catch {
        // Private mode or a full quota — the panel still works, it just
        // won't remember its width.
      }
    },
    [storageKey]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      setIsResizing(true);

      const start = isVertical ? event.clientY : event.clientX;
      const startWidth = widthRef.current;
      let latest = startWidth;

      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = isVertical ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (moveEvent: PointerEvent) => {
        const position = isVertical ? moveEvent.clientY : moveEvent.clientX;
        // `end` means the handle is on the panel's leading edge (a right
        // sidebar's left edge, a bottom dock's top edge), where moving the
        // pointer *back* is what grows the panel.
        const delta = edge === 'start' ? position - start : start - position;
        const next = Math.min(maxWidth, Math.max(minWidth, startWidth + delta));
        latest = next;

        // Coalesce to one update per frame; pointermove fires far faster
        // than the panel can usefully repaint.
        if (frame.current != null) cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => setWidth(next));
      };

      const finish = (pointerId: number) => {
        if (frame.current != null) {
          cancelAnimationFrame(frame.current);
          frame.current = null;
        }

        setWidth(latest);
        persist(latest);

        try {
          handle.releasePointerCapture?.(pointerId);
        } catch {
          // Capture was already lost — nothing to release.
        }

        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        setIsResizing(false);

        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        handle.removeEventListener('lostpointercapture', onLostCapture);
      };

      const onUp = (upEvent: PointerEvent) => finish(upEvent.pointerId);
      const onLostCapture = (lostEvent: Event) => finish((lostEvent as PointerEvent).pointerId);

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      handle.addEventListener('lostpointercapture', onLostCapture);
    },
    [edge, isVertical, maxWidth, minWidth, persist]
  );

  /** Snap back to the shipped width — bound to Home and to double-click. */
  const reset = useCallback(() => {
    setWidth(defaultWidth);
    persist(defaultWidth);
  }, [defaultWidth, persist]);

  /** Keyboard resizing, so the handle is not mouse-only. */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? 48 : 16;
      const [forward, backward] = isVertical
        ? (['ArrowDown', 'ArrowUp'] as const)
        : (['ArrowRight', 'ArrowLeft'] as const);
      const grow = edge === 'start' ? forward : backward;
      const shrink = edge === 'start' ? backward : forward;

      if (event.key === grow) {
        event.preventDefault();
        setWidth((current) => {
          const next = Math.min(maxWidth, current + step);
          persist(next);
          return next;
        });
      } else if (event.key === shrink) {
        event.preventDefault();
        setWidth((current) => {
          const next = Math.max(minWidth, current - step);
          persist(next);
          return next;
        });
      } else if (event.key === 'Home') {
        event.preventDefault();
        reset();
      }
    },
    [edge, isVertical, maxWidth, minWidth, persist, reset]
  );

  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    []
  );

  return {
    width,
    setWidth,
    isResizing,
    onPointerDown,
    onKeyDown,
    reset,
    defaultWidth,
    minWidth,
    maxWidth,
  };
}

/**
 * Window width as reactive state, for layout math that must respond to
 * resizes (the column solver). Passive listener; resize storms are already
 * cheap at this scale — one `setState` per event on a leaf hook.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return width;
}

/** Boolean UI state that survives a restart. */
export function usePersistentFlag(storageKey: string, defaultValue: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored == null ? defaultValue : stored === 'true';
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(value));
    } catch {
      // Non-fatal, as above.
    }
  }, [storageKey, value]);

  return [value, setValue] as const;
}

function readStoredNumber(key: string, fallback: number, min: number, max: number) {
  try {
    const stored = Number(window.localStorage.getItem(key));
    // A width saved under a different min/max (a shipped bound changed, or the
    // user's font size did) is still a real preference — clamp it into range
    // rather than silently throwing it away.
    if (Number.isFinite(stored) && stored > 0) return Math.min(max, Math.max(min, stored));
  } catch {
    // Fall through to the default.
  }
  return fallback;
}
