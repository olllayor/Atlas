import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BackgroundJobRegistry,
  capOutputText,
  formatCompletionNotice
} from '../src/main/ai/jobs/BackgroundJobRegistry.js';
import { startBackgroundBashJob } from '../src/main/ai/jobs/bashJobProducer.js';
import { bashToolExecute } from '../src/main/ai/tools/toolRuntime.js';
import { buildJobCompletionNoticeMessage, createJobTools } from '../src/main/ai/tools/jobTools.js';
import { createBuiltInTools } from '../src/main/ai/tools/builtInTools.js';
import { SIDE_EFFECTING_TOOL_NAMES } from '../src/shared/chatParameters.js';

/*
 * Behavior suite for the background-jobs protocol, ported from DeepSeek
 * Harness's jobs/jobs-local/tool-jobs specs: branded ids, owner fencing,
 * first-wins settlement, kill-before-status, exactly-once completion
 * notices, teardown — plus the bash producer against real child processes
 * and the model-facing tools.
 */

/** A controllable producer: the test owns cancel/settle/read. */
function scriptedProducer(
  options: { output?: string; readOutput?: () => string; peekTail?: (lines: number) => string[] } = {}
) {
  let resolveDone!: (outcome: { status: 'completed' | 'killed' | 'failed'; detail?: string; output?: string }) => void;
  const done = new Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string; output?: string }>(
    (resolve) => {
      resolveDone = resolve;
    }
  );
  const cancels: Array<string | undefined> = [];

  const hooks = {
    cancel: (reason?: string) => {
      cancels.push(reason);
    },
    done,
    ...(options.readOutput ? { readOutput: options.readOutput } : {}),
    ...(options.peekTail ? { peekTail: options.peekTail } : {})
  };

  return { hooks, resolveDone, cancels, output: options.output };
}

// ---------------------------------------------------------------------------
// Registry: ids, validation, fencing
// ---------------------------------------------------------------------------

test('start issues branded ids per kind, incrementing', () => {
  const registry = new BackgroundJobRegistry();
  const a = scriptedProducer();
  const b = scriptedProducer();
  const c = scriptedProducer();

  const id1 = registry.start({ kind: 'bash', label: 'one', conversationId: 'conv', run: () => a.hooks });
  const id2 = registry.start({ kind: 'bash', label: 'two', conversationId: 'conv', run: () => b.hooks });

  assert.equal(id1, 'bash-1');
  assert.equal(id2, 'bash-2');

  // Counters are per-kind, not global.
  const id3 = registry.start({ kind: 'bash', label: 'three', conversationId: 'other', run: () => c.hooks });
  assert.equal(id3, 'bash-3');
});

test('start validates the spec before running the producer', () => {
  const registry = new BackgroundJobRegistry();

  assert.throws(
    () => registry.start({ kind: '' as never, label: 'x', conversationId: 'c', run: () => scriptedProducer().hooks }),
    /invalid job kind/
  );
  assert.throws(
    () => registry.start({ kind: 'bash', label: '   ', conversationId: 'c', run: () => scriptedProducer().hooks }),
    /invalid job label/
  );
  assert.throws(
    () => registry.start({ kind: 'bash', label: 'x', conversationId: '', run: () => scriptedProducer().hooks }),
    /invalid job owner/
  );
  assert.throws(
    () =>
      registry.start({
        kind: 'bash',
        label: 'x',
        conversationId: 'c',
        outputLimitBytes: 0,
        run: () => scriptedProducer().hooks
      }),
    /invalid outputLimitBytes/
  );
  assert.equal(registry.list('c').length, 0);
});

test('a run() throw leaves nothing registered', () => {
  const registry = new BackgroundJobRegistry();

  assert.throws(
    () =>
      registry.start({
        kind: 'bash',
        label: 'boom',
        conversationId: 'c',
        run: () => {
          throw new Error('spawn failed');
        }
      }),
    /spawn failed/
  );
  assert.equal(registry.list('c').length, 0);
  assert.equal(registry.activeCount('c'), 0);
});

