import assert from 'node:assert/strict';
import test from 'node:test';

import { useTranscriptUiStore } from '../src/renderer/stores/useTranscriptUiStore.js';

/**
 * The handoff between the tasks dock and the transcript's `PlanCell`.
 *
 * Only one of them draws a given plan at a time, and the dock is what decides:
 * it claims the plan while it is showing it and releases it when its turn
 * settles. Getting the release wrong is the failure that matters — a stale
 * claim would hide a finished plan from the transcript for the rest of the
 * session, with nothing on screen to explain why.
 */

test.beforeEach(() => {
  useTranscriptUiStore.setState({ dockPlans: {} });
});

test('a claimed plan is the one the transcript stands down for', () => {
  useTranscriptUiStore.getState().claimDockPlan('plan-1');

  assert.equal(useTranscriptUiStore.getState().dockPlans['plan-1'], true);
  assert.equal(useTranscriptUiStore.getState().dockPlans['plan-2'], undefined);
});

test('releasing hands the plan back to the transcript', () => {
  const { claimDockPlan, releaseDockPlan } = useTranscriptUiStore.getState();
  claimDockPlan('plan-1');
  releaseDockPlan('plan-1');

  assert.deepEqual(useTranscriptUiStore.getState().dockPlans, {});
});

test('two docks can hold their own plans at once', () => {
  // The side chat runs a second composer, and with it a second dock.
  const { claimDockPlan, releaseDockPlan } = useTranscriptUiStore.getState();
  claimDockPlan('main-plan');
  claimDockPlan('side-plan');
  releaseDockPlan('main-plan');

  assert.deepEqual(useTranscriptUiStore.getState().dockPlans, { 'side-plan': true });
});

test('claiming twice does not replace the map, so subscribers do not re-render', () => {
  useTranscriptUiStore.getState().claimDockPlan('plan-1');
  const first = useTranscriptUiStore.getState().dockPlans;
  useTranscriptUiStore.getState().claimDockPlan('plan-1');

  assert.equal(useTranscriptUiStore.getState().dockPlans, first);
});

test('releasing a plan nobody claimed is a no-op', () => {
  const before = useTranscriptUiStore.getState().dockPlans;
  useTranscriptUiStore.getState().releaseDockPlan('never-claimed');

  assert.equal(useTranscriptUiStore.getState().dockPlans, before);
});
