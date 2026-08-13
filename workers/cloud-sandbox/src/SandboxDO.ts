import { DurableObject } from 'cloudflare:workers';
import { Workspace } from '@cloudflare/computer';
import { WorkerShellBackend } from '@cloudflare/computer/backends/worker-shell';

/**
 * The workers-runtime LOADER binding (see wrangler.toml `[worker_loaders]`).
 * Typed structurally so we don't depend on a beta types release that may lag
 * the runtime; only the `get` we actually call is declared.
 */
type WorkerLoaderBinding = { get: (...args: unknown[]) => unknown };

type SandboxEnv = {
  SANDBOX_DO: DurableObjectNamespace;
  LOADER?: WorkerLoaderBinding;
};

/**
 * The shape `workspace.runtime.exec` returns for a command backend: a
 * `ReadableStream` of shell events augmented with `result()`/`kill()`. It is
 * declared structurally here because the package's `.d.ts` narrows the return
 * to a private type; the one contract we rely on (a `ReadableStream` whose
 * `cancel()` resolves once the child hits its exit path) is what the worker
 * forwarder races against. See `wrapCommandHandle` in `@cloudflare/computer`.
 */
type ShellExecEvent =
  | { name: 'stdout'; value: string }
  | { name: 'stderr'; value: string }
  | { name: 'exit'; value: number };

type ShellExecHandle = ReadableStream<ShellExecEvent> & {
  result(): Promise<{ exitCode: number }>;
};

/**
 * SandboxDO — one Durable Object per conversation session.
 *
 * Each instance is scoped by conversationId (via idFromName) so shell state
 * (CWD, environment, running processes) is fully isolated between conversations.
 */
export class SandboxDO extends DurableObject<Record<string, never>> {
  #workspace: Workspace | undefined;

  #getWorkspace(): Workspace {
    if (!this.#workspace) {
      const env = this.env as unknown as SandboxEnv;
      const ctx = this.ctx as unknown as {
        id: { toString(): string };
        exports?: { WorkerLoader?: () => WorkerLoaderBinding };
        loader?: WorkerLoaderBinding;
      };
      // Resolution order: explicit binding > WorkerLoader factory > legacy
      // `ctx.loader`. The first is the production path; the other two exist so
      // a mid-rotation runtime never strands a sandbox with no loader at all.
      const loader = env.LOADER ?? ctx.exports?.WorkerLoader?.() ?? ctx.loader;
      if (!loader) {
        throw new Error('SandboxDO: no worker loader available (env.LOADER, ctx.exports.WorkerLoader, ctx.loader all empty)');
      }
      this.#workspace = new Workspace({
        storage: this.ctx.storage as any,
        backends: [
          new WorkerShellBackend({
            loader,
            workspace: { binding: 'SANDBOX_DO', id: this.ctx.id.toString() },
            ctx: this.ctx,
          }),
        ],
        sessionId: this.ctx.id.toString(),
      });
    }
    return this.#workspace;
  }

  async execCommand(
    command: string,
    env: Record<string, string>,
    timeoutMs: number,
    onEvent: (evt: object) => Promise<void>,
    signal?: AbortSignal
  ) {
    const workspace = this.#getWorkspace();
    if (signal?.aborted) return;

    // Runtime exec returns an async iterator of stdout/stderr/exit events.
    // Adding a signal means we wind the iterator down on client disconnect
    // rather than letting "an interesting shell command runs and we answer
    // to nobody" accumulate in isolate memory.
    const execFn = workspace.runtime.exec.bind(workspace.runtime) as (
      cmd: string,
      opts: { backend: string; encoding: 'utf8'; env: Record<string, string>; timeoutMs: number }
    ) => Promise<AsyncIterable<{ name: string; value: unknown }>>;

    try {
      const handle = await execFn(command, {
        backend: 'worker-shell',
        encoding: 'utf8',
        env,
        timeoutMs,
      });

      const iterator = handle[Symbol.asyncIterator]();
      let interrupted = false;

      while (true) {
        if (signal?.aborted) {
          interrupted = true;
          try { await iterator.return?.(); } catch { /* cancel best-effort */ }
          break;
        }

        const abortWait = new Promise<'aborted'>((resolve) => {
          if (!signal) return;
          if (signal.aborted) {
            resolve('aborted');
            return;
          }
          signal.addEventListener('abort', () => resolve('aborted'), { once: true });
        });

        const next = await Promise.race([iterator.next(), abortWait]);
        if (next === 'aborted') {
          interrupted = true;
          try { await iterator.return?.(); } catch { /* cancel best-effort */ }
          break;
        }

        if (next.done) break;

        const event = next.value;
        if (event.name === 'stdout') {
          await onEvent({ type: 'stdout', data: event.value });
        } else if (event.name === 'stderr') {
          await onEvent({ type: 'stderr', data: event.value });
        } else if (event.name === 'exit') {
          await onEvent({ type: 'exit', code: event.value });
        }

        if (signal?.aborted) {
          interrupted = true;
          try { await iterator.return?.(); } catch { /* cancel best-effort */ }
          break;
        }
      }
    } catch (err: unknown) {
      if (signal?.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      try {
        await onEvent({ type: 'error', error: message });
        await onEvent({ type: 'exit', code: 1 });
      } catch {
        /* client gone; nothing to deliver */
      }
    }
  }

  async resetSession(): Promise<{ ok: boolean }> {
    this.#workspace = undefined;
    await this.ctx.storage.deleteAll();
    return { ok: true };
  }
}