test('the per-conversation bucket cap rejects starts past the limit', () => {
  const registry = new BackgroundJobRegistry(2);
  registry.start({ kind: 'bash', label: 'a', conversationId: 'c', run: () => scriptedProducer().hooks });
  registry.start({ kind: 'bash', label: 'b', conversationId: 'c', run: () => scriptedProducer().hooks });

  assert.throws(
    () => registry.start({ kind: 'bash', label: 'c', conversationId: 'c', run: () => scriptedProducer().hooks }),
    /background job limit reached/
  );

  // Another conversation's bucket is independent.
  const id = registry.start({ kind: 'bash', label: 'd', conversationId: 'other', run: () => scriptedProducer().hooks });
  assert.equal(id, 'bash-3');
});

test('get/list are fenced by conversation and hand out fresh snapshots', () => {
  const registry = new BackgroundJobRegistry();
  registry.start({ kind: 'bash', label: 'mine', conversationId: 'conv-a', run: () => scriptedProducer().hooks });
  registry.start({ kind: 'bash', label: 'theirs', conversationId: 'conv-b', run: () => scriptedProducer().hooks });

  assert.equal(registry.list('conv-a').length, 1);
  assert.equal(registry.list('conv-a')[0].label, 'mine');
  assert.equal(registry.list('conv-b').length, 1);

  const first = registry.get('bash-1')!;
  const second = registry.get('bash-1')!;
  assert.notEqual(first, second); // fresh projection, never live state
  assert.deepEqual(first, second);

  assert.throws(() => registry.read('bash-1', 'conv-b'), /belongs to another conversation/);
  assert.throws(() => registry.kill('bash-1', 'conv-b'), /belongs to another conversation/);
  assert.throws(() => registry.read('nope-9', 'conv-a'), /no background job/);
});

// ---------------------------------------------------------------------------
// Registry: settlement, kill, wait, notices
// ---------------------------------------------------------------------------

test('settlement is first-wins and notifies listeners once', async () => {
  const registry = new BackgroundJobRegistry();
  const producer = scriptedProducer();
  const seen: string[] = [];
  registry.onJobDone((snapshot) => seen.push(`${snapshot.id}:${snapshot.status}`));

  const id = registry.start({ kind: 'bash', label: 'x', conversationId: 'c', run: () => producer.hooks });
  producer.resolveDone({ status: 'completed', detail: 'exit code: 0', output: 'done' });
  await registry.wait(id, 1_000, 'c');

  // A second settlement attempt is ignored (the producer cannot double-settle).
  producer.resolveDone({ status: 'failed', detail: 'late' });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(registry.get(id)!.status, 'completed');
  assert.deepEqual(seen, ['bash-1:completed']);
});

test('a rejecting done promise settles as failed instead of hanging', async () => {
  const registry = new BackgroundJobRegistry();
  const done = Promise.reject(new Error('producer bug'));
  const id = registry.start({
    kind: 'bash',
    label: 'x',
    conversationId: 'c',
    run: () => ({ cancel: () => {}, done })
  });

  const snapshot = await registry.wait(id, 1_000, 'c');
  assert.equal(snapshot.status, 'failed');
  assert.ok(snapshot.detail!.includes('producer bug'));
});

test('kill invokes producer cancellation before changing status', () => {
  const registry = new BackgroundJobRegistry();
  const order: string[] = [];
  const id = registry.start({
    kind: 'bash',
    label: 'x',
    conversationId: 'c',
    run: () => ({
      cancel: () => order.push('cancel'),
      done: new Promise(() => {})
    })
  });

  const snapshot = registry.kill(id, 'c', 'user asked');
  assert.deepEqual(order, ['cancel']);
  assert.equal(snapshot.status, 'stopping');
  assert.equal(registry.get(id)!.status, 'stopping');
});

