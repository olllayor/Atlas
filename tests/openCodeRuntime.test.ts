import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import type { ChildProcess } from 'node:child_process';

import {
  OPENCODE_SERVER_READY_PREFIX,
  compareOpenCodeVersions,
  parseOpenCodeServerUrlFromOutput,
  parseOpenCodeVersionOutput,
  splitLaunchArgs,
  summarizeProcessFailure
} from '../src/main/ai/providers/opencode/openCodeParsers.js';
import {
  findFreeLocalPort,
  resolveOpenCodeSpawnEnvironment
} from '../src/main/ai/providers/opencode/openCodeEnvironment.js';
import { OpenCodeRuntime } from '../src/main/ai/providers/opencode/OpenCodeRuntime.js';
import { defaultOpenCodeSettings } from '../src/shared/opencodeSettingsSchema.js';

/* ------------------------------------------------------------------ *
 * Parsers (pure)
 * ------------------------------------------------------------------ */

test('ready-line parser extracts the serve URL across noisy output', () => {
  const url = parseOpenCodeServerUrlFromOutput(
    `${OPENCODE_SERVER_READY_PREFIX} on http://127.0.0.1:41235`
  );
  assert.equal(url, 'http://127.0.0.1:41235');

  const noisy = [
    'opencode v1.18.23',
    'loading config…',
    `${OPENCODE_SERVER_READY_PREFIX} on http://localhost:51733`,
    ''
  ].join('\n');
  assert.equal(parseOpenCodeServerUrlFromOutput(noisy), 'http://localhost:51733');

  assert.equal(parseOpenCodeServerUrlFromOutput('no ready line here'), null);
  assert.equal(parseOpenCodeServerUrlFromOutput(`${OPENCODE_SERVER_READY_PREFIX} without url`), null);
});

test('version parser + comparator enforce the t3 floor semantics', () => {
  assert.equal(parseOpenCodeVersionOutput('opencode 1.18.23'), '1.18.23');
  assert.equal(parseOpenCodeVersionOutput('1.14.19-beta.1 build'), '1.14.19-beta.1');
  assert.equal(parseOpenCodeVersionOutput('version unknown'), null);

  const MIN = '1.14.19';
  assert.ok(compareOpenCodeVersions('1.14.19', MIN) === 0);
  assert.ok(compareOpenCodeVersions('1.13.9', MIN) < 0);
  assert.ok(compareOpenCodeVersions('1.15.0', MIN) > 0);
  assert.ok(compareOpenCodeVersions('2.0.0', MIN) > 0);
});

test('process failure summary prefers stderr and bounds tails', () => {
  const detail = summarizeProcessFailure({
    exitCode: 127,
    // Marker sits near the END so a bounded tail keeps it (tail-trim contract).
    stderrTail: `${'x'.repeat(300)}\nsh: bogus: command not found\nfinal line`,
    stdoutTail: 'ignored when stderr exists'
  });
  assert.match(detail, /exit code 127/);
  assert.match(detail, /command not found/);
  assert.doesNotMatch(detail, /ignored when stderr exists/);
  assert.ok(detail.length < 600);
});

test('launch-args splitter handles quoting and blank input', () => {
  assert.deepEqual(splitLaunchArgs('  '), []);
  assert.deepEqual(splitLaunchArgs('--foo --bar=1'), ['--foo', '--bar=1']);
  assert.deepEqual(splitLaunchArgs('--title "my server" --flag'), ['--title', 'my server', '--flag']);
  assert.deepEqual(splitLaunchArgs("--title 'my server'"), ['--title', 'my server']);
});

/* ------------------------------------------------------------------ *
 * Env passthrough (the t3 fix)
 * ------------------------------------------------------------------ */

test('spawn env stays untouched when no OPENCODE_CONFIG_CONTENT anywhere', () => {
  const env = resolveOpenCodeSpawnEnvironment({ EXTRA_FLAG: '1' }, { PATH: '/usr/bin:/bin', HOME: '/home/u' });
  assert.equal(env, undefined, 'undefined ⇒ child inherits parent environment');
});

