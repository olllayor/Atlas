import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveSpinnerArc } from '../src/renderer/components/ui/brush-spinner';

/**
 * The regression this guards: BrushSpinner drove a rotation with requestAnimationFrame
 * and never consulted <html data-reduce-motion>, so Settings → Appearance → Reduce
 * motion left it spinning.
 *
 * The naive fix — stop the rAF loop — is its own bug. The ring is a 70% arc, so
 * freezing it leaves a partial arc parked at an arbitrary angle, which is precisely
 * what a hung app looks like. Under reduced motion the ring must close instead.
 */

const CIRCUMFERENCE = 2 * Math.PI * 10.75; // size 24, strokeWidth 2.5 — the sidebar spinner

test('reduced motion closes the ring so nothing can look frozen part-way round', () => {
  const { dash, gap, animated } = resolveSpinnerArc(true, CIRCUMFERENCE);

  assert.equal(animated, false, 'the rAF loop must not run');
  assert.equal(gap, 0, 'a gap would leave a visible arc terminus, i.e. a stalled angle');
  assert.equal(dash, CIRCUMFERENCE, 'the stroke covers the whole path');
});

test('motion allowed keeps the open arc that reads as a spinner', () => {
  const { dash, gap, animated } = resolveSpinnerArc(false, CIRCUMFERENCE);

  assert.equal(animated, true);
  assert.ok(gap > 0, 'an open arc is what makes the rotation legible');
  assert.ok(dash > 0, 'and there has to be something to rotate');
});

test('the dash pattern always spans exactly one revolution', () => {
  // If dash + gap drifted from the circumference the pattern would repeat or truncate
  // mid-path, so the closed ring would not actually close.
  for (const reduced of [true, false]) {
    for (const circumference of [CIRCUMFERENCE, 2 * Math.PI * 6.25, 100]) {
      const { dash, gap } = resolveSpinnerArc(reduced, circumference);
      assert.ok(
        Math.abs(dash + gap - circumference) < 1e-9,
        `dash + gap must equal the circumference (reduced=${reduced}, c=${circumference})`,
      );
    }
  }
});
