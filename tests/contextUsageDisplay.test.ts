import assert from 'node:assert/strict';
import test from 'node:test';

import { countMessagesBelowViewport, deriveJumpState } from '../src/renderer/components/jumpToLatest.js';

const loadContext = () => import('../src/renderer/components/ai-elements/context.js');

test('a used context window is never displayed as an empty one', async () => {
  const { formatContextPercentage } = await loadContext();

  // The regression: 0.005% went through toFixed(1) -> "0.0" -> strip ".0" -> "0",
  // so a real prompt against a 200K window rendered identically to no prompt.
  assert.equal(formatContextPercentage(0.005), '<1');
  assert.equal(formatContextPercentage(0.4), '<1');
  assert.equal(formatContextPercentage(0.99), '<1');

  // Only a genuinely untouched window reads zero.
  assert.equal(formatContextPercentage(0), '0');

  // Above 1% the existing precision is kept.
  assert.equal(formatContextPercentage(1), '1');
  assert.equal(formatContextPercentage(4.25), '4.3');
  assert.equal(formatContextPercentage(42.4), '42');
});

test('a window with room left is never displayed as full, and vice versa', async () => {
  const { computeRemainingPercentage, formatContextPercentage } = await loadContext();

  // Reading the window as remaining puts the rounding hazard at BOTH ends.
  // A nearly-full window has a small but real amount left; printing it as
  // "0% left" would claim the conversation cannot continue.
  assert.equal(formatContextPercentage(computeRemainingPercentage(199_200, 200_000)), '<1');
  assert.equal(formatContextPercentage(computeRemainingPercentage(199_999, 200_000)), '<1');

  // The mirror: a barely-touched window must not read as untouched.
  assert.equal(formatContextPercentage(computeRemainingPercentage(400, 200_000)), '>99');
  assert.equal(formatContextPercentage(99.6), '>99');

  // Only the true extremes get an absolute.
  assert.equal(formatContextPercentage(computeRemainingPercentage(0, 200_000)), '100');
  assert.equal(formatContextPercentage(computeRemainingPercentage(200_000, 200_000)), '0');
  // Overflow cannot drive the figure negative.
  assert.equal(formatContextPercentage(computeRemainingPercentage(400_000, 200_000)), '0');
});

test('the colour ramp escalates as headroom falls, not as it grows', async () => {
  const { contextToneForRemaining } = await loadContext();

  // The failure this guards: keying the ramp on the remaining figure while
  // keeping the consumed thresholds would paint a nearly-full window green.
  assert.equal(contextToneForRemaining(100), 'normal');
  assert.equal(contextToneForRemaining(75), 'normal');
  assert.equal(contextToneForRemaining(31), 'normal');

  // Mirrors the consumed ramp it replaces: warning at 70% used, error at 90%.
  assert.equal(contextToneForRemaining(30), 'warning');
  assert.equal(contextToneForRemaining(11), 'warning');
  assert.equal(contextToneForRemaining(10), 'critical');
  assert.equal(contextToneForRemaining(2), 'critical');
  assert.equal(contextToneForRemaining(0), 'critical');
});

test('the spoken label makes the same claim as the visible one', async () => {
  const { toSpokenPercentage } = await loadContext();

  // A screen reader may drop a bare "<", announcing "<1% left" as "1% left".
  assert.equal(toSpokenPercentage('<1'), 'less than 1');
  assert.equal(toSpokenPercentage('>99'), 'more than 99');
  assert.equal(toSpokenPercentage('42'), '42');
  assert.equal(toSpokenPercentage('0'), '0');
  assert.equal(toSpokenPercentage('100'), '100');
});

test('counts only rows after the last visible virtualizer index', () => {
  // 20 rows, viewport ends at index 2 → indexes 3..19 are below (17).
  assert.equal(
    countMessagesBelowViewport({
      messageCount: 20,
      lastVisibleIndex: 2,
    }),
    17
  );
});

test('a partially visible last row is already seen', () => {
  assert.equal(
    countMessagesBelowViewport({
      messageCount: 5,
      lastVisibleIndex: 4,
    }),
    0
  );
});

test('the live streaming row sits outside the virtualizer and still counts', () => {
  assert.equal(
    countMessagesBelowViewport({
      messageCount: 4,
      lastVisibleIndex: 1,
      hasStreamingRow: true,
    }),
    3
  );
});

test('an empty transcript with only a streaming row still has one to jump to', () => {
  assert.equal(
    countMessagesBelowViewport({
      messageCount: 0,
      lastVisibleIndex: -1,
      hasStreamingRow: true,
    }),
    1
  );
});

test('a negative last index cannot overshoot the total', () => {
  assert.equal(
    countMessagesBelowViewport({
      messageCount: 3,
      lastVisibleIndex: -1,
    }),
    3
  );
});

test('content growth while following the bottom does not raise the pill', () => {
  // The reported bug: the virtualizer's estimate ballooned when the streaming
  // row mounted, so the pixel distance said "scrolled up" on a thread nobody
  // had touched. The library was still following, so there was nothing to jump to.
  const state = deriveJumpState({
    isScrolledUp: true,
    isAtBottom: true,
    messageCount: 20,
    lastVisibleIndex: 2,
  });

  assert.equal(state.isDetached, false);
  assert.equal(state.messagesBelow, 0);
});

test('reading history shows the pill with how many rows sit below the viewport', () => {
  const state = deriveJumpState({
    isScrolledUp: true,
    isAtBottom: false,
    messageCount: 20,
    lastVisibleIndex: 2,
  });

  assert.equal(state.isDetached, true);
  assert.equal(state.messagesBelow, 17);
});

test('detached on the last row offers the jump without a count', () => {
  // Scrolled up inside a tall final message: nothing after the last index.
  const state = deriveJumpState({
    isScrolledUp: true,
    isAtBottom: false,
    messageCount: 8,
    lastVisibleIndex: 7,
  });

  assert.equal(state.isDetached, true);
  assert.equal(state.messagesBelow, 0);
});