test('explicit OPENCODE_CONFIG_CONTENT flows through merged environment', () => {
  const env = resolveOpenCodeSpawnEnvironment(
    { OPENCODE_CONFIG_CONTENT: '{"model":"z"}', EXTRA: 'y' },
    { PATH: '/usr/bin:/bin', HOME: '/home/u' }
  )!;
  assert.equal(env.OPENCODE_CONFIG_CONTENT, '{"model":"z"}');
  assert.equal(env.PATH, '/usr/bin:/bin', 'merged copy remains complete');
  assert.equal(env.EXTRA, 'y');
});

test('empty-string config content never gets written on the user’s behalf', () => {
  const env = resolveOpenCodeSpawnEnvironment(
    { OPENCODE_CONFIG_CONTENT: '' },
    { PATH: '/usr/bin:/bin', OPENCODE_CONFIG_CONTENT: '{}' }
  )!;
  assert.equal(env.OPENCODE_CONFIG_CONTENT, undefined);
  assert.equal(env.PATH, '/usr/bin:/bin');
});

/* ------------------------------------------------------------------ *
 * Runtime lifecycle with a fake child harness
 * ------------------------------------------------------------------ */

let fakePidCounter = 2_147_483_000;

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  /** Collision-impossible pid so real process.kill(-pid) fails fast into our fallback. */
  readonly pid = fakePidCounter++;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kills: Array<NodeJS.Signals | undefined> = [];

  override kill(signal?: NodeJS.Signals): boolean {
    this.kills.push(signal);
    // Fakes die unconditionally on SIGKILL — lets hasExited()/verify-ladder
    // logic behave like a real child.
    if (signal === 'SIGKILL') {
      this.exitCode = null;
      this.signalCode = 'SIGKILL';
      this.emit('exit', null, 'SIGKILL');
    }
    return true;
  }

  emitData(stream: 'stdout' | 'stderr', text: string) {
    (this[stream] as EventEmitter).emit('data', Buffer.from(text));
  }

  simulateExit(code: number | null, signal: NodeJS.Signals | null = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

type Harness = { runtime: OpenCodeRuntime; children: FakeChild[] };

function makeHarness(options: {
  spawnTimeoutMs?: number;
  termGraceMs?: number;
  idleShutdownMs?: number;
  isPortFree?: (port: number) => Promise<boolean>;
  healthCheck?: (baseUrl: string, serverPassword?: string) => Promise<{ healthy: boolean; version: string | null }>;
} = {}): Harness {
  const children: FakeChild[] = [];
  const runtime = new OpenCodeRuntime({
    ...(options.spawnTimeoutMs !== undefined ? { spawnTimeoutMs: options.spawnTimeoutMs } : {}),
    ...(options.termGraceMs !== undefined ? { termGraceMs: options.termGraceMs } : {}),
    ...(options.idleShutdownMs !== undefined ? { idleShutdownMs: options.idleShutdownMs } : {}),
    ...(options.isPortFree ? { isPortFree: options.isPortFree } : {}),
    healthCheck: options.healthCheck ?? (async () => ({ healthy: true, version: '1.18.23' })),
    childFactory: () => {
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    }
  });
  return { runtime, children };
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));
/** Spin the loop until the runtime reaches a state, or give up loudly. */
async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await flushMicrotasks();
  }
  assert.ok(predicate(), 'condition never became true');
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Start a connect, yield enough turns for listeners to attach, then announce ready. */
async function connectAndAnnounce(harness: Harness, baseUrl = 'http://127.0.0.1:40001') {
  const connecting = harness.runtime.connect({ settings: defaultOpenCodeSettings() });
  await flushMicrotasks();
  await flushMicrotasks();
  const child = harness.children.at(-1)!;
  child.emitData('stdout', `${OPENCODE_SERVER_READY_PREFIX} on ${baseUrl}\n`);
  const connection = await connecting;
  return { connection, child };
}