test('killing a terminal job returns its snapshot without re-cancelling', async () => {
  const registry = new BackgroundJobRegistry();
  const producer = scriptedProducer();
  const id = registry.start({ kind: 'bash', label: 'x', conversationId: 'c', run: () => producer.hooks });
  producer.resolveDone({ status: 'completed', detail: 'exit code: 0' });
  await registry.wait(id, 1_000, 'c');

  const snapshot = registry.kill(id, 'c');
  assert.equal(snapshot.status, 'completed');
  assert.equal(producer.cancels.length, 0);
});

test('wait returns the live snapshot at timeout and keeps the job running', async () => {
  const registry = new BackgroundJobRegistry();
  registry.start({ kind: 'bash', label: 'slow', conversationId: 'c', run: () => scriptedProducer().hooks });

  const snapshot = await registry.wait('bash-1', 30, 'c');
  assert.equal(snapshot.status, 'running');
  assert.equal(registry.get('bash-1')!.status, 'running');
});

test('stream reads consume the cursor; final-output reads are idempotent and mark reported', async () => {
  const registry = new BackgroundJobRegistry();
  const chunks = ['first ', 'second'];
  const stream = scriptedProducer({ readOutput: () => chunks.shift() ?? '' });
  const streamId = registry.start({ kind: 'bash', label: 'stream', conversationId: 'c', run: () => stream.hooks });

  assert.equal(registry.read(streamId, 'c').text, 'first ');
  assert.equal(registry.read(streamId, 'c').text, 'second');
  assert.equal(registry.read(streamId, 'c').text, '');

  // A stream job's outcome leaves `output` unset (dsh contract): after
  // settlement the read returns whatever the cursor still holds — nothing here.
  stream.resolveDone({ status: 'completed' });
  await registry.wait(streamId, 1_000, 'c');
  assert.equal(registry.read(streamId, 'c').text, '');

  // Final-output jobs (no readOutput): empty while live, the terminal output
  // once settled — idempotent, never consumed.
  const final = scriptedProducer();
  const finalId = registry.start({ kind: 'bash', label: 'final', conversationId: 'c', run: () => final.hooks });
  assert.equal(registry.read(finalId, 'c').text, '');

  final.resolveDone({ status: 'completed', output: 'final' });
  await registry.wait(finalId, 1_000, 'c');
  assert.equal(registry.read(finalId, 'c').text, 'final');
  assert.equal(registry.read(finalId, 'c').text, 'final');
});

/** Wait for settlement without claiming notice delivery (unlike `wait`). */
async function awaitSettled(registry: BackgroundJobRegistry, id: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = registry.get(id)?.status;
    if (status === 'completed' || status === 'killed' || status === 'failed') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`job ${id} did not settle`);
}

test('drainCompletionNotices delivers each settled job exactly once', async () => {
  const registry = new BackgroundJobRegistry();
  const a = scriptedProducer();
  const b = scriptedProducer();
  registry.start({ kind: 'bash', label: 'a', conversationId: 'c', run: () => a.hooks });
  registry.start({ kind: 'bash', label: 'b', conversationId: 'c', run: () => b.hooks });
  registry.start({ kind: 'bash', label: 'other', conversationId: 'other', run: () => scriptedProducer().hooks });

  a.resolveDone({ status: 'completed' });
  await awaitSettled(registry, 'bash-1');

  // Only settled jobs for THIS conversation drain; the running one and the
  // other conversation's job stay out.
  const first = registry.drainCompletionNotices('c');
  assert.deepEqual(first.map((s) => s.id), ['bash-1']);

  // Exactly once: a second drain finds nothing.
  assert.deepEqual(registry.drainCompletionNotices('c'), []);

  // A kill marks delivery reported too — b settles after being killed, and the
  // killer already saw the outcome.
  registry.kill('bash-2', 'c');
  b.resolveDone({ status: 'killed' });
  await awaitSettled(registry, 'bash-2');
  assert.deepEqual(registry.drainCompletionNotices('c'), []);
});

test('a terminal read suppresses the completion notice', async () => {
  const registry = new BackgroundJobRegistry();
  const producer = scriptedProducer(); // final-output job
  const id = registry.start({ kind: 'bash', label: 'x', conversationId: 'c', run: () => producer.hooks });
  producer.resolveDone({ status: 'completed', output: 'seen' });
  await awaitSettled(registry, id);

  assert.equal(registry.read(id, 'c').text, 'seen'); // terminal read claims it
  assert.deepEqual(registry.drainCompletionNotices('c'), []);
});

