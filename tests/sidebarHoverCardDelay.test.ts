import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SIDEBAR_HOVER_CARD_CLOSE_DELAY_MS,
  SIDEBAR_HOVER_CARD_OPEN_DELAY_MS,
  SIDEBAR_HOVER_CARD_SKIP_OPEN_DELAY_MS,
  createSidebarHoverCardDelayStore,
  type HoverCardDelayTimers,
} from '../src/renderer/components/sidebarHoverCardDelay';

/**
 * A hand-cranked clock. The store's whole job is a window measured in
 * milliseconds, and a test that sleeps through those windows is a test nobody
 * runs — so time is injected and advanced by hand.
 */
function createManualClock() {
  let nextId = 1;
  const scheduled = new Map<number, { runAt: number; handler: () => void }>();
  let now = 0;

  const timers: HoverCardDelayTimers = {
    setTimeout: (handler, ms) => {
      const id = nextId++;
      scheduled.set(id, { runAt: now + ms, handler });
      return id;
    },
    clearTimeout: (handle) => {
      scheduled.delete(handle as number);
    },
  };

  return {
    timers,
    get pendingCount() {
      return scheduled.size;
    },
    advance(ms: number) {
      now += ms;
      for (const [id, entry] of [...scheduled]) {
        if (entry.runAt <= now) {
          scheduled.delete(id);
          entry.handler();
        }
      }
    },
  };
}

function createStore() {
  const clock = createManualClock();
  const store = createSidebarHoverCardDelayStore({
    openDelayMs: 320,
    skipWindowMs: 400,
    timers: clock.timers,
  });

  const notifications: number[] = [];
  const unsubscribe = store.subscribe(() => notifications.push(store.getOpenDelay()));

  return { clock, store, notifications, unsubscribe };
}

test('the first card of a run waits, and the next one inside the window does not', () => {
  const { clock, store, notifications } = createStore();

  assert.equal(store.getOpenDelay(), 320);

  // Arming happens on open, not on close: `closeDelay` keeps the card you are
  // leaving on screen while the pointer is already over the next row, and Radix
  // has sampled `openDelay` by then.
  store.notifyOpened();
  assert.equal(store.getOpenDelay(), 0);
  assert.deepEqual(notifications, [0]);

  store.notifyClosed();
  clock.advance(399);
  assert.equal(store.getOpenDelay(), 0);

  clock.advance(1);
  assert.equal(store.getOpenDelay(), 320);
  assert.deepEqual(notifications, [0, 320]);
});

test('a card still open holds the window open with no timer pending', () => {
  const { clock, store } = createStore();

  store.notifyOpened();
  assert.equal(clock.pendingCount, 0);

  // Reading a card for a minute must not expire the group under it.
  clock.advance(10_000);
  assert.equal(store.getOpenDelay(), 0);
});

test('a second close restarts the window instead of stacking a timer', () => {
  const { clock, store, notifications } = createStore();

  store.notifyOpened();
  store.notifyClosed();
  clock.advance(300);
  store.notifyOpened();
  store.notifyClosed();

  assert.equal(clock.pendingCount, 1);
  // Still inside the restarted window, and no redundant notification for a
  // value that never changed.
  clock.advance(300);
  assert.equal(store.getOpenDelay(), 0);
  assert.deepEqual(notifications, [0]);

  clock.advance(100);
  assert.equal(store.getOpenDelay(), 320);
  assert.deepEqual(notifications, [0, 320]);
});

test('losing every subscriber drops the pending window rather than leaking it', () => {
  const { clock, store, unsubscribe } = createStore();

  store.notifyOpened();
  store.notifyClosed();
  assert.equal(clock.pendingCount, 1);

  unsubscribe();
  assert.equal(clock.pendingCount, 0);
  // The next mount starts cold: an instant card for a list that just came back
  // on screen is a card nobody asked for.
  assert.equal(store.getOpenDelay(), 320);
});

test('a subscriber that unsubscribes while being notified does not skip the next one', () => {
  const clock = createManualClock();
  const store = createSidebarHoverCardDelayStore({ timers: clock.timers });

  const seen: string[] = [];
  const stopFirst = store.subscribe(() => {
    seen.push('first');
    stopFirst();
  });
  store.subscribe(() => seen.push('second'));

  store.notifyOpened();
  assert.deepEqual(seen, ['first', 'second']);
});

test('supports an intentional floor on skip-window open delay to debounce fast cursor transit', () => {
  const clock = createManualClock();
  const store = createSidebarHoverCardDelayStore({
    openDelayMs: 320,
    skipOpenDelayMs: 80,
    timers: clock.timers,
  });

  assert.equal(store.getOpenDelay(), 320);
  store.notifyOpened();
  assert.equal(store.getOpenDelay(), 80);
});

test('uses debounced hover defaults: 500ms initial open, 200ms skip floor, 0ms close', () => {
  assert.equal(SIDEBAR_HOVER_CARD_OPEN_DELAY_MS, 500);
  assert.equal(SIDEBAR_HOVER_CARD_SKIP_OPEN_DELAY_MS, 200);
  assert.equal(SIDEBAR_HOVER_CARD_CLOSE_DELAY_MS, 0);
});

