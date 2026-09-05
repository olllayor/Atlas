import { BoundedCommandOutput, COMMAND_OUTPUT_BYTE_BUDGET } from '../commandOutputCap';
import type { SpillStream } from './SpillStore';

/**
 * A child-process output sink that keeps the bounded in-memory preview but
 * also persists the FULL stream to a spill file once the ingest budget is
 * crossed.
 *
 * `BoundedCommandOutput` alone middle-truncates anything over the 1 MiB
 * budget, so a large build log or `find` loses its middle before the
 * result-level spill policy ever sees it — spill could only rescue the
 * 50 KB–1 MiB band. This wrapper closes that gap the way DeepSeek Harness's
 * `bash-local` does: the bounded head/tail preview stays in memory for the
 * model, while the complete stream is tee'd to disk and its path reported so
 * the model can pull any region back with `read_file`.
 *
 * Invariants kept:
 *
 * - Lazy. The spill file is opened only on overflow (the first tee call), so
 *   an ordinary command that stays under budget writes nothing to disk.
 * - Best-effort. A failed open or write marks the sink failed and falls back
 *   to the bounded preview alone; spilling must never fail the command.
 * - Bounded on disk. The spill file is capped at {@link COMMAND_SPILL_MAX_BYTES};
 *   a stream beyond it stops being captured (the in-memory preview still
 *   retains head + tail), so a pathological producer cannot fill the disk.
 * - Ordered. Appends are serialized through a promise chain so the file
 *   matches the stream even though the tee fires synchronously while the
 *   file handle opens asynchronously.
 */

/** Per-stream spill-file cap; matches DeepSeek Harness's `maxSpillBytes` default. */
export const COMMAND_SPILL_MAX_BYTES = 64 * 1024 * 1024;

export interface SpillingCommandOutputOptions {
  /** In-memory ingest budget forwarded to the bounded preview. */
  byteBudget?: number;
  /** Spill-file cap; omitted uses {@link COMMAND_SPILL_MAX_BYTES}. */
  maxSpillBytes?: number;
  /** Opens the spill destination once, on first overflow. */
  openStream: () => Promise<SpillStream>;
}

export class SpillingCommandOutput {
  private readonly bounded: BoundedCommandOutput;
  private readonly maxSpillBytes: number;
  private readonly openStream: () => Promise<SpillStream>;

  private streamPromise: Promise<SpillStream | null> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private resolvedPath: string | undefined;
  private spilledBytes = 0;
  private failed = false;
  private capped = false;

  constructor(options: SpillingCommandOutputOptions) {
    this.maxSpillBytes = options.maxSpillBytes ?? COMMAND_SPILL_MAX_BYTES;
    this.openStream = options.openStream;
    this.bounded = new BoundedCommandOutput(
      options.byteBudget ?? COMMAND_OUTPUT_BYTE_BUDGET,
      (text) => this.onOverflow(text)
    );
  }

  write(text: string) {
    this.bounded.write(text);
  }

  toString() {
    return this.bounded.toString();
  }

  get truncated() {
    return this.bounded.truncated;
  }

  /**
   * Flush pending appends and close the spill file. Resolves the spill path
   * when a file was written, or `undefined` when the stream never overflowed
   * (nothing was written) or spilling failed.
   */
  async end(): Promise<string | undefined> {
    if (!this.streamPromise) {
      return undefined;
    }

    await this.writeChain.catch(() => undefined);
    const stream = await this.streamPromise;

    if (stream) {
      await stream.end().catch(() => undefined);
    }

    return this.failed ? undefined : this.resolvedPath;
  }

  private onOverflow(text: string) {
    if (!text || this.failed || this.capped) {
      return;
    }

    const bytes = Buffer.byteLength(text, 'utf8');

    if (this.spilledBytes + bytes > this.maxSpillBytes) {
      // Over the on-disk cap: stop capturing. The bounded preview still
      // retains head + tail, so the model is never left with nothing.
      this.capped = true;
      return;
    }

    this.spilledBytes += bytes;
    const streamPromise = this.ensureStream();

    // Serialize appends so file order matches stream order even though the
    // handle opens asynchronously behind the synchronous tee.
    this.writeChain = this.writeChain
      .then(async () => {
        const stream = await streamPromise;
        if (stream) {
          await stream.append(text);
        }
      })
      .catch(() => {
        this.failed = true;
      });
  }

  private ensureStream(): Promise<SpillStream | null> {
    if (!this.streamPromise) {
      this.streamPromise = this.openStream()
        .then((stream) => {
          this.resolvedPath = stream.path;
          return stream;
        })
        .catch(() => {
          this.failed = true;
          return null;
        });
    }

    return this.streamPromise;
  }
}