test('killConversation cancels live jobs, awaits producers, and spares other conversations', async () => {
  const registry = new BackgroundJobRegistry();
  const mine = scriptedProducer();
  const theirs = scriptedProducer();
  registry.start({ kind: 'bash', label: 'mine', conversationId: 'c', run: () => mine.hooks });
  registry.start({ kind: 'bash', label: 'theirs', conversationId: 'other', run: () => theirs.hooks });

  const teardown = registry.killConversation('c', 'conversation deleted');
  mine.resolveDone({ status: 'killed' });
  const killed = await teardown;

  assert.equal(killed, 1);
  assert.equal(registry.get('bash-1')!.status, 'killed');
  assert.equal(registry.get('bash-2')!.status, 'running');
  assert.equal(registry.activeCount('c'), 0);
  assert.equal(registry.activeCount('other'), 1);
});

test('a throwing teardown cancel force-fails only the record', async () => {
  const registry = new BackgroundJobRegistry();
  registry.start({
    kind: 'bash',
    label: 'x',
    conversationId: 'c',
    run: () => ({
      cancel: () => {
        throw new Error('cannot cancel');
      },
      done: new Promise(() => {})
    })
  });

  await registry.killAll('app quitting');
  const snapshot = registry.get('bash-1')!;
  assert.equal(snapshot.status, 'failed');
  assert.ok(snapshot.detail!.includes('teardown cancellation threw'));
});

test('onJobDone contains listener throws and supports unsubscribe', async () => {
  const registry = new BackgroundJobRegistry();
  const seen: string[] = [];
  registry.onJobDone(() => {
    throw new Error('bad listener');
  });
  const unsubscribe = registry.onJobDone((snapshot) => seen.push(snapshot.id));

  const a = scriptedProducer();
  const id = registry.start({ kind: 'bash', label: 'x', conversationId: 'c', run: () => a.hooks });
  a.resolveDone({ status: 'completed' });
  await registry.wait(id, 1_000, 'c');
  assert.deepEqual(seen, ['bash-1']);

  unsubscribe();
  const b = scriptedProducer();
  const id2 = registry.start({ kind: 'bash', label: 'y', conversationId: 'c', run: () => b.hooks });
  b.resolveDone({ status: 'completed' });
  await registry.wait(id2, 1_000, 'c');
  assert.deepEqual(seen, ['bash-1']); // unchanged after unsubscribe
});

test('onJobStart fires on registration with a running snapshot and supports unsubscribe', () => {
  const registry = new BackgroundJobRegistry();
  const seen: Array<{ id: string; status: string }> = [];
  registry.onJobStart(() => {
    throw new Error('bad listener');
  });
  const unsubscribe = registry.onJobStart((snapshot) =>
    seen.push({ id: snapshot.id, status: snapshot.status })
  );

  const a = scriptedProducer();
  registry.start({ kind: 'bash', label: 'x', conversationId: 'c', run: () => a.hooks });
  assert.deepEqual(seen, [{ id: 'bash-1', status: 'running' }]);

  unsubscribe();
  const b = scriptedProducer();
  registry.start({ kind: 'bash', label: 'y', conversationId: 'c', run: () => b.hooks });
  assert.deepEqual(seen, [{ id: 'bash-1', status: 'running' }]); // unchanged after unsubscribe
});

// ---------------------------------------------------------------------------
// Output capping and notice formatting
// ---------------------------------------------------------------------------

test('capOutputText retains the tail on a character boundary', () => {
  const text = 'head '.repeat(100) + 'tail-é😀';
  const capped = capOutputText(text, 60);

  assert.ok(Buffer.byteLength(capped, 'utf8') <= 60);
  assert.ok(capped.endsWith('tail-é😀'));
  assert.ok(capped.startsWith('\n…[output truncated]…\n'));
  assert.ok(!capped.includes('\uFFFD'));
});

