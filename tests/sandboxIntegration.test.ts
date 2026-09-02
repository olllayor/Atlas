import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { bashToolExecute } from '../src/main/ai/tools/toolRuntime.js';
import { detectSandboxMechanism } from '../src/main/ai/tools/sandbox/index.js';
import type { ToolWorkspace } from '../src/main/ai/tools/toolWorkspace.js';

const TIMEOUT_MS = 10_000;

const mechanism = await detectSandboxMechanism();
const notSeatbelt = mechanism !== 'seatbelt';
const notBubblewrap = mechanism !== 'bubblewrap';

function makeProject(options: { withGit: boolean }) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-sandbox-'));

  if (options.withGit) {
    mkdirSync(join(root, '.git'));
  }

  return root;
}

function codeWorkspace(root: string): ToolWorkspace {
  return { mode: 'code', root };
}

function run(command: string, workspace: ToolWorkspace, escalated = false) {
  return bashToolExecute(
    { command, timeout: TIMEOUT_MS, dangerouslyDisableSandbox: escalated || undefined },
    workspace
  );
}

test('seatbelt allows writes inside the project root', { skip: notSeatbelt }, async () => {
  const root = makeProject({ withGit: true });

  try {
    const result = await run('printf hello > inside.txt', codeWorkspace(root));

    assert.equal(result.sandbox, 'seatbelt');
    assert.equal(result.returnCodeInterpretation, 'success');
    assert.ok(existsSync(join(root, 'inside.txt')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('seatbelt denies writes outside every writable root', { skip: notSeatbelt }, async () => {
  const root = makeProject({ withGit: true });
  const outside = join(homedir(), `atlas-sandbox-denied-${process.pid}.txt`);

  try {
    const result = await run(`touch '${outside}'`, codeWorkspace(root));

    assert.notEqual(result.returnCodeInterpretation, 'success');
    assert.equal(existsSync(outside), false);
    assert.equal(result.sandboxDenied, true);
    assert.match(result.sandboxDenialHint ?? '', /dangerouslyDisableSandbox/);
  } finally {
    rmSync(outside, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('seatbelt keeps an existing .git read-only', { skip: notSeatbelt }, async () => {
  const root = makeProject({ withGit: true });

  try {
    const result = await run('touch .git/hooks-smuggled', codeWorkspace(root));

    assert.notEqual(result.returnCodeInterpretation, 'success');
    assert.equal(existsSync(join(root, '.git', 'hooks-smuggled')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('seatbelt blocks creating a missing .git', { skip: notSeatbelt }, async () => {
  const root = makeProject({ withGit: false });

  try {
    const result = await run('mkdir .git', codeWorkspace(root));

    assert.notEqual(result.returnCodeInterpretation, 'success');
    assert.equal(existsSync(join(root, '.git')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('seatbelt allows /dev/null and reads outside the root', { skip: notSeatbelt }, async () => {
  const root = makeProject({ withGit: true });

  try {
    const discarded = await run('echo noise > /dev/null && echo ok', codeWorkspace(root));
    assert.equal(discarded.returnCodeInterpretation, 'success');
    assert.match(discarded.stdout, /ok/);

    const read = await run('cat /etc/hosts > read.txt && echo read-ok', codeWorkspace(root));
    assert.equal(read.returnCodeInterpretation, 'success');
    assert.match(read.stdout, /read-ok/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('seatbelt blocks outbound network in default ask mode', { skip: notSeatbelt }, async () => {
  const root = makeProject({ withGit: true });

  try {
    const hasCurl = await run('command -v curl', codeWorkspace(root));

    if (hasCurl.returnCodeInterpretation !== 'success') {
      return;
    }

    const result = await run('curl -sS --max-time 5 https://example.com', codeWorkspace(root));

    assert.notEqual(result.returnCodeInterpretation, 'success');
    assert.equal(result.sandboxNetwork, 'deny');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('seatbelt allows outbound network in full-access mode', { skip: notSeatbelt }, async () => {
  const root = makeProject({ withGit: true });

  try {
    const hasCurl = await run('command -v curl', codeWorkspace(root));

    if (hasCurl.returnCodeInterpretation !== 'success') {
      return;
    }

    const result = await bashToolExecute(
      { command: 'curl -sS --max-time 5 https://example.com', timeout: TIMEOUT_MS },
      codeWorkspace(root),
      'full-access'
    );

    assert.equal(result.returnCodeInterpretation, 'success');
    assert.equal(result.sandboxNetwork, 'allow');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('seatbelt still confines writes in full-access mode', { skip: notSeatbelt }, async () => {
  const root = makeProject({ withGit: true });
  const outside = join(homedir(), `atlas-sandbox-denied-fa-${process.pid}.txt`);

  try {
    const result = await bashToolExecute(
      { command: `touch '${outside}'`, timeout: TIMEOUT_MS },
      codeWorkspace(root),
      'full-access'
    );

    assert.notEqual(result.returnCodeInterpretation, 'success');
    assert.equal(existsSync(outside), false);
    assert.equal(result.sandboxDenied, true);
    assert.match(result.sandboxDenialHint ?? '', /dangerouslyDisableSandbox/);
    assert.doesNotMatch(result.sandboxDenialHint ?? '', /network access is blocked/);
  } finally {
    rmSync(outside, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('bubblewrap confines writes to the project root', { skip: notBubblewrap }, async () => {
  const root = makeProject({ withGit: true });
  const outside = join(homedir(), `atlas-sandbox-denied-${process.pid}.txt`);

  try {
    const inside = await run('printf hello > inside.txt', codeWorkspace(root));
    assert.equal(inside.sandbox, 'bubblewrap');
    assert.equal(inside.returnCodeInterpretation, 'success');

    const outsideResult = await run(`touch '${outside}'`, codeWorkspace(root));
    assert.notEqual(outsideResult.returnCodeInterpretation, 'success');
    assert.equal(existsSync(outside), false);

    const network = await run('curl -sS --max-time 5 https://example.com', codeWorkspace(root));
    assert.notEqual(network.returnCodeInterpretation, 'success');
  } finally {
    rmSync(outside, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('the escalation flag runs the command unwrapped', async () => {
  const root = makeProject({ withGit: true });
  const outside = join(homedir(), `atlas-sandbox-escalated-${process.pid}.txt`);

  try {
    const result = await run(`touch '${outside}'`, codeWorkspace(root), true);

    assert.equal(result.sandbox, 'none');
    assert.equal(result.sandboxEscalated, mechanism !== 'none');
    assert.equal(result.returnCodeInterpretation, 'success');
    assert.ok(existsSync(outside));
  } finally {
    rmSync(outside, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
