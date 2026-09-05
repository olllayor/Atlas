import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CENTER_MIN,
  DETAILS_MAX,
  DETAILS_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_RAIL,
  clampWidth,
  computeColumns,
} from '../src/renderer/lib/columns.js';

test('clampWidth rounds and clamps into range', () => {
  assert.equal(clampWidth(100.4, 200, 400), 200);
  assert.equal(clampWidth(500.6, 200, 400), 400);
  assert.equal(clampWidth(300.6, 200, 400), 301);
});

test('step 1: everything fits at preferred widths — center absorbs the remainder', () => {
  const solved = computeColumns(1440, 284, 420);
  assert.deepEqual(solved, { sidebar: 284, center: 1440 - 284 - 420, details: 420 });
});

test('step 1: collapsed sidebar resolves to the rail, not zero', () => {
  const solved = computeColumns(1200, 0, 0);
  assert.equal(solved.sidebar, SIDEBAR_RAIL);
  assert.equal(solved.details, 0);
  assert.equal(solved.center, 1200 - SIDEBAR_RAIL);
});

test('step 1: preferences re-clamped into contract ranges', () => {
  // Stale store values (shipped bounds changed) must not break the frame.
  assert.equal(computeColumns(2000, 9999, 9999).sidebar, SIDEBAR_MAX);
  assert.equal(computeColumns(2000, 9999, 9999).details, DETAILS_MAX);
  assert.equal(computeColumns(2000, 10, 10).sidebar, SIDEBAR_MIN);
  assert.equal(computeColumns(2000, 10, 10).details, DETAILS_MIN);
});

test('step 2: workbench shrinks toward its minimum before anything else yields', () => {
  // Sidebar + full workbench + CENTER_MIN overflows, sidebar + minimum does not.
  const viewport = 1200;
  const solved = computeColumns(viewport, 284, 420);

  assert.equal(solved.sidebar, 284, 'sidebar never concedes');
  assert.equal(solved.center, CENTER_MIN, 'center held at its floor');
  assert.equal(solved.details, viewport - 284 - CENTER_MIN);
  assert.ok(solved.details >= DETAILS_MIN && solved.details < 420);
});

test('step 3: under real pressure the workbench closes (derived) and center absorbs the deficit', () => {
  const viewport = 700; // sidebar alone leaves less than CENTER_MIN
  const solved = computeColumns(viewport, 284, 420);

  assert.equal(solved.sidebar, 284);
  assert.equal(solved.details, 0);
  assert.equal(solved.center, viewport - 284);
  assert.ok(solved.center < CENTER_MIN, 'only the final fallback may go below CENTER_MIN');
});

test('preferences are never rewritten by the solve: re-widening restores them', () => {
  const narrow = computeColumns(700, 284, 420); // details derived-closed
  assert.equal(narrow.details, 0);

  const wide = computeColumns(1600, 284, 420);
  assert.equal(wide.details, 420, 'preference survived the squeeze');
});

test('closed workbench stays closed even on a huge display', () => {
  const solved = computeColumns(2560, 284, 0);
  assert.deepEqual(solved, { sidebar: 284, center: 2560 - 284, details: 0 });
});

test('degenerate viewport parks the panes and never goes negative', () => {
  assert.deepEqual(computeColumns(0, 284, 420), { sidebar: 0, center: 0, details: 0 });
  const tiny = computeColumns(-50, 284, 420);
  assert.equal(tiny.center, 0);
});
