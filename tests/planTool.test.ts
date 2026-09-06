import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatToolPart } from '../src/shared/contracts.js';
import {
  derivePlanStepDurations,
  derivePlanTasksView,
  derivePlanView,
  keyPlanSteps,
  normalizePlanSteps,
  parsePlanToolInput,
  planPartsOf,
  type PlanStep,
} from '../src/shared/planTool.js';

function toolPart(overrides: Partial<ChatToolPart> & Pick<ChatToolPart, 'toolName'>): ChatToolPart {
  return {
    id: overrides.id ?? overrides.toolName,
    type: 'tool',
    toolCallId: overrides.toolCallId ?? overrides.id ?? overrides.toolName,
    toolName: overrides.toolName,
    state: 'output-available',
    ...overrides,
  } as ChatToolPart;
}

function planPart(id: string, input: unknown, overrides: Partial<ChatToolPart> = {}): ChatToolPart {
  return toolPart({ toolName: 'update_plan', id, input, ...overrides });
}

const THREE_STEPS: PlanStep[] = [
  { step: 'Read the code', status: 'completed' },
  { step: 'Write the fix', status: 'in_progress' },
  { step: 'Run the tests', status: 'pending' },
];

test('parsePlanToolInput accepts an object payload', () => {
  const parsed = parsePlanToolInput({ explanation: 'starting', plan: THREE_STEPS });

  assert.equal(parsed?.explanation, 'starting');
  assert.deepEqual(parsed?.plan, THREE_STEPS);
});

test('parsePlanToolInput accepts the JSON string the reload merge leaves behind', () => {
  const parsed = parsePlanToolInput(JSON.stringify({ plan: THREE_STEPS }));

  assert.deepEqual(parsed?.plan, THREE_STEPS);
  assert.equal(parsed?.explanation, undefined);
});

test('parsePlanToolInput rejects a preview truncated mid-JSON', () => {
  const full = JSON.stringify({ plan: THREE_STEPS });
  assert.equal(parsePlanToolInput(`${full.slice(0, 40)}…`), null);
});

test('parsePlanToolInput coerces an unknown status to pending', () => {
  const parsed = parsePlanToolInput({ plan: [{ step: 'Ship it', status: 'blocked' }] });

  assert.deepEqual(parsed?.plan, [{ step: 'Ship it', status: 'pending' }]);
});

test('parsePlanToolInput rejects a payload without a plan array', () => {
  assert.equal(parsePlanToolInput({ explanation: 'no steps' }), null);
  assert.equal(parsePlanToolInput({ plan: 'read the code' }), null);
  assert.equal(parsePlanToolInput(null), null);
  assert.equal(parsePlanToolInput([{ step: 'a', status: 'pending' }]), null);
});

test('parsePlanToolInput trims steps and drops empty ones', () => {
  const parsed = parsePlanToolInput({
    explanation: '   ',
    plan: [
      { step: '  Read the code  ', status: 'completed' },
      { step: '   ', status: 'pending' },
      { step: 'Write the fix', status: 'in_progress' },
    ],
  });

  assert.equal(parsed?.explanation, undefined);
  assert.deepEqual(parsed?.plan, [
    { step: 'Read the code', status: 'completed' },
    { step: 'Write the fix', status: 'in_progress' },
  ]);
});

test('parsePlanToolInput keeps an empty plan, which is how a plan is cleared', () => {
  assert.deepEqual(parsePlanToolInput({ plan: [] }), { plan: [] });
});

test('normalizePlanSteps leaves zero or one in_progress alone', () => {
  assert.deepEqual(normalizePlanSteps([]), { steps: [], demotedCount: 0 });
  assert.deepEqual(normalizePlanSteps(THREE_STEPS), { steps: THREE_STEPS, demotedCount: 0 });
});

test('normalizePlanSteps demotes every in_progress after the first', () => {
  const result = normalizePlanSteps([
    { step: 'One', status: 'in_progress' },
    { step: 'Two', status: 'in_progress' },
    { step: 'Three', status: 'in_progress' },
    { step: 'Four', status: 'completed' },
  ]);

  assert.equal(result.demotedCount, 2);
  assert.deepEqual(
    result.steps.map((item) => item.status),
    ['in_progress', 'pending', 'pending', 'completed']
  );
});

