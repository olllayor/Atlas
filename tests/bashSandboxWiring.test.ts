import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createBuiltInTools } from '../src/main/ai/tools/builtInTools.js';
import { detectSandboxMechanism } from '../src/main/ai/tools/sandbox/index.js';
import { bashToolExecute } from '../src/main/ai/tools/toolRuntime.js';
import type { ToolWorkspace } from '../src/main/ai/tools/toolWorkspace.js';

const modelsRepo = { list: () => [] } as never;

const mechanism = await detectSandboxMechanism();

function bashTool(mode: Parameters<typeof createBuiltInTools>[2], workspace?: ToolWorkspace) {
  const tools = createBuiltInTools(modelsRepo, null, mode, workspace) as Record<
    string,
    { description?: string; needsApproval?: unknown }
  >;
  return tools.bash;
}

test('a work-mode command reports the sandbox it ran under', async () => {
  const result = await bashToolExecute({ command: 'echo hello', timeout: 10_000 }, { mode: 'work', root: null });

  assert.equal(result.sandbox, mechanism);
  assert.equal(result.sandboxNetwork, 'deny');
  assert.equal(result.sandboxEscalated, false);
  assert.match(result.stdout, /hello/);
});

test('the result no longer echoes the raw escalation flag', async () => {
  const result = await bashToolExecute(
    { command: 'echo hello', timeout: 10_000, dangerouslyDisableSandbox: true },
    { mode: 'work', root: null }
  );

  assert.equal('dangerouslyDisableSandbox' in result, false);
  assert.equal(result.sandbox, 'none');
  assert.equal(result.sandboxEscalated, mechanism !== 'none');
});

test('a background command reports the sandbox but expects no output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-bash-wiring-'));

  try {
    const result = await bashToolExecute(
      { command: 'true', run_in_background: true },
      { mode: 'code', root }
    );

    assert.equal(result.sandbox, mechanism);
    assert.equal(result.returnCodeInterpretation, 'backgrounded');
    assert.equal(result.noOutputExpected, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('full-access runs without pausing, including outside the sandbox', async () => {
  assert.equal(bashTool('full-access')?.needsApproval, false);
  assert.equal(bashTool('ask')?.needsApproval, true);
});

test('the bash description matches what the host can enforce', () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-bash-describe-'));

  try {
    const codeDescription = bashTool('ask', { mode: 'code', root })?.description ?? '';
    const workDescription = bashTool('ask', { mode: 'work', root: null })?.description ?? '';

    if (process.platform === 'win32') {
      assert.equal(/sandbox/i.test(codeDescription), false);
      assert.equal(/sandbox/i.test(workDescription), false);
      return;
    }

    assert.match(codeDescription, /OS sandbox/);
    assert.match(codeDescription, /network access is blocked/);
    assert.match(workDescription, /OS sandbox/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the bash description in full-access mode advertises network access', () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-bash-describe-fa-'));

  try {
    const codeDescription = bashTool('full-access', { mode: 'code', root })?.description ?? '';

    if (process.platform === 'win32') {
      assert.equal(/sandbox/i.test(codeDescription), false);
      return;
    }

    assert.match(codeDescription, /OS sandbox/);
    assert.match(codeDescription, /Network access is enabled/);
    assert.doesNotMatch(codeDescription, /network access is blocked/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a full-access command executes with network allowed through builtInTools', async () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-bash-exec-fa-'));

  try {
    const tool = bashTool('full-access', { mode: 'code', root }) as {
      execute: (input: { command: string }) => Promise<{ sandboxNetwork?: string }>;
    };
    const result = await tool.execute({ command: 'echo hello' });

    assert.equal(result.sandboxNetwork, 'allow');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
