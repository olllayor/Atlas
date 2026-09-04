/**
 * Snooze derivation, ported from T3 Code's `threadSettled.ts` and adapted to
 * Atlas fields.
 */

export type SnoozePresetId = 'hour' | 'three-hours' | 'evening' | 'tomorrow' | 'next-week';

export interface SnoozePreset {
  readonly id: SnoozePresetId;
  readonly label: string;
  /** Menu-row time column, e.g. "9:00 AM". Complements the label. */
  readonly whenLabel: string;
  /** ISO wake time. */
  readonly snoozedUntil: string;
}

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const EVENING_HOUR = 18;
const MORNING_HOUR = 9;

function snoozeTimeOfDayLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function snoozeAtHour(base: Date, hour: number): Date {
  const next = new Date(base);
  next.setHours(hour, 0, 0, 0);
  return next;
}

// Calendar-day advance instead of adding DAY_MS: fixed millisecond offsets
// land on the wrong local day across DST transitions.
function addSnoozeDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Shared "snooze until" choices. "This evening" only appears while it is
 * meaningfully before evening; calendar presets landing on the same instant
 * collapse (on Sundays "Tomorrow" and "Next week" are both Monday morning).
 */
export function resolveSnoozePresets(now: Date): ReadonlyArray<SnoozePreset> {
  const inAnHour = new Date(now.getTime() + HOUR_MS);
  const inThreeHours = new Date(now.getTime() + 3 * HOUR_MS);
  const presets: SnoozePreset[] = [
    {
      id: 'hour',
      label: 'In 1 hour',
      whenLabel: snoozeTimeOfDayLabel(inAnHour),
      snoozedUntil: inAnHour.toISOString(),
    },
    {
      id: 'three-hours',
      label: 'In 3 hours',
      whenLabel: snoozeTimeOfDayLabel(inThreeHours),
      snoozedUntil: inThreeHours.toISOString(),
    },
  ];

  const evening = snoozeAtHour(now, EVENING_HOUR);
  if (evening.getTime() - now.getTime() > HOUR_MS) {
    presets.push({
      id: 'evening',
      label: 'This evening',
      whenLabel: snoozeTimeOfDayLabel(evening),
      snoozedUntil: evening.toISOString(),
    });
  }

  const tomorrow = snoozeAtHour(addSnoozeDays(now, 1), MORNING_HOUR);
  presets.push({
    id: 'tomorrow',
    label: 'Tomorrow',
    whenLabel: snoozeTimeOfDayLabel(tomorrow),
    snoozedUntil: tomorrow.toISOString(),
  });

  const daysUntilMonday = (1 - now.getDay() + 7) % 7 || 7;
  const nextWeek = snoozeAtHour(addSnoozeDays(now, daysUntilMonday), MORNING_HOUR);
  if (nextWeek.getTime() !== tomorrow.getTime()) {
    presets.push({
      id: 'next-week',
      label: 'Next week',
      whenLabel: `${nextWeek.toLocaleDateString(undefined, { weekday: 'short' })} ${snoozeTimeOfDayLabel(nextWeek)}`,
      snoozedUntil: nextWeek.toISOString(),
    });
  }

  return presets;
}

/**
 * Clock label for a wake time: "3:28 PM". Used by the snooze confirmation
 * toast and anywhere else the return time is named rather than counted down.
 */
export function formatSnoozeClockLabel(snoozedUntil: string): string | null {
  const wakeMs = Date.parse(snoozedUntil);
  if (Number.isNaN(wakeMs)) return null;
  return snoozeTimeOfDayLabel(new Date(wakeMs));
}

/**
 * Compact "wakes in" label for snoozed rows: "2h", "18h", "3d". Minutes round
 * up so a snooze never reads "0m" while still hidden.
 */
export function snoozeWakeLabel(snoozedUntil: string, now: number): string {
  const wakeMs = Date.parse(snoozedUntil);
  if (Number.isNaN(wakeMs)) return 'now';
  const remainingMs = wakeMs - now;
  if (remainingMs <= 0) return 'now';
  if (remainingMs < HOUR_MS) return `${Math.max(1, Math.ceil(remainingMs / 60_000))}m`;
  if (remainingMs < DAY_MS) return `${Math.ceil(remainingMs / HOUR_MS)}h`;
  return `${Math.ceil(remainingMs / DAY_MS)}d`;
}

export type SnoozeVisibilityInput = {
  /** Wake time, or null when never snoozed. */
  readonly snoozedUntil: string | null;
  /**
   * True while the chat holds a pending tool approval (blocked-on-you work
   * that arrived after the snooze was applied). Failed turns do NOT count:
   * an explicitly parked chat stays parked until its timer, errors included.
   */
  readonly hasPendingApproval: boolean;
  /** When the current snooze was applied. */
  readonly snoozedAt?: string | null;
  /** When the latest turn completed, if any. */
  readonly completedAt?: string | null;
};

/**
 * Snoozed resolution: hidden from the inbox while the wake time is in the
 * future and nothing demands attention. Timer wakes are derived — no event
 * fires when the time passes; the stale fields simply stop classifying as
 * snoozed. Malformed data never hides a chat.
 *
 * Early raises:
 * - A tool approval arriving after the snooze lifts it early: consent cannot
 *   wait for the timer.
 * - Fresh turn completion: if a turn finishes after the snooze was applied,
 *   fresh output has arrived and the thread raises its hand early.
 */
export function effectiveSnoozed(input: SnoozeVisibilityInput, now: number): boolean {
  if (input.snoozedUntil == null) return false;
  const wakeAtMs = Date.parse(input.snoozedUntil);
  if (Number.isNaN(wakeAtMs)) return false;
  if (wakeAtMs <= now) return false;
  if (input.hasPendingApproval) return false;
  if (
    input.snoozedAt != null &&
    input.completedAt != null &&
    Date.parse(input.completedAt) > Date.parse(input.snoozedAt)
  ) {
    return false;
  }
  return true;
}

/**
 * Derives whether a thread was timer-woken (its snooze wake deadline has elapsed)
 * and has not been acknowledged/dismissed or parked.
 */
export function isTimerWoken(
  input: {
    readonly snoozedUntil: string | null;
    readonly settledAt?: string | null;
    readonly isDismissed?: boolean;
  },
  now: number
): boolean {
  if (input.isDismissed || input.settledAt != null || input.snoozedUntil == null) return false;
  const wakeMs = Date.parse(input.snoozedUntil);
  if (Number.isNaN(wakeMs)) return false;
  return wakeMs <= now;
}