test('capOutputText passes through under-limit text and unset limits', () => {
  assert.equal(capOutputText('small', 100), 'small');
  assert.equal(capOutputText('anything', undefined), 'anything');
});

test('formatCompletionNotice keeps the id and collection instruction when bounded', () => {
  const snapshot = {
    id: 'bash-7',
    kind: 'bash' as const,
    label: 'x'.repeat(500),
    conversationId: 'c',
    outputLimitBytes: 120,
    status: 'completed' as const,
    detail: 'exit code: 0',
    startedAt: 0
  };

  const full = formatCompletionNotice({ ...snapshot, outputLimitBytes: undefined });
  assert.ok(full.includes('background job bash-7 (bash:'));
  assert.ok(full.includes('job_output'));

  const bounded = formatCompletionNotice(snapshot);
  assert.ok(Buffer.byteLength(bounded, 'utf8') <= 120);
  assert.ok(bounded.includes('bash-7'));
  assert.ok(bounded.includes('job_output'));
  // The variable label was dropped to fit; the stable parts survived.
  assert.ok(!bounded.includes('x'.repeat(500)));
});

test('buildJobCompletionNoticeMessage wraps notices in a system-reminder', () => {
  const single = buildJobCompletionNoticeMessage([
    { id: 'bash-1', kind: 'bash', label: 'build', conversationId: 'c', status: 'completed', detail: 'exit code: 0', startedAt: 0 }
  ]);
  const text = (single.content as Array<{ text: string }>)[0].text;
  assert.ok(text.startsWith('<system-reminder>'));
  assert.ok(text.includes('background job bash-1'));
  assert.ok(!text.includes('jobs finished since'));

  const multi = buildJobCompletionNoticeMessage([
    { id: 'bash-1', kind: 'bash', label: 'a', conversationId: 'c', status: 'completed', startedAt: 0 },
    { id: 'bash-2', kind: 'bash', label: 'b', conversationId: 'c', status: 'failed', detail: 'exit code: 1', startedAt: 0 }
  ]);
  const multiText = (multi.content as Array<{ text: string }>)[0].text;
  assert.ok(multiText.includes('Background jobs finished since your last turn'));
  assert.ok(multiText.includes('- background job bash-1'));
  assert.ok(multiText.includes('- background job bash-2'));
});

// ---------------------------------------------------------------------------
// Bash producer: real child processes
// ---------------------------------------------------------------------------

test('producer: a command runs, streams output through the cursor, and completes', async () => {
  const registry = new BackgroundJobRegistry();
  const { jobId } = startBackgroundBashJob(registry, {
    command: 'echo hello && echo world',
    launch: { command: '/bin/sh', args: ['-c', 'echo hello && echo world'] },
    cwd: tmpdir(),
    env: {},
    conversationId: 'c'
  });

  assert.equal(jobId, 'bash-1');
  const snapshot = await registry.wait(jobId, 5_000, 'c');
  assert.equal(snapshot.status, 'completed');
  assert.equal(snapshot.detail, 'exit code: 0');

  const { text } = registry.read(jobId, 'c');
  assert.ok(text.includes('hello'));
  assert.ok(text.includes('world'));
});

test('producer: a failing command settles as failed with its exit code', async () => {
  const registry = new BackgroundJobRegistry();
  const { jobId } = startBackgroundBashJob(registry, {
    command: 'exit 3',
    launch: { command: '/bin/sh', args: ['-c', 'exit 3'] },
    cwd: tmpdir(),
    env: {},
    conversationId: 'c'
  });

  const snapshot = await registry.wait(jobId, 5_000, 'c');
  assert.equal(snapshot.status, 'failed');
  assert.equal(snapshot.detail, 'exit code: 3');
});

