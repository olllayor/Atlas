import { DurableObject } from 'cloudflare:workers';
import { Workspace } from '@cloudflare/computer';
import { WorkerShellBackend } from '@cloudflare/computer/backends/worker-shell';

/**
 * SandboxDO — one Durable Object per conversation session.
 *
 * Each instance is scoped by conversationId (via idFromName) so shell state
 * (CWD, environment, running processes) is fully isolated between conversations.
 *
 * API surface verified against @cloudflare/computer@0.1.1 types:
 *   - Workspace constructed with { storage, backends, sessionId }
 *   - workspace.runtime.exec() returns WorkspaceRuntimeExecHandle which
 *     IS a ReadableStream<WorkspaceRuntimeEvent> (no .events property)
 *   - Events: { name: 'stdout' | 'stderr' | 'exit' | 'result', value, id, seq }
 *   - WorkspaceRuntimeExecOptions: { backend?, encoding?, env?, timeoutMs?, cwd? }
 */
export class SandboxDO extends DurableObject {
  #workspace: Workspace | undefined;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
  }

  #getWorkspace(): Workspace {
    if (!this.#workspace) {
      this.#workspace = new Workspace({
        storage: this.ctx.storage,
        backends: [
          new WorkerShellBackend({ ctx: this.ctx }),
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
    onEvent: (evt: object) => Promise<void>
  ) {
    const workspace = this.#getWorkspace();

    try {
      // workspace.runtime.exec() returns a WorkspaceRuntimeExecHandle which
      // extends ReadableStream<WorkspaceRuntimeEvent<'utf8'>>. Iterate it
      // directly — there is no .events property on the handle.
      const handle = await workspace.runtime.exec(command, {
        backend: 'worker-shell',
        encoding: 'utf8',
        env,
        timeoutMs,
      });

      for await (const event of handle) {
        if (event.name === 'stdout') {
          await onEvent({ type: 'stdout', data: event.value });
        } else if (event.name === 'stderr') {
          await onEvent({ type: 'stderr', data: event.value });
        } else if (event.name === 'exit') {
          await onEvent({ type: 'exit', code: event.value });
        }
        // 'result' events carry structured output for callable backends —
        // not relevant for a shell backend; safely ignored.
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await onEvent({ type: 'error', error: message });
      await onEvent({ type: 'exit', code: 1 });
    }
  }
}
