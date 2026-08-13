import assert from 'node:assert/strict';
import test from 'node:test';

import { countCompletedAssistantTurns, deriveJumpState } from '../src/renderer/components/jumpToLatest.js';

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

test('only finished assistant replies count as arrivals', () => {
  const messages = [
    { role: 'user' as const, status: 'complete' as const },
    { role: 'assistant' as const, status: 'complete' as const },
    { role: 'user' as const, status: 'complete' as const },
    // The reply currently streaming is visibly happening, not news.
    { role: 'assistant' as const, status: 'streaming' as const },
  ];

  assert.equal(countCompletedAssistantTurns(messages), 1);
});

test('content growth while following the bottom does not raise the pill', () => {
  // The reported bug: the virtualizer's estimate ballooned when the streaming
  // row mounted, so the pixel distance said "scrolled up" on a thread nobody
  // had touched. The library was still following, so there was nothing to jump to.
  const state = deriveJumpState({
    isScrolledUp: true,
    isAtBottom: true,
    completedAssistantCount: 5,
    seenAssistantCount: 3,
  });

  assert.equal(state.isDetached, false);
  assert.equal(state.unreadCount, 0);
});

test('reading history shows the pill, and counts only what arrived since', () => {
  const state = deriveJumpState({
    isScrolledUp: true,
    isAtBottom: false,
    completedAssistantCount: 5,
    seenAssistantCount: 3,
  });

  assert.equal(state.isDetached, true);
  assert.equal(state.unreadCount, 2);
});

test('scrolling up with nothing new offers the jump without a count', () => {
  const state = deriveJumpState({
    isScrolledUp: true,
    isAtBottom: false,
    completedAssistantCount: 3,
    seenAssistantCount: 3,
  });

  assert.equal(state.isDetached, true);
  assert.equal(state.unreadCount, 0);
});

test('sending a message cannot register as unread', () => {
  // Sending adds a user row and opens a streaming assistant row in one commit.
  // Neither is a completed assistant turn, so the count cannot move — which is
  // what produced the bogus "2 new" on a freshly sent message.
  const before = countCompletedAssistantTurns([
    { role: 'user', status: 'complete' },
    { role: 'assistant', status: 'complete' },
  ]);
  const afterSend = countCompletedAssistantTurns([
    { role: 'user', status: 'complete' },
    { role: 'assistant', status: 'complete' },
    { role: 'user', status: 'complete' },
    { role: 'assistant', status: 'streaming' },
  ]);

  assert.equal(afterSend, before);
  assert.equal(
    deriveJumpState({
      isScrolledUp: true,
      isAtBottom: false,
      completedAssistantCount: afterSend,
      seenAssistantCount: before,
    }).unreadCount,
    0
  );
});

test('a stale anchor from a longer thread cannot go negative', () => {
  const state = deriveJumpState({
    isScrolledUp: true,
    isAtBottom: false,
    completedAssistantCount: 1,
    seenAssistantCount: 9,
  });

  assert.equal(state.unreadCount, 0);
});
