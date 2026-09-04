/**
 * OpenCodeRuntime — owns the lifecycle of the `opencode serve` child process
 * backing the deep OpenCode integration.
 *
 * Blueprint: pingdotgg/t3code `apps/server/src/provider/opencodeRuntime.ts`
 * (`startOpenCodeServerProcess` L495-652, external-vs-owned connect L654-678,
 * and the one-shot unexpected-exit guard from `emitUnexpectedExit`).
 *
 * Ported to plain TS per plan D2. Single-instance adaptation (plan D6): one
 * shared server per app run with reference counting and an idle reap instead
 * of Effect scopes per consumer.
 */

import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process';

import type { OpenCodeSettings } from '../../../../shared/opencodeSettings.js';
import { openCodeServerMode } from '../../../../shared/opencodeSettings.js';
import {
  OPENCODE_DEFAULT_HOSTNAME,
  OPENCODE_SERVER_STARTUP_TIMEOUT_MS,
  compareOpenCodeVersions,
  parseOpenCodeServerUrlFromOutput,
  summarizeProcessFailure
} from './openCodeParsers.js';
import { fetchOpenCodeHealth } from './OpenCodeClient.js';
import {
  findFreeLocalPort,
  isLocalPortFree,
  resolveOpenCodeSpawnEnvironment
} from './openCodeEnvironment.js';
import { MIN_OPENCODE_VERSION } from './probeOpenCode.js';

export class OpenCodeRuntimeError extends Error {
  constructor(
    public readonly operation: string,
    message: string,
    public readonly cause?: unknown,
    /**
     * The child died on its own before it was ready. A port taken between our
     * probe and opencode's bind looks exactly like this, which is why the flag
     * exists at all (see `startOwnedServer`).
     */
    public readonly exitedDuringStartup = false
  ) {
    super(message);
    this.name = 'OpenCodeRuntimeError';
  }
}

export interface OpenCodeServerConnection {
  /** Base URL the SDK client should talk to. */
  baseUrl: string;
  /** false = user-managed server (`serverUrl` configured); we do not own its lifetime. */
  owned: boolean;
  /**
   * Hands the reference back. One-shot, and a no-op for an external server
   * that never took one.
   *
   * The lease rides on the connection rather than being a separate `release()`
   * call because a caller that forgets one pins the server forever: the idle
   * reap only ever arms at zero references. A probe used to do exactly that.
   */
  release(): void;
}

/** Factory seam so tests can supply EventEmitter-based fake children. */
type ChildFactory = (
  command: string,
  args: readonly string[],
  options: {
    stdio: ['ignore', 'pipe', 'pipe'];
    detached?: boolean;
    env?: NodeJS.ProcessEnv;
    windowsHide?: boolean;
  }
) => ChildProcess;

export interface OpenCodeRuntimeOptions {
  childFactory?: ChildFactory;
  spawnTimeoutMs?: number;
  termGraceMs?: number;
  idleShutdownMs?: number;
  /** Seam for the port-race check; tests answer without touching sockets. */
  isPortFree?: (port: number) => Promise<boolean>;
  /** Seam for the post-spawn health gate; tests answer without HTTP. */
  healthCheck?: (baseUrl: string, serverPassword?: string) => Promise<{ healthy: boolean; version: string | null }>;
}

/** One extra spawn is enough for a lost port race; more would mask real faults. */
const PORT_RACE_RETRIES = 1;

const DEFAULT_IDLE_SHUTDOWN_MS = 30_000;
const DEFAULT_TERM_GRACE_MS = 1_000;

interface RunningServer {
  readonly child: ChildProcess;
  readonly baseUrl: string;
}

export class OpenCodeRuntime {
  private server: RunningServer | null = null;
  private pendingStart: Promise<RunningServer> | null = null;
  /** The child of an in-flight spawn, before it is ready enough to be `server`. */
  private pendingChild: ChildProcess | null = null;
  private shuttingDown = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private references = 0;
  private unexpectedExitHandler: (() => void) | null = null;
  private unexpectedExitEmitted = false;
  /** Version proven by `/global/health` for the live child; cleared on exit. */
  private healthyVersion: string | null = null;
  private healthyPassword: string | null = null;

  private readonly childFactory: ChildFactory;
  private readonly spawnTimeoutMs: number;
  private readonly termGraceMs: number;
  private readonly idleShutdownMs: number;
  private readonly isPortFree: (port: number) => Promise<boolean>;
  private readonly healthCheck: (
    baseUrl: string,
    serverPassword?: string
  ) => Promise<{ healthy: boolean; version: string | null }>;

