import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DISCLOSURE_ANCHOR_MS,
  LIVE_EDGE_THRESHOLD_PX,
  isPinnedToBottom,
  shouldAnchorDisclosure,
} from '../src/renderer/lib/scrollAnchor.js';

function geometry(overrides: { scrollHeight: number; scrollTop: number; clientHeight: number }) {
  return overrides;
}

test('isPinnedToBottom owns the live edge within the threshold', () => {
  // Exactly at the bottom.
  assert.equal(isPinnedToBottom(geometry({ scrollHeight: 2000, scrollTop: 1500, clientHeight: 500 })), true);
  // 40px of slack still counts as following.
  assert.equal(
    isPinnedToBottom(geometry({ scrollHeight: 2000, scrollTop: 1460, clientHeight: 500 })),
    true
  );
  // Past the threshold the reader owns the position.
  assert.equal(
    isPinnedToBottom(geometry({ scrollHeight: 2000, scrollTop: 1400, clientHeight: 500 })),
    false
  );
});

test('isPinnedToBottom threshold is configurable', () => {
  const el = geometry({ scrollHeight: 1000, scrollTop: 900, clientHeight: 50 });
  assert.equal(isPinnedToBottom(el, 100), true);
  assert.equal(isPinnedToBottom(el, 10), false);
});

test('shouldAnchorDisclosure skips blocks fully below the viewport', () => {
  assert.equal(shouldAnchorDisclosure(-400, 600), true, 'above the viewport anchors');
  assert.equal(shouldAnchorDisclosure(300, 600), true, 'visible block anchors');
  assert.equal(shouldAnchorDisclosure(600, 600), true, 'edge-straddling block anchors');
  assert.equal(shouldAnchorDisclosure(601, 600), false, 'fully-below block grows into unseen space');
});

test('anchor constants stay in sync with the transcript hysteresis', () => {
  assert.equal(LIVE_EDGE_THRESHOLD_PX, 40);
  assert.ok(DISCLOSURE_ANCHOR_MS >= 200, 'covers the 160ms disclosure animation plus settle');
});
