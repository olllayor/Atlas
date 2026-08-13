import { useSyncExternalStore } from 'react';

/**
 * One shared open delay for every sidebar hover card.
 *
 * A flat per-card delay makes the whole list sticky: scanning down ten rows
 * pays the wait ten times, which is the opposite of what the delay is for. The
 * delay exists to stop cards firing at a pointer that is merely passing
 * through — once one card has actually opened, the user is reading the list,
 * and the next card should be instant. Radix's `Tooltip` gets exactly this from
 * `TooltipProvider`'s `skipDelayDuration`; `HoverCard` ships no provider, so
 * the grouping lives here.
 *
 * It is a module-level store rather than context because Radix reads
 * `openDelay` at pointer-enter time from the current prop value — a ref would
 * update silently and the rows would keep rendering the old number. Subscribers
 * re-render when the skip window opens or closes, so the prop is always the
 * live value.
 */

/** First card of a run: long enough that a pointer crossing rows opens nothing. */
export const SIDEBAR_HOVER_CARD_OPEN_DELAY_MS = 320;

/** How long after the last card closes the next one still opens instantly. */
export const SIDEBAR_HOVER_CARD_SKIP_WINDOW_MS = 400;

export const SIDEBAR_HOVER_CARD_CLOSE_DELAY_MS = 120;

type TimerHandle = unknown;

/** Injected so the window can be driven by a fake clock instead of real time. */
export type HoverCardDelayTimers = {
  setTimeout: (handler: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};

const realTimers: HoverCardDelayTimers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

export type SidebarHoverCardDelayStore = {
  /** The value to hand Radix as `openDelay`: 0 inside the skip window. */
  getOpenDelay: () => number;
  subscribe: (listener: () => void) => () => void;
  /** Call from `onOpenChange` when a card opens; opens the skip window. */
  notifyOpened: () => void;
  /** Call from `onOpenChange` when a card closes; starts the window's timer. */
  notifyClosed: () => void;
};

export function createSidebarHoverCardDelayStore({
  openDelayMs = SIDEBAR_HOVER_CARD_OPEN_DELAY_MS,
  skipWindowMs = SIDEBAR_HOVER_CARD_SKIP_WINDOW_MS,
  timers = realTimers,
}: {
  openDelayMs?: number;
  skipWindowMs?: number;
  timers?: HoverCardDelayTimers;
} = {}): SidebarHoverCardDelayStore {
  const listeners = new Set<() => void>();
  let skipping = false;
  let pending: TimerHandle | null = null;

  const cancelPending = () => {
    if (pending !== null) {
      timers.clearTimeout(pending);
      pending = null;
    }
  };

  // Copied before iterating: a listener that unsubscribes as it runs (React
  // does, on unmount) would otherwise shorten the set mid-loop.
  const emit = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const closeSkipWindow = () => {
    pending = null;
    if (!skipping) {
      return;
    }
    skipping = false;
    emit();
  };

  return {
    getOpenDelay: () => (skipping ? 0 : openDelayMs),

    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
        // The sidebar collapses and unmounts every row. With nobody left to
        // notify, a live window is a timer keeping a module-level store warm
        // for a list that is not on screen — and it would greet the next mount
        // with a stale zero delay.
        if (listeners.size === 0) {
          cancelPending();
          skipping = false;
        }
      };
    },

    /**
     * The window opens the moment a card *opens*, not when it closes — which
     * is also where Radix's own `TooltipProvider` flips `isOpenDelayed`.
     *
     * Closing is too late to be useful: `closeDelay` means the card you are
     * leaving is still open when the pointer enters the next row, and Radix
     * reads `openDelay` at that entry. Arming on close therefore left every
     * row-to-row move paying the full wait, and only helped a pointer that
     * paused outside the list long enough for the close to land first.
     */
    notifyOpened() {
      cancelPending();
      if (skipping) {
        return;
      }
      skipping = true;
      emit();
    },

    notifyClosed() {
      // Each close restarts the window rather than stacking a second timer, so
      // a run of cards keeps the group alive for as long as it lasts.
      cancelPending();
      pending = timers.setTimeout(closeSkipWindow, skipWindowMs);
    },
  };
}

const sidebarHoverCardDelay = createSidebarHoverCardDelayStore();

export function useSidebarHoverCardDelay() {
  return useSyncExternalStore(
    sidebarHoverCardDelay.subscribe,
    sidebarHoverCardDelay.getOpenDelay,
    sidebarHoverCardDelay.getOpenDelay
  );
}

/** Wire straight to a `HoverCard`'s `onOpenChange`. */
export function notifySidebarHoverCardOpenChange(open: boolean) {
  if (open) {
    sidebarHoverCardDelay.notifyOpened();
    return;
  }

  sidebarHoverCardDelay.notifyClosed();
}