test('findFreeLocalPort returns a bindable port', async () => {
  const port = await findFreeLocalPort();
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
});

test('external serverUrl short-circuits without spawning', async () => {
  const harness = makeHarness();
  const connection = await harness.runtime.connect({
    settings: { ...defaultOpenCodeSettings(), enabled: true, serverUrl: ' http://oc.example.io ' }
  });
  assert.equal(connection.baseUrl, 'http://oc.example.io');
  assert.equal(connection.owned, false);
  // Nothing was retained, so returning the lease must not decrement anyone.
  connection.release();
  assert.equal(harness.children.length, 0);
  assert.equal(harness.runtime.activeBaseUrl(), null);
});

test('owned mode spawns, resolves the ready URL, then reuses the same server', async () => {
  const harness = makeHarness({ termGraceMs: 5 });
  const first = await connectAndAnnounce(harness, 'http://127.0.0.1:40001');
  assert.equal(first.connection.baseUrl, 'http://127.0.0.1:40001');
  assert.equal(first.connection.owned, true);
  assert.equal(harness.children.length, 1);

  const second = await harness.runtime.connect({ settings: defaultOpenCodeSettings() });
  assert.equal(second.baseUrl, first.connection.baseUrl);
  assert.equal(harness.children.length, 1, 'reuse — no second spawn');

  try {
    await harness.runtime.shutdown();
  } catch {
    /* teardown is best-effort */
  }
  assert.deepEqual(harness.children[0]!.kills, ['SIGTERM', 'SIGKILL'], 'TERM → KILL ladder order');
});

test('concurrent connects coalesce onto a single spawn', async () => {
  const harness = makeHarness({ termGraceMs: 5 });
  const connectingB = harness.runtime.connect({ settings: defaultOpenCodeSettings() });
  const [a, b] = await Promise.all([connectAndAnnounce(harness, 'http://127.0.0.1:40002'), connectingB]);
  assert.equal(a.connection.baseUrl, 'http://127.0.0.1:40002');
  assert.equal(b.baseUrl, 'http://127.0.0.1:40002');
  assert.equal(harness.children.length, 1);
  try {
    await harness.runtime.shutdown();
  } catch {
    /* best-effort */
  }
});

test('early exit during startup rejects with stderr detail and clears state', async () => {
  const harness = makeHarness({ termGraceMs: 2 });
  const failing = harness.runtime.connect({ settings: defaultOpenCodeSettings() });
  await flushMicrotasks();
  await flushMicrotasks();
  const child = harness.children[0]!;
  child.emitData('stderr', 'fatal: bad config\n');
  child.simulateExit(1);

  await assert.rejects(failing, /exited during startup[\s\S]*bad config/);
  assert.equal(harness.runtime.activeBaseUrl(), null);

  // Next connect may respawn cleanly.
  const retry = harness.runtime.connect({ settings: defaultOpenCodeSettings() });
  await flushMicrotasks();
  await flushMicrotasks();
  harness.children[1]!.emitData(
    'stdout',
    `${OPENCODE_SERVER_READY_PREFIX} on http://127.0.0.1:40003\n`
  );
  const connection = await retry;
  assert.equal(connection.baseUrl, 'http://127.0.0.1:40003');
  try {
    await harness.runtime.shutdown();
  } catch {
    /* best-effort */
  }
});

test('startup timeout tears the child down (TERM→KILL) and rejects', async () => {
  const harness = makeHarness({ spawnTimeoutMs: 20, termGraceMs: 5 });
  await assert.rejects(
    harness.runtime.connect({ settings: defaultOpenCodeSettings() }),
    /Timed out after 20ms/
  );
  await sleep(40); // let the async teardown ladder finish
  assert.deepEqual(harness.children[0].kills, ['SIGTERM', 'SIGKILL']);
  assert.equal(harness.runtime.activeBaseUrl(), null);
});