  constructor(options: OpenCodeRuntimeOptions = {}) {
    this.childFactory =
      options.childFactory ?? ((command, args, opts) => defaultSpawn(command, [...args], opts));
    this.spawnTimeoutMs = options.spawnTimeoutMs ?? OPENCODE_SERVER_STARTUP_TIMEOUT_MS;
    this.termGraceMs = options.termGraceMs ?? DEFAULT_TERM_GRACE_MS;
    this.idleShutdownMs = options.idleShutdownMs ?? DEFAULT_IDLE_SHUTDOWN_MS;
    this.isPortFree = options.isPortFree ?? isLocalPortFree;
    this.healthCheck = options.healthCheck ?? fetchOpenCodeHealth;
  }

  /** Fired at most once per spawned server when an owned server dies unexpectedly. */
  setUnexpectedExitHandler(handler: (() => void) | null): void {
    this.unexpectedExitHandler = handler;
  }

  /** Reference count of active consumers; drives the idle reap only. */
  retain(): void {
    this.references += 1;
  }

  release(): void {
    this.references = Math.max(0, this.references - 1);
    if (this.references === 0 && this.server !== null && !this.idleTimer) {
      this.idleTimer = setTimeout(() => {
        void this.shutdown();
      }, this.idleShutdownMs);
    }
  }

  /**
   * Connect to the opencode server for the given settings.
   * External mode short-circuits — no spawn, no lifetime tracking.
   * Owned mode spawns once; every later consumer reuses the server.
   */
  async connect(input: {
    settings: OpenCodeSettings;
    env?: NodeJS.ProcessEnv;
    /**
     * Keychain-held password. Value ⇒ child demands it and client sends it.
     * Null/'' ⇒ strip any host-inherited password so our own spawn can never
     * 401 our own client. Undefined ⇒ legacy, touch nothing.
     */
    serverPassword?: string | null;
  }): Promise<OpenCodeServerConnection> {
    if (openCodeServerMode(input.settings) === 'external') {
      return { baseUrl: input.settings.serverUrl.trim(), owned: false, release: () => undefined };
    }

    if (this.isAlive()) {
      this.cancelIdleShutdown();
      return this.lease(this.server!.baseUrl);
    }

    // Coalesce concurrent connects onto one spawn.
    this.pendingStart ??= this.startOwnedServer(input).finally(() => {
      this.pendingStart = null;
    });
    const started = await this.pendingStart;

    // A shutdown that landed while this spawn was in flight already killed the
    // child; handing its URL out would point the caller at a dead server.
    if (this.server !== started) {
      throw new OpenCodeRuntimeError(
        'connect',
        'The OpenCode server was shut down while it was starting.'
      );
    }

    return this.lease(started.baseUrl);
  }

  /** Take a reference and hand back the one-shot that returns it. */
  private lease(baseUrl: string): OpenCodeServerConnection {
    this.retain();
    let released = false;
    return {
      baseUrl,
      owned: true,
      release: () => {
        if (released) return;
        released = true;
        this.release();
      }
    };
  }

  /** Best-effort look without spawning anything. */
  activeBaseUrl(): string | null {
    return this.isAlive() ? this.server!.baseUrl : null;
  }

  /** Idempotent: kills any owned server (TERM → grace → KILL) and clears reaping. */
  async shutdown(): Promise<void> {
    this.cancelIdleShutdown();
    this.references = 0;
    this.shuttingDown = true;

    // A child spawned but not yet ready is not in `server` yet, and killing
    // only `server` stranded it: quitting mid-startup left an orphaned
    // `opencode serve` behind. Kill it by handle instead of waiting out the
    // 30s readiness timeout.
    const starting = this.pendingChild;
    this.pendingChild = null;
    const current = this.server;
    this.server = null;
    this.healthyVersion = null;
    this.healthyPassword = null;

    try {
      if (starting && starting !== current?.child) {
        await this.teardown(starting);
      }
      if (current) {
        await this.teardown(current.child);
      }
    } finally {
      this.shuttingDown = false;
    }
  }

  private isAlive(): boolean {
    const child = this.server?.child;
    if (!child) return false;
    // A child that already exited reports a non-null exitCode or signalCode.
    return child.exitCode === null && child.signalCode === null;
  }

