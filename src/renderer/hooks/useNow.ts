import { useEffect, useState } from 'react';

/**
 * The sidebar's clock. Snooze wakes are derived from the wall clock — nothing
 * fires when a wake time passes — so the shelf memos need a time source that
 * actually moves, or a woken chat sits hidden until the next unrelated
 * render. One shared minute tick: wake labels read in minutes or coarser, so
 * anything faster buys nothing but renders.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