test('producer: kill terminates a long-running command', async () => {
  const registry = new BackgroundJobRegistry();
  const { jobId } = startBackgroundBashJob(registry, {
    command: 'sleep 30',
    launch: { command: '/bin/sh', args: ['-c', 'sleep 30'] },
    cwd: tmpdir(),
    env: {},
    conversationId: 'c'
  });

  assert.equal(registry.get(jobId)!.status, 'running');
  registry.kill(jobId, 'c', 'test teardown');

  const snapshot = await registry.wait(jobId, 5_000, 'c');
  assert.equal(snapshot.status, 'killed');
  assert.equal(snapshot.detail, 'test teardown');
});

test('producer: a rejected start (full bucket) spawns nothing', async () => {
  const registry = new BackgroundJobRegistry(1);
  startBackgroundBashJob(registry, {
    command: 'sleep 30',
    launch: { command: '/bin/sh', args: ['-c', 'sleep 30'] },
    cwd: tmpdir(),
    env: {},
    conversationId: 'c'
  });

  assert.throws(
    () =>
      startBackgroundBashJob(registry, {
        command: 'echo never',
        launch: { command: '/bin/sh', args: ['-c', 'echo never'] },
        cwd: tmpdir(),
        env: {},
        conversationId: 'c'
      }),
    /background job limit reached/
  );

  assert.equal(registry.list('c').length, 1);
  await registry.killAll('cleanup');
});

test('producer: the description becomes the label, falling back to the command', () => {
  const registry = new BackgroundJobRegistry();
  startBackgroundBashJob(registry, {
    command: 'sleep 5',
    description: 'long build',
    launch: { command: '/bin/sh', args: ['-c', 'sleep 5'] },
    cwd: tmpdir(),
    env: {},
    conversationId: 'c'
  });
  startBackgroundBashJob(registry, {
    command: 'sleep 5',
    launch: { command: '/bin/sh', args: ['-c', 'sleep 5'] },
    cwd: tmpdir(),
    env: {},
    conversationId: 'c'
  });

  assert.equal(registry.get('bash-1')!.label, 'long build');
  assert.equal(registry.get('bash-2')!.label, 'sleep 5');
  void registry.killAll('cleanup');
});

// ---------------------------------------------------------------------------
// Model-facing tools
// ---------------------------------------------------------------------------

test('job tools list, read, and kill through the registry fence', async () => {
  const registry = new BackgroundJobRegistry();
  const { jobId } = startBackgroundBashJob(registry, {
    command: 'echo tooling',
    launch: { command: '/bin/sh', args: ['-c', 'echo tooling'] },
    cwd: tmpdir(),
    env: {},
    conversationId: 'conv-a'
  });
  await registry.wait(jobId, 5_000, 'conv-a');

  const tools = createJobTools(registry, 'conv-a') as Record<
    string,
    { execute: (input: never) => Promise<{ text: string; status?: string }> }
  >;

  const list = await tools.job_list.execute({} as never);
  assert.ok(list.text.includes('bash-1 [bash] completed — echo tooling'));

  const output = await tools.job_output.execute({ job_id: jobId } as never);
  assert.ok(output.text.includes('tooling'));
  assert.ok(output.status!.includes('[status: completed'));

  const kill = await tools.job_kill.execute({ job_id: jobId } as never);
  assert.ok(kill.text.includes('already finished'));

  // The fence: another conversation's toolset cannot touch the job.
  const foreign = createJobTools(registry, 'conv-b') as Record<
    string,
    { execute: (input: never) => Promise<unknown> }
  >;
  await assert.rejects(() => foreign.job_output.execute({ job_id: jobId } as never), /another conversation/);

  const empty = await foreign.job_list.execute({} as never);
  assert.equal((empty as { text: string }).text, '(no background jobs)');
});

test('job_output wait: true blocks until settlement', async () => {
  const registry = new BackgroundJobRegistry();
  startBackgroundBashJob(registry, {
    command: 'sleep 0.2 && echo waited',
    launch: { command: '/bin/sh', args: ['-c', 'sleep 0.2 && echo waited'] },
    cwd: tmpdir(),
    env: {},
    conversationId: 'c'
  });

  const tools = createJobTools(registry, 'c') as Record<
    string,
    { execute: (input: never) => Promise<{ text: string; status?: string }> }
  >;
  const result = await tools.job_output.execute({ job_id: 'bash-1', wait: true, timeout_ms: 5_000 } as never);

  assert.ok(result.status!.includes('completed'));
  assert.ok(result.text.includes('waited'));
});

