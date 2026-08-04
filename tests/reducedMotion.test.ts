import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveReducedMotion } from '../src/renderer/lib/reducedMotion';

/**
 * The regression this guards: SlotLabel and runViewTransition used to read
 * `matchMedia('(prefers-reduced-motion: reduce)')` directly, so Settings →
 * Appearance → Reduce motion = On did nothing while the OS preference was off.
 * The attribute is the resolved answer and has to win over the media query.
 */

test('the stamped attribute wins over the system preference', () => {
  // Setting On, OS off - the bug: this used to animate anyway.
  assert.equal(resolveReducedMotion('true', false), true);
  // Setting Off, OS on - the user overrode the OS inside Atlas.
  assert.equal(resolveReducedMotion('false', true), false);
  assert.equal(resolveReducedMotion('true', true), true);
  assert.equal(resolveReducedMotion('false', false), false);
});

test('falls back to the system preference before the attribute is stamped', () => {
  // App.tsx writes the attribute from an effect, so the first paint sees nothing.
  for (const unstamped of [null, undefined, '']) {
    assert.equal(resolveReducedMotion(unstamped, true), true);
    assert.equal(resolveReducedMotion(unstamped, false), false);
  }
});

test('an unrecognised attribute value is not read as "reduce"', () => {
  // Only the two values App.tsx writes are meaningful; anything else defers.
  assert.equal(resolveReducedMotion('off', false), false);
  assert.equal(resolveReducedMotion('yes', true), true);
});