test('derivePlanView returns null without plan parts', () => {
  assert.equal(derivePlanView([]), null);
  assert.equal(derivePlanView([toolPart({ toolName: 'bash' })]), null);
});

test('derivePlanView takes the last parseable call and counts it', () => {
  const view = derivePlanView([
    planPart('plan-1', { plan: [{ step: 'Read the code', status: 'in_progress' }] }),
    planPart('plan-2', { explanation: 'halfway', plan: THREE_STEPS }),
  ]);

  assert.equal(view?.total, 3);
  assert.equal(view?.completed, 1);
  assert.equal(view?.explanation, 'halfway');
  assert.equal(view?.updating, false);
  // The first call anchors the cell, so the disclosure key survives updates.
  assert.equal(view?.anchorId, 'plan-1');
});

test('derivePlanView keeps the previous plan while the newest call is still streaming', () => {
  const view = derivePlanView([
    planPart('plan-1', { plan: THREE_STEPS }),
    planPart('plan-2', '{"plan":[{"step":"Wri', { state: 'input-streaming' }),
  ]);

  assert.equal(view?.total, 3);
  assert.equal(view?.updating, true);
  assert.equal(view?.anchorId, 'plan-1');
});

test('derivePlanView falls back to rawInput when input is unusable', () => {
  const view = derivePlanView([
    planPart('plan-1', undefined, { rawInput: JSON.stringify({ plan: THREE_STEPS }) }),
  ]);

  assert.equal(view?.total, 3);
});

test('derivePlanView reports no plan once the model clears it', () => {
  const view = derivePlanView([
    planPart('plan-1', { plan: THREE_STEPS }),
    planPart('plan-2', { plan: [] }),
  ]);

  assert.equal(view, null);
});

test('derivePlanView demotes extra in_progress steps so the display matches the rule', () => {
  const view = derivePlanView([
    planPart('plan-1', {
      plan: [
        { step: 'One', status: 'in_progress' },
        { step: 'Two', status: 'in_progress' },
      ],
    }),
  ]);

  assert.deepEqual(
    view?.steps.map((item) => item.status),
    ['in_progress', 'pending']
  );
});

test('derivePlanView ignores a dynamic tool that happens to be named update_plan', () => {
  const view = derivePlanView([planPart('mcp-1', { plan: THREE_STEPS }, { dynamic: true })]);

  assert.equal(view, null);
});

// ---------------------------------------------------------------------------
// The tasks dock's view: identities, timings, and the current step.
// ---------------------------------------------------------------------------

/** A plan call at a known moment, so durations are assertable rather than wall-clock. */
function timedPlan(id: string, at: string, plan: PlanStep[]): ChatToolPart {
  return planPart(id, { plan }, { startedAt: at });
}

test('keyPlanSteps keeps duplicate step text apart', () => {
  const keys = keyPlanSteps([
    { step: 'Run the tests', status: 'completed' },
    { step: 'Fix the fix', status: 'completed' },
    { step: 'Run the tests', status: 'in_progress' },
  ]).map((entry) => entry.key);

  assert.deepEqual(keys, ['Run the tests:0', 'Fix the fix:0', 'Run the tests:1']);
});

test('planPartsOf keeps only plan calls, in order', () => {
  const ids = planPartsOf([
    { id: 'text-1', type: 'text', text: 'hello', state: 'done' } as never,
    planPart('plan-1', { plan: THREE_STEPS }),
    toolPart({ toolName: 'read_file', id: 'read-1' }),
    planPart('plan-2', { plan: THREE_STEPS }),
  ]).map((part) => part.id);

  assert.deepEqual(ids, ['plan-1', 'plan-2']);
});

test('derivePlanStepDurations times a step from in_progress to completed', () => {
  const durations = derivePlanStepDurations([
    timedPlan('plan-1', '2026-01-01T00:00:00.000Z', [
      { step: 'Read the code', status: 'in_progress' },
      { step: 'Write the fix', status: 'pending' },
    ]),
    timedPlan('plan-2', '2026-01-01T00:00:37.000Z', [
      { step: 'Read the code', status: 'completed' },
      { step: 'Write the fix', status: 'in_progress' },
    ]),
  ]);

  assert.equal(durations.get('Read the code:0'), 37_000);
  // Still running: nothing to measure yet.
  assert.equal(durations.get('Write the fix:0'), undefined);
});