test('unexpected exit after readiness fires the handler exactly once', async () => {
  const harness = makeHarness({ termGraceMs: 2 });
  let unexpected = 0;
  harness.runtime.setUnexpectedExitHandler(() => {
    unexpected += 1;
  });

  const { child } = await connectAndAnnounce(harness, 'http://127.0.0.1:40004');
  child.simulateExit(9, 'SIGKILL');
  child.simulateExit(9, 'SIGKILL'); // double emission — guard must hold

  assert.equal(unexpected, 1);
  assert.equal(harness.runtime.activeBaseUrl(), null);
});

test('idle reap shuts down when references drop to zero', async () => {
  const harness = makeHarness({ idleShutdownMs: 40, termGraceMs: 5 });
  await connectAndAnnounce(harness, 'http://127.0.0.1:40005');
  harness.runtime.release();

  await sleep(160);
  assert.deepEqual(harness.children[0].kills, ['SIGTERM', 'SIGKILL']);
  assert.equal(harness.runtime.activeBaseUrl(), null);
});

test('retained servers survive the idle window; explicit shutdown still kills', async () => {
  const harness = makeHarness({ idleShutdownMs: 40, termGraceMs: 5 });
  await connectAndAnnounce(harness, 'http://127.0.0.1:40006');
  harness.runtime.retain(); // consumer keeps holding

  await sleep(140);
  assert.equal(harness.children[0].kills.length, 0, 'no reap while retained');

  await harness.runtime.shutdown();
  assert.deepEqual(harness.children[0].kills, ['SIGTERM', 'SIGKILL']);
});


test('returning every lease arms the idle reap; holding one keeps the server', async () => {
  const harness = makeHarness({ termGraceMs: 5, idleShutdownMs: 20 });
  const first = await connectAndAnnounce(harness, 'http://127.0.0.1:40010');
  const second = await harness.runtime.connect({ settings: defaultOpenCodeSettings() });

  // One consumer still holds a reference: the reap must not arm.
  first.connection.release();
  await sleep(40);
  assert.equal(harness.runtime.activeBaseUrl(), 'http://127.0.0.1:40010', 'still leased');

  second.release();
  // Releasing twice must not double-count someone else's reference.
  second.release();
  await sleep(40);
  assert.equal(harness.runtime.activeBaseUrl(), null, 'reaped once every lease came back');
});

test('shutdown during startup kills the child instead of stranding it', async () => {
  const harness = makeHarness({ termGraceMs: 5 });
  const connecting = harness.runtime.connect({ settings: defaultOpenCodeSettings() });
  await flushMicrotasks();
  await flushMicrotasks();

  const child = harness.children.at(-1)!;
  assert.equal(child.kills.length, 0);

  // Quit lands while the server is still starting: `server` is null, so the
  // only handle on this child is the runtime's pending-spawn slot.
  const shuttingDown = harness.runtime.shutdown();
  await assert.rejects(connecting, /shut down while it was starting/);
  await shuttingDown;

  assert.ok(child.kills.includes('SIGKILL'), 'the half-started child was killed');
  assert.equal(harness.runtime.activeBaseUrl(), null);
});

test('a server that becomes ready after shutdown is torn down, not adopted', async () => {
  const harness = makeHarness({ termGraceMs: 5 });
  const connecting = harness.runtime.connect({ settings: defaultOpenCodeSettings() });
  await flushMicrotasks();
  await flushMicrotasks();
  const child = harness.children.at(-1)!;

  // Shutdown first, then the child announces readiness anyway.
  const shuttingDown = harness.runtime.shutdown();
  child.emitData('stdout', `${OPENCODE_SERVER_READY_PREFIX} on http://127.0.0.1:40011\n`);
  await assert.rejects(connecting, /shut down while it was starting/);
  await shuttingDown;

  assert.equal(harness.runtime.activeBaseUrl(), null, 'never adopted as the live server');
  assert.ok(child.kills.includes('SIGKILL'));
});