  private cancelIdleShutdown(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * Spawn the server, retrying once when the attempt lost a race for its port.
   *
   * `findFreeLocalPort` can only report that a port was free a moment ago —
   * it closes the probe socket before opencode binds, so anything else on the
   * machine may claim it in between. The CLI reports that collision as a plain
   * startup failure, so the port itself is asked afterwards who owns it: still
   * bindable ⇒ the failure was real and is reported; taken ⇒ we lost the race
   * and a fresh port is worth one more try.
   */
  private async startOwnedServer(input: {
    settings: OpenCodeSettings;
    env?: NodeJS.ProcessEnv;
    serverPassword?: string | null;
  }): Promise<RunningServer> {
    for (let attempt = 0; ; attempt += 1) {
      const port = await findFreeLocalPort();
      try {
        return await this.spawnOwnedServer(input, port);
      } catch (error) {
        const lostPortRace =
          error instanceof OpenCodeRuntimeError &&
          error.exitedDuringStartup &&
          !this.shuttingDown &&
          attempt < PORT_RACE_RETRIES &&
          !(await this.isPortFree(port));
        if (!lostPortRace) {
          throw error;
        }
      }
    }
  }

  private async spawnOwnedServer(
    input: {
      settings: OpenCodeSettings;
      env?: NodeJS.ProcessEnv;
      serverPassword?: string | null;
    },
    port: number
  ): Promise<RunningServer> {
    const command = input.settings.binaryPath.trim() || 'opencode';
    const args = ['serve', `--hostname=${OPENCODE_DEFAULT_HOSTNAME}`, `--port=${port}`];
    const env = resolveOpenCodeSpawnEnvironment(input.env, process.env, input.serverPassword);
    const effectivePassword =
      typeof input.serverPassword === 'string' && input.serverPassword.trim().length > 0
        ? input.serverPassword.trim()
        : undefined;

    const child = this.childFactory(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
      ...(env ? { env } : {})
    });

    this.unexpectedExitEmitted = false;
    this.pendingChild = child;

    const shutDownDuringStartup = () =>
      new OpenCodeRuntimeError(
        'startOpenCodeServerProcess',
        'The OpenCode server was shut down while it was starting.'
      );

    let baseUrl: string;
    try {
      baseUrl = await this.waitForReady(child);
    } catch (error) {
      // A shutdown kills the child, which trips the early-exit watcher first.
      // Report why it really died rather than blaming startup.
      throw this.shuttingDown ? shutDownDuringStartup() : error;
    } finally {
      if (this.pendingChild === child) {
        this.pendingChild = null;
      }
    }

    // Readiness landed anyway after shutdown: tear it down, never adopt it.
    if (this.shuttingDown) {
      await this.teardown(child);
      throw shutDownDuringStartup();
    }

    // Health gate (t3code parity): the listening line is not enough — prove
    // the server answers with our password and a supported version before any
    // caller gets a lease. A 401 here means child and client disagree, which
    // used to surface later as a confusing turn failure.
    try {
      await this.verifyOwnedHealth(baseUrl, effectivePassword);
    } catch (error) {
      await this.teardown(child);
      throw error;
    }

    this.server = { child, baseUrl };

    child.once('exit', () => {
      if (this.server?.child === child) {
        this.server = null;
        this.healthyVersion = null;
        this.healthyPassword = null;
        this.cancelIdleShutdown();
        // One-shot guard (t3code pattern): crash-watcher vs event pumps racing
        // on teardown must not double-report the death.
        if (!this.unexpectedExitEmitted) {
          this.unexpectedExitEmitted = true;
          this.unexpectedExitHandler?.();
        }
      }
    });

    return this.server;
  }

  /**
   * Prove the freshly spawned child answers authed `/global/health` with a
   * supported version. Cached for the process lifetime when the password is
   * unchanged; a password change re-verifies so a stale cache can never mask
   * a 401.
   */
  private async verifyOwnedHealth(baseUrl: string, serverPassword?: string): Promise<void> {
    const passwordKey = serverPassword ?? '';
    if (this.healthyVersion !== null && this.healthyPassword === passwordKey) {
      return;
    }
    let health: { healthy: boolean; version: string | null };
    try {
      health = await this.healthCheck(baseUrl, serverPassword);
    } catch (error) {
      throw new OpenCodeRuntimeError(
        'startOpenCodeServerProcess',
        error instanceof Error ? error.message : String(error ?? 'Health check failed.'),
        error
      );
    }
    if (!health.healthy || !health.version) {
      throw new OpenCodeRuntimeError(
        'startOpenCodeServerProcess',
        'The OpenCode server started but did not report a healthy status.'
      );
    }
    if (compareOpenCodeVersions(health.version, MIN_OPENCODE_VERSION) < 0) {
      throw new OpenCodeRuntimeError(
        'startOpenCodeServerProcess',
        `OpenCode v${health.version} is too old. Upgrade to v${MIN_OPENCODE_VERSION} or newer.`
      );
    }
    this.healthyVersion = health.version;
    this.healthyPassword = passwordKey;
  }

