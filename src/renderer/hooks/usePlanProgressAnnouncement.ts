import { useEffect, useRef, useState } from 'react';

/**
 * Announce plan progress only when it changes in front of the reader.
 *
 * Same reasoning as `useTerminalTransitions` in `ToolCell`: the transcript is
 * virtualized, so a plan row remounts whenever it scrolls back into view, and
 * announcing on mount would replay every plan in the thread. The first
 * observation therefore only records the baseline — it never speaks.
 *
 * Shared by the two surfaces that draw a plan, because only one of them is on
 * screen at a time: the tasks dock owns the live turn, `PlanCell` takes it back
 * once the turn settles. Whichever is mounted is the one that speaks, and the
 * `label` is what tells the reader which surface is talking.
 */
export function usePlanProgressAnnouncement(
  completed: number | null,
  total: number | null,
  label = 'Plan'
): string {
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (completed == null || total == null) {
      return;
    }

    const current = `${completed}/${total}`;
    const seen = previous.current;
    previous.current = current;

    if (seen !== null && seen !== current) {
      setAnnouncement(`${label}: ${completed} of ${total} complete`);
    }
  }, [completed, total, label]);

  return announcement;
}