/* ------------------------------------------------------------------ *
 * Port race + teardown latency
 * ------------------------------------------------------------------ */

test('a port lost between probe and bind is retried on a fresh one', async () => {
  const checked: number[] = [];
  const harness = makeHarness({
    termGraceMs: 2,
    // First failure: the port is taken, so the collision is real. If a second
    // spawn ever failed, the answer would say the port was free.
    isPortFree: async (port) => {
      checked.push(port);
      return false;
    }
  });

  const connecting = harness.runtime.connect({ settings: defaultOpenCodeSettings() });
  await flushMicrotasks();
  await flushMicrotasks();
  harness.children[0]!.simulateExit(1);

  await until(() => harness.children.length === 2);
  harness.children[1]!.emitData(
    'stdout',
    `${OPENCODE_SERVER_READY_PREFIX} on http://127.0.0.1:40021\n`
  );

  const connection = await connecting;
  assert.equal(connection.baseUrl, 'http://127.0.0.1:40021');
  assert.equal(checked.length, 1, 'the port was only questioned after the failure');

  try {
    await harness.runtime.shutdown();
  } catch {
    /* best-effort */
  }
});

test('a startup failure on a still-free port is reported, not retried', async () => {
  const harness = makeHarness({ termGraceMs: 2, isPortFree: async () => true });

  const connecting = harness.runtime.connect({ settings: defaultOpenCodeSettings() });
  await flushMicrotasks();
  await flushMicrotasks();
  harness.children[0]!.emitData('stderr', 'fatal: bad config\n');
  harness.children[0]!.simulateExit(1);

  await assert.rejects(connecting, /exited during startup[\s\S]*bad config/);
  assert.equal(harness.children.length, 1, 'a real fault must not be retried');
});

test('teardown stops waiting out the grace once the child is gone', async () => {
  const harness = makeHarness({ termGraceMs: 10_000 });
  const { child } = await connectAndAnnounce(harness, 'http://127.0.0.1:40022');

  // A well-behaved child exits on SIGTERM. Sleeping the full grace anyway is
  // ten seconds of quit latency for nothing.
  const realKill = child.kill.bind(child);
  child.kill = (signal?: NodeJS.Signals) => {
    const accepted = realKill(signal);
    if (signal === 'SIGTERM') {
      setImmediate(() => child.simulateExit(0));
    }
    return accepted;
  };

  const startedAt = Date.now();
  await harness.runtime.shutdown();
  assert.ok(Date.now() - startedAt < 1_000, 'shutdown returned without waiting out the grace');
  assert.deepEqual(child.kills, ['SIGTERM'], 'no escalation was needed');
});

test('keychain password reaches the child env and the health gate', async () => {
  const seen: Array<{ password?: string }> = [];
  const spawnedEnvs: Array<NodeJS.ProcessEnv | undefined> = [];
  const children: FakeChild[] = [];
  const runtime = new OpenCodeRuntime({
    healthCheck: async (_baseUrl, serverPassword) => {
      seen.push({ ...(serverPassword ? { password: serverPassword } : {}) });
      return { healthy: true, version: '1.18.23' };
    },
    childFactory: ((command: string, args: readonly string[], opts: { env?: NodeJS.ProcessEnv }) => {
      void command;
      void args;
      spawnedEnvs.push(opts.env);
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    }) as never
  });

  const connecting = runtime.connect({ settings: defaultOpenCodeSettings(), serverPassword: 'k3ychain' });
  await flushMicrotasks();
  await flushMicrotasks();
  children[0]!.emitData('stdout', `${OPENCODE_SERVER_READY_PREFIX} on http://127.0.0.1:40101\n`);
  const connection = await connecting;
  assert.equal(connection.baseUrl, 'http://127.0.0.1:40101');
  assert.equal(spawnedEnvs[0]?.OPENCODE_SERVER_PASSWORD, 'k3ychain');
  assert.deepEqual(seen[0], { password: 'k3ychain' });
  connection.release();
  await runtime.shutdown();
});

