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
  parseOpenCodeServerUrlFromOutput,
  summarizeProcessFailure
} from './openCodeParsers.js';
import { findFreeLocalPort, resolveOpenCodeSpawnEnvironment } from './openCodeEnvironment.js';

export class OpenCodeRuntimeError extends Error {
  constructor(
    public readonly operation: string,
    message: string,
    public readonly cause?: unknown
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
}

const DEFAULT_IDLE_SHUTDOWN_MS = 10 * 60_000;
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

  private readonly childFactory: ChildFactory;
  private readonly spawnTimeoutMs: number;
  private readonly termGraceMs: number;
  private readonly idleShutdownMs: number;

  constructor(options: OpenCodeRuntimeOptions = {}) {
    this.childFactory =
      options.childFactory ?? ((command, args, opts) => defaultSpawn(command, [...args], opts));
    this.spawnTimeoutMs = options.spawnTimeoutMs ?? OPENCODE_SERVER_STARTUP_TIMEOUT_MS;
    this.termGraceMs = options.termGraceMs ?? DEFAULT_TERM_GRACE_MS;
    this.idleShutdownMs = options.idleShutdownMs ?? DEFAULT_IDLE_SHUTDOWN_MS;
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

  private async startOwnedServer(input: {
    settings: OpenCodeSettings;
    env?: NodeJS.ProcessEnv;
  }): Promise<RunningServer> {
    const command = input.settings.binaryPath.trim() || 'opencode';
    const port = await findFreeLocalPort();
    const args = ['serve', `--hostname=${OPENCODE_DEFAULT_HOSTNAME}`, `--port=${port}`];
    const env = resolveOpenCodeSpawnEnvironment(input.env);

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

    this.server = { child, baseUrl };

    child.once('exit', () => {
      if (this.server?.child === child) {
        this.server = null;
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
              })}).`
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
    const awaitDeath = async (budgetMs: number): Promise<boolean> => {
      const deadline = Date.now() + budgetMs;
      while (!hasExited()) {
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return true;
    };

    groupSignal('SIGTERM');
    await new Promise<void>((resolve) => setTimeout(resolve, this.termGraceMs));
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

