import assert from 'node:assert/strict';
import test from 'node:test';

import { createBuiltInTools } from '../src/main/ai/tools/builtInTools.js';
import type { ToolWorkspace } from '../src/main/ai/tools/toolWorkspace.js';

const MODELS_REPO = { list: () => [], getRuntimeHints: () => ({}) } as never;

function toolNamesFor(mode: 'read-only' | 'ask' | 'full-access', workspace: ToolWorkspace) {
  return Object.keys(createBuiltInTools(MODELS_REPO, null, mode, workspace));
}

const WORK_WITHOUT_PROJECT: ToolWorkspace = { mode: 'work', root: null };
const CODE_WITH_PROJECT: ToolWorkspace = { mode: 'code', root: '/tmp/atlas-project' };

test('update_plan is offered in work mode without a project', () => {
  assert.ok(toolNamesFor('ask', WORK_WITHOUT_PROJECT).includes('update_plan'));
});

test('update_plan is offered in code mode', () => {
  assert.ok(toolNamesFor('ask', CODE_WITH_PROJECT).includes('update_plan'));
});

test('update_plan survives read-only mode', () => {
  // It writes nothing but the checklist in the transcript, and withholding it
  // would degrade planning exactly where the user asked for the most caution.
  const names = toolNamesFor('read-only', CODE_WITH_PROJECT);

  assert.ok(names.includes('update_plan'));
  assert.ok(!names.includes('bash'), 'the side-effecting tools are still withheld');
});

test('update_plan never pauses for approval', () => {
  const tools = createBuiltInTools(MODELS_REPO, null, 'ask', CODE_WITH_PROJECT) as Record<
    string,
    { needsApproval?: unknown }
  >;

  assert.equal(tools.update_plan?.needsApproval, undefined);
});
