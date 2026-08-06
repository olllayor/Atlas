import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Track an element's rendered height.
 *
 * The composer floats over the transcript, so the transcript has to reserve
 * exactly as much room at the bottom as the composer currently occupies —
 * and that height moves: staged attachments add a tile row, a long draft
 * grows the textarea, the workspace chips appear and disappear with the
 * session. A hardcoded pad would either clip the last message or leave the
 * dead band this replaced.
 */
export function useMeasuredHeight<T extends HTMLElement>(): {
  ref: (node: T | null) => void;
  height: number;
} {
  const [height, setHeight] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!node) {
      return;
    }

    if (typeof ResizeObserver === 'undefined') {
      setHeight(node.offsetHeight);
      return;
    }

    const observer = new ResizeObserver(() => {
      // `offsetHeight` rather than the entry's content box: the dock's
      // padding is part of the room it takes up.
      setHeight(node.offsetHeight);
    });

    observer.observe(node);
    observerRef.current = observer;
    setHeight(node.offsetHeight);
  }, []);

  useLayoutEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  return { ref, height };
}