test('derivePlanStepDurations leaves a step that never ran untimed', () => {
  const durations = derivePlanStepDurations([
    timedPlan('plan-1', '2026-01-01T00:00:00.000Z', [{ step: 'Ship it', status: 'pending' }]),
    timedPlan('plan-2', '2026-01-01T00:01:00.000Z', [{ step: 'Ship it', status: 'completed' }]),
  ]);

  assert.equal(durations.size, 0);
});

test('derivePlanStepDurations keeps the first start and the first finish', () => {
  const durations = derivePlanStepDurations([
    timedPlan('plan-1', '2026-01-01T00:00:00.000Z', [{ step: 'Ship it', status: 'in_progress' }]),
    // A revision that repeats the same status must not restart the clock.
    timedPlan('plan-2', '2026-01-01T00:00:10.000Z', [{ step: 'Ship it', status: 'in_progress' }]),
    timedPlan('plan-3', '2026-01-01T00:00:20.000Z', [{ step: 'Ship it', status: 'completed' }]),
    timedPlan('plan-4', '2026-01-01T00:05:00.000Z', [{ step: 'Ship it', status: 'completed' }]),
  ]);

  assert.equal(durations.get('Ship it:0'), 20_000);
});

test('derivePlanStepDurations ignores a plan call with no usable timestamp', () => {
  const durations = derivePlanStepDurations([
    planPart('plan-1', { plan: [{ step: 'Ship it', status: 'in_progress' }] }),
    timedPlan('plan-2', '2026-01-01T00:00:20.000Z', [{ step: 'Ship it', status: 'completed' }]),
  ]);

  assert.equal(durations.size, 0);
});

test('derivePlanTasksView names the running step and carries its timings', () => {
  const view = derivePlanTasksView([
    timedPlan('plan-1', '2026-01-01T00:00:00.000Z', [
      { step: 'Read the code', status: 'in_progress' },
      { step: 'Write the fix', status: 'pending' },
      { step: 'Run the tests', status: 'pending' },
    ]),
    timedPlan('plan-2', '2026-01-01T00:00:37.000Z', [
      { step: 'Read the code', status: 'completed' },
      { step: 'Write the fix', status: 'in_progress' },
      { step: 'Run the tests', status: 'pending' },
    ]),
  ]);

  assert.equal(view?.current?.step, 'Write the fix');
  assert.equal(view?.completed, 1);
  assert.equal(view?.total, 3);
  assert.deepEqual(
    view?.steps.map((step) => step.durationMs),
    [37_000, null, null]
  );
});

test('derivePlanTasksView falls back to the next pending step when none is running', () => {
  const view = derivePlanTasksView([
    planPart('plan-1', {
      plan: [
        { step: 'Read the code', status: 'completed' },
        { step: 'Write the fix', status: 'pending' },
      ],
    }),
  ]);

  assert.equal(view?.current?.step, 'Write the fix');
});

test('derivePlanTasksView has no current step once every step is done', () => {
  const view = derivePlanTasksView([
    planPart('plan-1', { plan: [{ step: 'Ship it', status: 'completed' }] }),
  ]);

  assert.equal(view?.current, null);
  assert.equal(view?.completed, 1);
});

test('derivePlanTasksView times a step whose text repeats earlier in the plan', () => {
  const view = derivePlanTasksView([
    timedPlan('plan-1', '2026-01-01T00:00:00.000Z', [
      { step: 'Run the tests', status: 'completed' },
      { step: 'Run the tests', status: 'in_progress' },
    ]),
    timedPlan('plan-2', '2026-01-01T00:00:05.000Z', [
      { step: 'Run the tests', status: 'completed' },
      { step: 'Run the tests', status: 'completed' },
    ]),
  ]);

  assert.deepEqual(
    view?.steps.map((step) => step.durationMs),
    [null, 5_000]
  );
});
