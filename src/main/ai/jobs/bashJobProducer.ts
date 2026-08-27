import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

import { BoundedCommandOutput } from '../tools/commandOutputCap';
import type { BackgroundJobRegistry, JobHooks, JobOutcome } from './BackgroundJobRegistry';

/**
 * The background-bash producer for {@link BackgroundJobRegistry}.
 *
 * Before this existed, `run_in_background` spawned a detached child with
 * `stdio: 'ignore'`, unref'd it, and returned a fabricated UUID — no output,
 * no list, no kill, and the process outlived the turn, the window, and the
 * app. Here the child is spawned INSIDE the registry's `run()` preflight (a
 * rejected start spawns nothing), its output is captured on two bounded
 * buffers, and its lifetime is the job's lifetime.
 *
 * Output has two faces, matching dsh's stream-job contract:
 *
 * - A consuming cursor (`readOutput`) draining chunks since the last read,
 *   what `job_output` returns while the job runs. The cursor buffer is
 *   capped: an unread runaway stream drops its oldest output (marked) rather
 *   than growing the main process without bound.
 * - A bounded full-log (`BoundedCommandOutput`, the same head/tail cap the
 *   foreground bash uses) kept for the terminal record and post-mortem reads.
 */

/** Model-facing cap for each job output read or completion notice. */
export const BACKGROUND_JOB_OUTPUT_LIMIT_BYTES = 50_000;

/** Unread-cursor cap: a job nobody reads must not grow without bound. */
const PENDING_OUTPUT_CAP_BYTES = 1024 * 1024;

export interface BackgroundBashSpec {
  command: string;
  description?: string;
  /** The sandboxed launch, exactly as foreground bash would run it. */
  launch: { command: string; args: string[] };
  cwd: string;
  /** Process env shape: values may be undefined (Node's own `process.env` is). */
  env: Record<string, string | undefined>;
  conversationId: string;
  /** Terminal-history hook, same as foreground bash reports. */
  onCommandRun?: (run: { command: string; exitCode: number | null; venue: 'local' }) => void;
}

/**
 * Register and start a background bash job. Throws when the conversation's
 * job bucket is full or the spawn fails preflight — in either case no child
 * is left running without a job.
 */
export function startBackgroundBashJob(
  registry: BackgroundJobRegistry,
  spec: BackgroundBashSpec
): { jobId: string } {
  const jobId = registry.start({
    kind: 'bash',
    label: spec.description?.trim() || spec.command,
    conversationId: spec.conversationId,
    outputLimitBytes: BACKGROUND_JOB_OUTPUT_LIMIT_BYTES,
    run: (): JobHooks => {
      const child = spawn(spec.launch.command, spec.launch.args, {
        cwd: spec.cwd,
        env: spec.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const stdoutDecoder = new StringDecoder('utf8');
      const stderrDecoder = new StringDecoder('utf8');
      const fullLog = new BoundedCommandOutput();

      // The consuming cursor: chunks since the last read, capped.
      let pending: string[] = [];
      let pendingBytes = 0;
      let droppedBytes = 0;

      const append = (text: string) => {
        if (!text) {
          return;
        }
        fullLog.write(text);
        pending.push(text);
        pendingBytes += Buffer.byteLength(text);
        while (pendingBytes > PENDING_OUTPUT_CAP_BYTES && pending.length > 1) {
          const dropped = pending.shift()!;
          pendingBytes -= Buffer.byteLength(dropped);
          droppedBytes += Buffer.byteLength(dropped);
        }
      };

      child.stdout?.on('data', (chunk: Buffer | string) => {
        append(typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk));
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        append(typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk));
      });

      let killRequested = false;
      let killReason: string | undefined;
      let spawnError: string | undefined;

      child.on('error', (error) => {
        spawnError = error.message;
      });

      const done = new Promise<JobOutcome>((resolve) => {
        child.on('close', (code) => {
          append(stdoutDecoder.end());
          append(stderrDecoder.end());
          spec.onCommandRun?.({ command: spec.command, exitCode: code, venue: 'local' });

          if (spawnError) {
            resolve({ status: 'failed', detail: spawnError });
            return;
          }
          if (killRequested) {
            resolve({ status: 'killed', detail: killReason || 'cancelled' });
            return;
          }
          if (code === 0) {
            resolve({ status: 'completed', detail: 'exit code: 0' });
            return;
          }
          resolve({ status: 'failed', detail: `exit code: ${code ?? 'unknown'}` });
        });
      });

      return {
        cancel: (reason?: string) => {
          if (killRequested) {
            return;
          }
          killRequested = true;
          killReason = reason;
          try {
            child.kill('SIGTERM');
          } catch {
            // An already-exited child races the kill: `close` settles the
            // outcome either way.
          }
        },
        done,
        readOutput: () => {
          const dropped = droppedBytes;
          droppedBytes = 0;
          const chunks = pending;
          pending = [];
          pendingBytes = 0;

          const text = chunks.join('');
          if (dropped > 0) {
            return `…[${dropped} bytes of unread output dropped — the job produces more than the read cursor holds; read more often]…\n${text}`;
          }
          return text;
        },
        // UI previews only: never consumes from the `job_output` cursor.
        peekTail: (lines: number) => fullLog.tailLines(lines)
      };
    }
  });

  return { jobId };
}