test('launch arguments and env vars from settings reach the spawned child', async () => {
  const spawnedArgs: Array<readonly string[]> = [];
  const spawnedEnvs: Array<NodeJS.ProcessEnv | undefined> = [];
  const children: FakeChild[] = [];
  const runtime = new OpenCodeRuntime({
    healthCheck: async () => ({ healthy: true, version: '1.18.23' }),
    childFactory: ((command: string, args: readonly string[], opts: { env?: NodeJS.ProcessEnv }) => {
      void command;
      spawnedArgs.push(args);
      spawnedEnvs.push(opts.env);
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    }) as never
  });

  const settings = {
    ...defaultOpenCodeSettings(),
    launchArgs: '--print-logs --title "my server"',
    env: { OPENCODE_CUSTOM_FLAG: 'yes' }
  };
  const connecting = runtime.connect({ settings });
  await flushMicrotasks();
  await flushMicrotasks();
  children[0]!.emitData('stdout', `${OPENCODE_SERVER_READY_PREFIX} on http://127.0.0.1:40103\n`);
  const connection = await connecting;
  assert.deepEqual(
    spawnedArgs[0]!.slice(3),
    ['--print-logs', '--title', 'my server']
  );
  assert.equal(spawnedEnvs[0]?.OPENCODE_CUSTOM_FLAG, 'yes');
  connection.release();
  await runtime.shutdown();
});

test('empty keychain password strips a host-inherited server password', async () => {
  const spawnedEnvs: Array<NodeJS.ProcessEnv | undefined> = [];
  const children: FakeChild[] = [];
  const runtime = new OpenCodeRuntime({
    healthCheck: async () => ({ healthy: true, version: '1.18.23' }),
    childFactory: ((command: string, args: readonly string[], opts: { env?: NodeJS.ProcessEnv }) => {
      void command;
      void args;
      spawnedEnvs.push(opts.env);
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    }) as never
  });

  const connecting = runtime.connect({ settings: defaultOpenCodeSettings(), serverPassword: null });
  await flushMicrotasks();
  await flushMicrotasks();
  children[0]!.emitData('stdout', `${OPENCODE_SERVER_READY_PREFIX} on http://127.0.0.1:40102\n`);
  await connecting;
  assert.equal(spawnedEnvs[0]?.OPENCODE_SERVER_PASSWORD, undefined);
  await runtime.shutdown();
});

test('health 401 tears the child down instead of handing out a lease', async () => {
  const children: FakeChild[] = [];
  const runtime = new OpenCodeRuntime({
    termGraceMs: 2,
    healthCheck: async () => {
      throw new Error('OpenCode server rejected authentication.');
    },
    childFactory: (() => {
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    }) as never
  });

  const connecting = runtime.connect({ settings: defaultOpenCodeSettings(), serverPassword: 'stale' });
  await flushMicrotasks();
  await flushMicrotasks();
  children[0]!.emitData('stdout', `${OPENCODE_SERVER_READY_PREFIX} on http://127.0.0.1:40103\n`);
  await assert.rejects(connecting, /rejected authentication/);
  await runtime.shutdown().catch(() => undefined);
});

test('spawn env sets the server password from the keychain', () => {
  const env = resolveOpenCodeSpawnEnvironment(undefined, { PATH: '/usr/bin' }, 'k3ychain')!;
  assert.equal(env.OPENCODE_SERVER_PASSWORD, 'k3ychain');
});

test('spawn env strips a host-inherited password when the keychain is empty', () => {
  const env = resolveOpenCodeSpawnEnvironment(
    undefined,
    { PATH: '/usr/bin', OPENCODE_SERVER_PASSWORD: 'host-leak' },
    null
  )!;
  assert.equal(env.OPENCODE_SERVER_PASSWORD, undefined);
});
