import assert from 'node:assert/strict';
import test from 'node:test';

import { updatePlanToolExecute } from '../src/main/ai/tools/planTools.js';

test('updatePlanToolExecute reports the counts back to the model', async () => {
  const result = await updatePlanToolExecute({
    plan: [
      { step: 'Read the code', status: 'completed' },
      { step: 'Write the fix', status: 'in_progress' },
      { step: 'Run the tests', status: 'pending' },
    ],
  });

  assert.equal(result.message, 'Plan updated.');
  assert.equal(result.totalSteps, 3);
  assert.equal(result.completedSteps, 1);
  assert.equal('note' in result, false, 'a well-formed plan needs no correction');
});

test('updatePlanToolExecute tells the model when it demoted extra in_progress steps', async () => {
  const result = await updatePlanToolExecute({
    plan: [
      { step: 'One', status: 'in_progress' },
      { step: 'Two', status: 'in_progress' },
      { step: 'Three', status: 'in_progress' },
    ],
  });

  assert.equal(result.totalSteps, 3);
  assert.match(result.note ?? '', /2 extra in_progress step\(s\) were recorded as pending/);
});

test('updatePlanToolExecute treats an empty plan as a deliberate clear', async () => {
  const result = await updatePlanToolExecute({ plan: [] });

  assert.equal(result.message, 'Plan cleared.');
  assert.equal(result.totalSteps, 0);
  assert.equal(result.completedSteps, 0);
});

test('updatePlanToolExecute drops whitespace-only steps', async () => {
  const result = await updatePlanToolExecute({
    plan: [
      { step: '  Read the code  ', status: 'completed' },
      { step: '   ', status: 'pending' },
    ],
  });

  assert.equal(result.totalSteps, 1);
  assert.equal(result.completedSteps, 1);
});