// ---------------------------------------------------------------------------
// Wiring: bash tool, tool registry, permission lists
// ---------------------------------------------------------------------------

test('bash run_in_background registers a tracked job when a registry is present', async () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-jobs-wiring-'));
  const registry = new BackgroundJobRegistry();

  try {
    const result = await bashToolExecute(
      { command: 'echo bg', run_in_background: true, description: 'wiring probe' },
      { mode: 'code', root, conversationId: 'conv-1', jobRegistry: registry }
    );

    // A real registry id, not a fabricated UUID — and output IS expected now.
    assert.equal(result.backgroundTaskId, 'bash-1');
    assert.equal(result.noOutputExpected, false);
    assert.equal(result.returnCodeInterpretation, 'backgrounded');

    const snapshot = await registry.wait('bash-1', 5_000, 'conv-1');
    assert.equal(snapshot.status, 'completed');
    assert.equal(snapshot.label, 'wiring probe');
    assert.ok(registry.read('bash-1', 'conv-1').text.includes('bg'));
  } finally {
    await registry.killAll('cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});

test('createBuiltInTools registers job tools only with a registry and conversation', () => {
  const registry = new BackgroundJobRegistry();
  const modelsRepo = { list: () => [] } as never;

  const withJobs = createBuiltInTools(modelsRepo, null, 'ask', {
    mode: 'code',
    root: '/tmp',
    conversationId: 'c1',
    jobRegistry: registry
  });
  assert.ok('job_output' in withJobs);
  assert.ok('job_list' in withJobs);
  assert.ok('job_kill' in withJobs);

  const withoutRegistry = createBuiltInTools(modelsRepo, null, 'ask', { mode: 'code', root: '/tmp' });
  assert.ok(!('job_output' in withoutRegistry));

  const withoutConversation = createBuiltInTools(modelsRepo, null, 'ask', {
    mode: 'code',
    root: '/tmp',
    jobRegistry: registry
  });
  assert.ok(!('job_output' in withoutConversation));

  // Read-only mode withholds them with the other side-effecting tools.
  const readOnly = createBuiltInTools(modelsRepo, null, 'read-only', {
    mode: 'code',
    root: '/tmp',
    conversationId: 'c1',
    jobRegistry: registry
  });
  assert.ok(!('job_output' in readOnly));
  assert.ok(!('bash' in readOnly));
});

test('job tools are on the side-effecting list (withheld in read-only mode)', () => {
  assert.ok(SIDE_EFFECTING_TOOL_NAMES.includes('job_output'));
  assert.ok(SIDE_EFFECTING_TOOL_NAMES.includes('job_list'));
  assert.ok(SIDE_EFFECTING_TOOL_NAMES.includes('job_kill'));
});

test('live snapshots carry the peek tail; settled snapshots drop it and long lines are capped', async () => {
  const registry = new BackgroundJobRegistry();
  const producer = scriptedProducer({
    readOutput: () => '',
    peekTail: (lines) =>
      Array.from({ length: lines + 2 }, (_, i) => (i === 0 ? 'x'.repeat(300) : `line-${i}`))
  });
  const id = registry.start({ kind: 'bash', label: 'preview', conversationId: 'c', run: () => producer.hooks });

  const live = registry.get(id)!;
  assert.ok(Array.isArray(live.tail));
  assert.equal(live.tail!.length, 3);
  // One runaway line must not bloat every broadcast.
  assert.equal(live.tail![0].length, 160 + 1);
  assert.ok(live.tail![0].endsWith('…'));
  assert.deepEqual(live.tail!.slice(1), ['line-1', 'line-2']);

  producer.resolveDone({ status: 'completed', detail: 'exit code: 0' });
  await registry.wait(id, 1_000, 'c');

  const settled = registry.get(id)!;
  assert.equal(settled.tail, undefined);
});
