import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SpillStore } from '../src/main/ai/tools/spill/SpillStore.js';
import {
  COMMAND_SPILL_MAX_BYTES,
  SpillingCommandOutput
} from '../src/main/ai/tools/spill/spillingCommandOutput.js';
import { bashToolExecute, runCommand } from '../src/main/ai/tools/toolRuntime.js';
import type { ToolWorkspace } from '../src/main/ai/tools/toolWorkspace.js';

function createStore() {
  const root = mkdtempSync(join(tmpdir(), 'atlas-spill-cmd-test-'));
  return { root, store: new SpillStore(root) };
}

test('a stream under budget writes no spill file and end() resolves undefined', async () => {
  const { root, store } = createStore();

  try {
    const sink = new SpillingCommandOutput({
      byteBudget: 1024,
      openStream: () => store.openStream({ conversationId: 'c', toolName: 'bash' })
    });

    sink.write('small output\n');
    const path = await sink.end();

    assert.equal(path, undefined);
    assert.equal(sink.truncated, false);
    assert.equal(sink.toString(), 'small output\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a stream over budget tees its FULL content to the spill file', async () => {
  const { root, store } = createStore();

  try {
    const totalLines = 500;
    const lines = Array.from({ length: totalLines }, (_u, i) => `line-${i}`);
    const text = `${lines.join('\n')}\n`;

    const sink = new SpillingCommandOutput({
      byteBudget: 256,
      openStream: () => store.openStream({ conversationId: 'c', toolName: 'bash' })
    });

    sink.write(text);
    const path = await sink.end();

    assert.ok(path, 'expected a spill path after overflow');
    assert.equal(sink.truncated, true);

    // The in-memory preview is bounded (head + tail), but the spill file holds
    // every line, including the middle the preview dropped.
    const spilled = await readFile(path!, 'utf8');
    assert.equal(spilled, text);
    assert.match(sink.toString(), /lines omitted/);
    assert.equal(sink.toString().includes('line-250'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the spill file is capped at maxSpillBytes', async () => {
  const { root, store } = createStore();

  try {
    const sink = new SpillingCommandOutput({
      byteBudget: 64,
      maxSpillBytes: 1_000,
      openStream: () => store.openStream({ conversationId: 'c', toolName: 'bash' })
    });

    // Far more than the 1 KB spill cap, written in chunks.
    for (let i = 0; i < 50; i += 1) {
      sink.write('x'.repeat(200));
    }

    const path = await sink.end();

    assert.ok(path, 'expected a spill path after overflow');
    const spilled = await readFile(path!, 'utf8');
    assert.ok(
      Buffer.byteLength(spilled, 'utf8') <= 1_000,
      `spill file exceeded its cap: ${spilled.length} bytes`
    );
    // The in-memory preview still retains head + tail even though capture stopped.
    assert.equal(sink.truncated, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failed openStream falls back to the bounded preview without throwing', async () => {
  const sink = new SpillingCommandOutput({
    byteBudget: 64,
    openStream: () => Promise.reject(new Error('disk full'))
  });

  // A single newline-free line longer than the head+tail line caps, so the
  // bounded preview actually drops content and reports truncated.
  sink.write('y'.repeat(5_000));
  const path = await sink.end();

  assert.equal(path, undefined);
  assert.equal(sink.truncated, true);
  assert.ok(sink.toString().length > 0);
});

test('runCommand reports a spill path for an overflowing stream', async () => {
  const { root, store } = createStore();

  try {
    const result = await runCommand(
      process.execPath,
      ['-e', "for (let i = 0; i < 3000; i += 1) process.stdout.write(`out-${i}\\n`);"],
      {
        maxOutputBytes: 1024,
        spillSink: () =>
          new SpillingCommandOutput({
            byteBudget: 1024,
            openStream: () => store.openStream({ conversationId: 'c', toolName: 'bash' })
          })
      }
    );

    assert.equal(result.stdoutTruncated, true);
    assert.ok(result.stdoutSpillPath, 'expected stdoutSpillPath');

    const spilled = await readFile(result.stdoutSpillPath!, 'utf8');
    assert.match(spilled, /^out-0\n/);
    assert.match(spilled, /out-2999\n$/);
    // The full stream is intact, not the bounded preview.
    assert.equal(spilled.includes('out-1500\n'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bashToolExecute spills an oversized stream and reports a compact preview', async () => {
  const { root, store } = createStore();
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'atlas-bash-spill-ws-'));

  try {
    const workspace: ToolWorkspace = {
      mode: 'code',
      root: workspaceRoot,
      conversationId: 'conversation-spill',
      spillStore: store
    };

    // ~1.3 MiB of stdout, over the 1 MiB ingest budget.
    const result = await bashToolExecute(
      {
        command: `${process.execPath} -e 'for (let i = 0; i < 120000; i += 1) process.stdout.write("line-" + i + "\\n")'`,
        timeout: 30_000
      },
      workspace
    );

    assert.equal(result.outputSpilled, true);
    assert.ok(result.stdoutSpillPath, 'expected stdoutSpillPath on the tool result');

    // The inline stdout is a compact preview with a locator, not the full 1.3 MiB.
    assert.ok(result.stdout.length < 60_000, `inline stdout too large: ${result.stdout.length}`);
    assert.match(result.stdout, /Full output stored at:/);
    assert.match(result.stdout, /read_file/);

    // The spill file holds the complete stream.
    const spilled = await readFile(result.stdoutSpillPath!, 'utf8');
    assert.match(spilled, /^line-0\n/);
    assert.match(spilled, /line-119999\n$/);
    assert.equal(spilled.includes('line-60000\n'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('bashToolExecute without a spill store keeps the legacy bounded behavior', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'atlas-bash-nospill-ws-'));

  try {
    const workspace: ToolWorkspace = { mode: 'code', root: workspaceRoot };

    const result = await bashToolExecute(
      {
        command: `${process.execPath} -e 'for (let i = 0; i < 120000; i += 1) process.stdout.write("line-" + i + "\\n")'`,
        timeout: 30_000
      },
      workspace
    );

    assert.equal('outputSpilled' in result, false);
    assert.equal('stdoutSpillPath' in result, false);
    assert.equal(result.outputTruncated, true);
    assert.match(result.stdout, /lines omitted/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('COMMAND_SPILL_MAX_BYTES matches the dsh default of 64 MiB', () => {
  assert.equal(COMMAND_SPILL_MAX_BYTES, 64 * 1024 * 1024);
});