  /**
   * Accumulate stdout until the ready line appears. Rejects — and tears the
   * half-started child down — on early exit or timeout, so nothing leaks.
   */
  private waitForReady(child: ChildProcess): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdout?.off('data', onStdout);
        child.stderr?.off('data', onStderr);
        child.off('exit', onEarlyExit);
        settle();
      };

      const onStdout = (chunk: Buffer | string) => {
        stdout += chunk.toString();
        const url = parseOpenCodeServerUrlFromOutput(stdout);
        if (url) finish(() => resolve(url));
      };
      const onStderr = (chunk: Buffer | string) => {
        stderr += chunk.toString();
      };
      const onEarlyExit = (code: number | null, signal: NodeJS.Signals | null) => {
        finish(() =>
          reject(
            new OpenCodeRuntimeError(
              'startOpenCodeServerProcess',
              `OpenCode server exited during startup (${summarizeProcessFailure({
                exitCode: code,
                signal,
                stderrTail: stderr,
                stdoutTail: stdout
              })}).`,
              undefined,
              true
            )
          )
        );
      };

      const timer = setTimeout(
        () =>
          finish(() => {
            void this.teardown(child);
            reject(
              new OpenCodeRuntimeError(
                'startOpenCodeServerProcess',
                `Timed out after ${this.spawnTimeoutMs}ms waiting for "opencode server listening …".`
              )
            );
          }),
        this.spawnTimeoutMs
      );

      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);
      child.once('exit', onEarlyExit);
    });
  }

  /**
   * POSIX: signal the process group first (the CLI may leave helpers in it),
   * escalating only when verified necessary. Sequence per stage:
   *
   *   TERM(group|child) → grace → KILL(group|child) → VERIFY death
   *     → if still alive: another KILL round with child-level fallback.
   *
   * Best-effort throughout, mirroring t3code's terminateChild semantics while
   * adding the verify step so a graceful handler outliving the fixed grace
   * can never strand a `serve` process behind Atlas.
   */
  private async teardown(child: ChildProcess): Promise<void> {
    const groupSignal = (signal: NodeJS.Signals): boolean => {
      if (process.platform === 'win32' || typeof child.pid !== 'number') {
        return child.kill(signal);
      }
      try {
        process.kill(-Number(child.pid), signal);
        return true;
      } catch {
        try {
          return child.kill(signal);
        } catch {
          return false;
        }
      }
    };

    const hasExited = () => child.exitCode !== null || child.signalCode !== null;
    // Waiting out a fixed grace after the child has already died is pure quit
    // latency, so every wait races the exit event instead of sleeping through it.
    const exited = new Promise<void>((resolve) => {
      if (hasExited()) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
    });
    const waitForDeath = async (budgetMs: number): Promise<void> => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          exited,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, budgetMs);
          })
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const awaitDeath = async (budgetMs: number): Promise<boolean> => {
      await waitForDeath(budgetMs);
      return hasExited();
    };

    groupSignal('SIGTERM');
    await waitForDeath(this.termGraceMs);
    if (hasExited()) return;

    groupSignal('SIGKILL');
    if (await this.waitForExitWithEscalation(child, hasExited, awaitDeath, groupSignal)) {
      return;
    }

    // Last resort: SIGKILL rounds at child level, verified.
    for (let attempt = 0; attempt < 3 && !hasExited(); attempt += 1) {
      child.kill('SIGKILL');
      await awaitDeath(500);
    }
  }

  private async waitForExitWithEscalation(
    _child: ChildProcess,
    hasExited: () => boolean,
    awaitDeath: (budgetMs: number) => Promise<boolean>,
    groupSignal: (signal: NodeJS.Signals) => boolean
  ): Promise<boolean> {
    const survivedFirst = !(await awaitDeath(750));
    if (!survivedFirst) return true;
    groupSignal('SIGKILL');
    return awaitDeath(750);
  }
}

