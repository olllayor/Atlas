import assert from 'node:assert/strict';
import test from 'node:test';

import { reasoningTimingId, useTranscriptUiStore } from '../src/renderer/stores/useTranscriptUiStore.js';

/**
 * Regression coverage for `Thought for 2h 46m` on a 3-minute turn.
 *
 * Provider reasoning part ids restart every turn (`reasoning-delta` carries
 * the content-block index, e.g. `"0"`), so every turn's first reasoning run
 * produced the same timing key (`activity-reasoning:0`). A turn that reused
 * the key inherited whatever the store still held for it — a previous turn's
 * window, or an entry left open when a turn was replaced mid-stream — and the
 * label rendered hours instead of seconds.
 */

const HOUR_MS = 3_600_000;

function resetStore() {
  useTranscriptUiStore.setState({ timings: {}, expanded: {} });
}

test.beforeEach(() => {
  resetStore();
});

test.afterEach(() => {
  resetStore();
});

test('timing keys are namespaced by turn', () => {
  assert.equal(reasoningTimingId('activity-reasoning:0', 'turn-b'), 'turn-b:activity-reasoning:0');
  assert.notEqual(
    reasoningTimingId('activity-reasoning:0', 'turn-a'),
    reasoningTimingId('activity-reasoning:0', 'turn-b')
  );
});

test('unscoped keys pass through unchanged', () => {
  assert.equal(reasoningTimingId('activity-reasoning:0'), 'activity-reasoning:0');
  assert.equal(reasoningTimingId('activity-reasoning:0', ''), 'activity-reasoning:0');
});

test('a new turn never inherits an orphaned open entry from an old turn', () => {
  const realNow = Date.now;
  try {
    const turnAStart = 1_000_000;
    Date.now = () => turnAStart;
    // Turn A streams its first reasoning run, then is replaced mid-stream
    // (retry, conversation switch): its cell unmounts, `endTiming` never runs.
    useTranscriptUiStore.getState().startTiming(reasoningTimingId('activity-reasoning:0', 'turn-a'));

    // ~2h46m later turn B streams the same provider part id under its own key.
    Date.now = () => turnAStart + (2 * HOUR_MS + 46 * 60_000 + 14_000);
    const keyB = reasoningTimingId('activity-reasoning:0', 'turn-b');
    useTranscriptUiStore.getState().startTiming(keyB);
    useTranscriptUiStore.getState().endTiming(keyB);

    const durationB = useTranscriptUiStore.getState().timings[keyB]?.durationMs;
    assert.ok(durationB != null && durationB < 60_000, `expected a seconds-long run, got ${durationB}ms`);

    // Turn A's orphan is untouched: closing B must not rewrite history.
    const orphanA = useTranscriptUiStore.getState().timings[reasoningTimingId('activity-reasoning:0', 'turn-a')];
    assert.equal(orphanA?.durationMs, null);
    assert.equal(orphanA?.startedAt, turnAStart);
  } finally {
    Date.now = realNow;
  }
});

test('restarting a closed key measures a fresh window, not the old turn', () => {
  const realNow = Date.now;
  try {
    // A previous turn ran 2h46m of wall clock under this key and closed it.
    Date.now = () => 1_000_000;
    useTranscriptUiStore.getState().startTiming('activity-reasoning:0');
    Date.now = () => 1_000_000 + (2 * HOUR_MS + 46 * 60_000);
    useTranscriptUiStore.getState().endTiming('activity-reasoning:0');

    // The next turn reuses the key: the clock restarts instead of pinning the
    // new run to the previous turn's start.
    const freshStart = 2_000_000;
    Date.now = () => freshStart;
    useTranscriptUiStore.getState().startTiming('activity-reasoning:0');
    const reopened = useTranscriptUiStore.getState().timings['activity-reasoning:0'];
    assert.equal(reopened?.durationMs, null);
    assert.equal(reopened?.startedAt, freshStart);

    Date.now = () => freshStart + 8_000;
    useTranscriptUiStore.getState().endTiming('activity-reasoning:0');
    assert.equal(useTranscriptUiStore.getState().timings['activity-reasoning:0']?.durationMs, 8_000);
  } finally {
    Date.now = realNow;
  }
});

test('repeat starts mid-run do not restart the clock', () => {
  useTranscriptUiStore.getState().startTiming('cell-1');
  const first = useTranscriptUiStore.getState().timings;
  useTranscriptUiStore.getState().startTiming('cell-1');
  assert.equal(useTranscriptUiStore.getState().timings, first);
  assert.equal(useTranscriptUiStore.getState().timings['cell-1']?.durationMs, null);
});

test('a settling hashed id inherits its throwaway predecessor start', () => {
  const realNow = Date.now;
  try {
    Date.now = () => 5_000;
    useTranscriptUiStore.getState().startTiming('turn-c:reasoning:throwaway');
    Date.now = () => 6_000;
    useTranscriptUiStore
      .getState()
      .startTiming('turn-c:reasoning:settled', 'turn-c:reasoning:throwaway');
    assert.equal(
      useTranscriptUiStore.getState().timings['turn-c:reasoning:settled']?.startedAt,
      5_000
    );
  } finally {
    Date.now = realNow;
  }
});
