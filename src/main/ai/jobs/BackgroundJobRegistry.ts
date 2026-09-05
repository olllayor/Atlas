/**
 * One owner-fenced registry for every long-running producer in the app.
 *
 * Atlas grew three ad-hoc background mechanisms — `run_in_background` bash
 * (a detached child with a fabricated id, no output, no kill), subagent
 * tasks, and queued turns — with no shared list/read/kill surface. This
 * registry is the protocol all of them can sit under, ported from DeepSeek
 * Harness's `jobs` + `jobs-local` packages and simplified for a harness
 * without cordis scopes: ownership is the conversation id, not an agent
 * fiber.
 *
 * Contract kept from the original:
 *
 * - Ids are branded `<kind>-N` per kind (`bash-1`, `bash-2`, …). They are
 *   predictable on purpose; the conversation fence, not id secrecy, is the
 *   authorization boundary.
 * - `start()` validates, then calls the producer's `run()` exactly once; a
 *   throw leaves nothing registered. Successful return commits without
 *   another failable step.
 * - Settlement is first-wins: one terminal record, one round of contained
 *   listener notification. A rejecting `done` promise is a producer contract
 *   violation and settles as `failed` rather than hanging waiters.
 * - `kill()` invokes producer cancellation BEFORE changing status; a throwing
 *   cancel leaves the job running.
 * - Snapshots are fresh projections, never live state.
 * - Completion notices are delivered exactly once: a terminal job is
 *   "unreported" until a notice drain, a terminal read, a wait, or a kill
 *   observes it; whichever comes first marks it reported.
 */

export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed';

/**
 * Producer kinds. Extend as new producers land (subagent, terminal, …); the
 * registry treats every value as an opaque id namespace.
 */
export type JobKind = 'bash';

export interface JobOutcome {
  /** How the job ended: finished (`completed`), cancelled (`killed`), or broke (`failed`). */
  status: 'completed' | 'killed' | 'failed';
  /** Kind-specific detail rendered into status lines ('exit code: 3'). */
  detail?: string;
  /** Final output for jobs without `readOutput`; stream jobs leave it unset. */
  output?: string;
}

export interface JobHooks {
  /**
   * Request termination. Must be synchronous and idempotent, and must
   * eventually settle `done`; throws propagate to the caller of `kill`.
   */
  cancel(reason?: string): void;
  /**
   * Resolves after the producer releases its resources, not merely when work
   * finishes. Must not reject; the registry converts a rejection to `failed`.
   */
  done: Promise<JobOutcome>;
  /**
   * Consume output produced since the previous call. Absence marks a
   * final-output-only job; each job has one consuming cursor.
   */
  readOutput?(): string;
  /**
   * Non-destructive look at the last complete lines of a live stream job —
   * what a UI preview shows without stealing from the consuming cursor
   * (`readOutput`) that `job_output` drains. Absence means no preview.
   */
  peekTail?(lines: number): string[];
}

export interface JobStart {
  /** Producer kind — also the id prefix. */
  kind: JobKind;
  /** One-line model-facing label (the command or its description). */
  label: string;
  /** Owning conversation; access is fenced by it and its deletion kills the job. */
  conversationId: string;
  /**
   * Optional UTF-8 byte cap for each model-facing output read or completion
   * notice. Reads retain the output tail; notices retain their stable id
   * prefix and collection instruction first.
   */
  outputLimitBytes?: number;
  /** Start the work after preflight and synchronously return its hooks. */
  run(): JobHooks;
}

/** A read-only projection of one job — a fresh object per call. */
export interface JobSnapshot {
  /** The registry-issued id (`<kind>-N`). */
  id: string;
  kind: JobKind;
  label: string;
  conversationId: string;
  outputLimitBytes?: number;
  status: JobStatus;
  /** Kind-specific detail, present once the producer supplied one. */
  detail?: string;
  /** Epoch ms when the job was registered. */
  startedAt: number;
  /** Epoch ms when the job settled; absent while `running`/`stopping`. */
  finishedAt?: number;
  /**
   * Last lines of a live stream job's output (UI preview, non-consuming).
   * Present only while the job runs and its producer exposes `peekTail`.
   */
  tail?: string[];
}

export interface JobRead {
  /**
   * Stream kinds: the consuming delta since the previous read. Final-output
   * kinds: empty while live, the terminal output once settled — idempotent,
   * never consumed.
   */
  text: string;
  snapshot: JobSnapshot;
}

export type JobDoneListener = (snapshot: JobSnapshot) => void;

/** Fired right after a job is registered and its producer has started. */
export type JobStartListener = (snapshot: JobSnapshot) => void;

function isTerminal(status: JobStatus): boolean {
  return status === 'completed' || status === 'killed' || status === 'failed';
}

interface TrackedJob {
  id: string;
  kind: JobKind;
  label: string;
  conversationId: string;
  outputLimitBytes: number | undefined;
  cancel: (reason?: string) => void;
  readOutput: (() => string) | undefined;
  peekTail: ((lines: number) => string[]) | undefined;
  status: JobStatus;
  detail: string | undefined;
  output: string | undefined;
  startedAt: number;
  finishedAt: number | undefined;
  /** True once a drain, terminal read, wait, or kill reported the terminal state. */
  reported: boolean;
  settled: Promise<void>;
  markSettled: () => void;
}

/** Default cap on live jobs per conversation (dsh's per-owner default). */
export const DEFAULT_MAX_JOBS_PER_CONVERSATION = 10;

export class BackgroundJobRegistry {
  private readonly store = new Map<string, TrackedJob>();
  private readonly counters = new Map<string, number>();
  private readonly doneListeners = new Set<JobDoneListener>();
  private readonly startListeners = new Set<JobStartListener>();

  constructor(
    private readonly maxJobsPerConversation: number = DEFAULT_MAX_JOBS_PER_CONVERSATION,
    private readonly now: () => number = () => Date.now()
  ) {
    if (!Number.isInteger(maxJobsPerConversation) || maxJobsPerConversation < 1) {
      throw new Error(`BackgroundJobRegistry: maxJobsPerConversation must be a positive integer (got ${maxJobsPerConversation})`);
    }
  }

  /**
   * Register and start a job. Returns the issued id. Throws before producer
   * execution on invalid specs or a full conversation bucket; a `run()`
   * throw leaves nothing registered.
   */
  start(spec: JobStart): string {
    if (!spec.kind) {
      throw new Error('invalid job kind: expected a non-empty string');
    }
    if (!spec.label.trim()) {
      throw new Error('invalid job label: expected a non-empty string');
    }
    if (!spec.conversationId) {
      throw new Error('invalid job owner: expected a conversation id');
    }
    if (
      spec.outputLimitBytes !== undefined &&
      (!Number.isSafeInteger(spec.outputLimitBytes) || spec.outputLimitBytes <= 0)
    ) {
      throw new Error(`invalid outputLimitBytes: expected a positive safe integer, got ${JSON.stringify(spec.outputLimitBytes)}`);
    }

    const active = this.activeCount(spec.conversationId);
    if (active >= this.maxJobsPerConversation) {
      throw new Error(
        `background job limit reached for this conversation (limit: ${this.maxJobsPerConversation}); ` +
          'use job_kill to stop an unneeded job, wait for it to finish, then retry'
      );
    }

    const hooks = spec.run();

    const count = (this.counters.get(spec.kind) ?? 0) + 1;
    this.counters.set(spec.kind, count);
    const id = `${spec.kind}-${count}`;

    let markSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve;
    });

    const job: TrackedJob = {
      id,
      kind: spec.kind,
      label: spec.label,
      conversationId: spec.conversationId,
      outputLimitBytes: spec.outputLimitBytes,
      cancel: hooks.cancel.bind(hooks),
      readOutput: hooks.readOutput?.bind(hooks),
      peekTail: hooks.peekTail?.bind(hooks),
      status: 'running',
      detail: undefined,
      output: undefined,
      startedAt: this.now(),
      finishedAt: undefined,
      reported: false,
      settled,
      markSettled
    };
    this.store.set(id, job);

    const startSnapshot = this.snapshot(job);
    for (const listener of this.startListeners) {
      try {
        void listener(startSnapshot);
      } catch {
        // Same containment as done-listeners: one bad observer must not
        // break registration.
      }
    }

    void hooks.done.then(
      (outcome) => this.settle(job, outcome),
      (error: unknown) => {
        // Contain a producer contract violation (`done` rejected) so cleanup
        // and waiters cannot hang.
        this.settle(job, { status: 'failed', detail: `producer done promise rejected: ${String(error)}` });
      }
    );

    return id;
  }

  /** Snapshot for one job, or `undefined` when unknown. */
  get(id: string): JobSnapshot | undefined {
    const job = this.store.get(id);
    return job ? this.snapshot(job) : undefined;
  }

  /** Snapshots of every job owned by the conversation, registration order. */
  list(conversationId: string): JobSnapshot[] {
    return [...this.store.values()]
      .filter((job) => job.conversationId === conversationId)
      .map((job) => this.snapshot(job));
  }

  /**
   * Snapshots of every job across all conversations, registration order.
   * Whole-app views (sidebar attention, activity bell) need cross-conversation
   * truth; per-conversation consumers keep using the fenced `list`.
   */
  listAll(): JobSnapshot[] {
    return [...this.store.values()].map((job) => this.snapshot(job));
  }

  /**
   * Read output. Stream jobs consume the delta since the last read;
   * final-output jobs return their terminal output idempotently. Terminal
   * reads mark the job reported (the caller saw the outcome).
   */
  read(id: string, conversationId: string): JobRead {
    const job = this.expectFenced(id, conversationId);

    let text: string;
    if (job.readOutput) {
      text = job.readOutput();
    } else if (isTerminal(job.status)) {
      text = job.output ?? '';
    } else {
      text = '';
    }

    if (isTerminal(job.status)) {
      job.reported = true;
    }

    return {
      text: capOutputText(text, job.outputLimitBytes),
      snapshot: this.snapshot(job)
    };
  }

  /**
   * Request cancellation. Producer cancellation runs first; a throw leaves
   * the job running and propagates. Success moves the job to `stopping` and
   * marks terminal delivery reported — the killer will see the outcome in
   * the returned snapshot or a later read, so no notice is owed.
   */
  kill(id: string, conversationId: string, reason?: string): JobSnapshot {
    const job = this.expectFenced(id, conversationId);

    if (isTerminal(job.status)) {
      job.reported = true;
      return this.snapshot(job);
    }

    job.cancel(reason);
    if (!isTerminal(job.status)) {
      job.status = 'stopping';
    }
    job.reported = true;
    return this.snapshot(job);
  }

  /**
   * Wait for settlement, up to `timeoutMs`. Resolves with the terminal
   * snapshot, or the live snapshot at timeout — a timed-out job keeps
   * running. A settled wait marks the job reported.
   */
  async wait(id: string, timeoutMs: number, conversationId: string): Promise<JobSnapshot> {
    const job = this.expectFenced(id, conversationId);

    if (!isTerminal(job.status)) {
      await Promise.race([job.settled, sleep(Math.max(0, timeoutMs))]);
    }

    if (isTerminal(job.status)) {
      job.reported = true;
    }
    return this.snapshot(job);
  }

  /**
   * Observe each settlement. Listener throws are contained; returns an
   * unsubscribe function.
   */
  onJobDone(listener: JobDoneListener): () => void {
    this.doneListeners.add(listener);
    return () => this.doneListeners.delete(listener);
  }

  /**
   * Observe each registration. Listener throws are contained; returns an
   * unsubscribe function.
   */
  onJobStart(listener: JobStartListener): () => void {
    this.startListeners.add(listener);
    return () => this.startListeners.delete(listener);
  }

  /**
   * Claim every unreported terminal job for the conversation, marking each
   * reported. The turn loop injects one notice per drained snapshot —
   * several jobs settling together cost one step, not one turn each.
   */
  drainCompletionNotices(conversationId: string): JobSnapshot[] {
    const drained: JobSnapshot[] = [];
    for (const job of this.store.values()) {
      if (job.conversationId !== conversationId || !isTerminal(job.status) || job.reported) {
        continue;
      }
      job.reported = true;
      drained.push(this.snapshot(job));
    }
    return drained;
  }

  /**
   * Kill every live job owned by the conversation and await their producers.
   * Returns the number of jobs cancelled. Used on conversation deletion —
   * the owner-disposal edge; aborting a turn deliberately does NOT kill
   * background work.
   */
  async killConversation(conversationId: string, reason?: string): Promise<number> {
    const live = [...this.store.values()].filter(
      (job) => job.conversationId === conversationId && !isTerminal(job.status)
    );
    await this.killAllOf(live, reason);
    return live.length;
  }

  /** Kill every live job in the registry and await their producers (app quit). */
  async killAll(reason?: string): Promise<number> {
    const live = [...this.store.values()].filter((job) => !isTerminal(job.status));
    await this.killAllOf(live, reason);
    return live.length;
  }

  /** Live (`running`/`stopping`) job count, optionally fenced to a conversation. */
  activeCount(conversationId?: string): number {
    let count = 0;
    for (const job of this.store.values()) {
      if (isTerminal(job.status)) continue;
      if (conversationId !== undefined && job.conversationId !== conversationId) continue;
      count += 1;
    }
    return count;
  }

  private async killAllOf(jobs: TrackedJob[], reason?: string): Promise<void> {
    for (const job of jobs) {
      try {
        job.cancel(reason);
        if (!isTerminal(job.status)) {
          job.status = 'stopping';
        }
        // Teardown claims delivery: the owner being destroyed leaves no
        // reader, and a notice nobody can claim is wasted work.
        job.reported = true;
      } catch {
        // A throwing teardown cancel force-fails only the record; the
        // producer may have orphaned its process, and saying it stopped
        // would be a lie.
        this.settle(job, { status: 'failed', detail: 'teardown cancellation threw' });
      }
    }
    await Promise.all(jobs.map((job) => job.settled));
  }

  private settle(job: TrackedJob, outcome: JobOutcome): void {
    if (isTerminal(job.status)) {
      return; // first-wins
    }

    job.status = outcome.status;
    job.detail = outcome.detail;
    job.output = outcome.output;
    job.finishedAt = this.now();
    job.markSettled();

    const snapshot = this.snapshot(job);
    for (const listener of this.doneListeners) {
      try {
        void listener(snapshot);
      } catch {
        // Listener work is fire-and-forget; one bad observer must not blind
        // the rest or break settlement.
      }
    }
  }

  private expectFenced(id: string, conversationId: string): TrackedJob {
    const job = this.store.get(id);
    if (!job) {
      throw new Error(`no background job "${id}" exists`);
    }
    // Ids like `bash-1` are predictable, so this fence is the boundary.
    if (job.conversationId !== conversationId) {
      throw new Error(`background job "${id}" belongs to another conversation`);
    }
    return job;
  }

  private snapshot(job: TrackedJob): JobSnapshot {
    const live = !isTerminal(job.status);
    return {
      id: job.id,
      kind: job.kind,
      label: job.label,
      conversationId: job.conversationId,
      ...(job.outputLimitBytes !== undefined ? { outputLimitBytes: job.outputLimitBytes } : {}),
      status: job.status,
      ...(job.detail !== undefined ? { detail: job.detail } : {}),
      startedAt: job.startedAt,
      ...(job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {}),
      ...(live && job.peekTail
        ? {
            tail: job
              .peekTail(JOB_TAIL_LINES)
              .slice(0, JOB_TAIL_LINES)
              .map((line) => (line.length > JOB_TAIL_LINE_MAX_CHARS ? `${line.slice(0, JOB_TAIL_LINE_MAX_CHARS)}…` : line))
          }
        : {})
    };
  }
}

/** Preview lines a snapshot carries for a live stream job. */
const JOB_TAIL_LINES = 3;
/** Per-line cap so one runaway line cannot bloat every broadcast. */
const JOB_TAIL_LINE_MAX_CHARS = 160;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cap a model-facing output string at `limitBytes` UTF-8, retaining the tail
 * (the recent output is what a reader wants) plus a truncation marker. A
 * reused marker keeps repeated reads from stacking notices.
 */
export function capOutputText(text: string, limitBytes: number | undefined): string {
  if (limitBytes === undefined || limitBytes <= 0) {
    return text;
  }

  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= limitBytes) {
    return text;
  }

  const marker = '\n…[output truncated]…\n';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const keep = Math.max(0, limitBytes - markerBytes);

  // Walk forward off any continuation byte so the tail starts on a character
  // boundary instead of decoding to U+FFFD.
  let start = buffer.byteLength - keep;
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
    start += 1;
  }

  return `${marker}${buffer.subarray(start).toString('utf8')}`;
}

/**
 * The model-facing completion notice (dsh's exact shape, byte-capped): the
 * stable id prefix and the collection instruction outrank the variable
 * label/detail, so a bounded notice stays actionable.
 */
export function formatCompletionNotice(snapshot: JobSnapshot): string {
  const status = `[status: ${snapshot.status}${snapshot.detail ? ` — ${snapshot.detail}` : ''}]`;
  const full = `background job ${snapshot.id} (${snapshot.kind}: ${snapshot.label}) finished ${status}. Read its output with job_output.`;

  const limit = snapshot.outputLimitBytes;
  if (limit === undefined || Buffer.byteLength(full, 'utf8') <= limit) {
    return full;
  }

  const minimal = `background job ${snapshot.id} finished ${status}. Read its output with job_output.`;
  if (Buffer.byteLength(minimal, 'utf8') <= limit) {
    return minimal;
  }

  return capOutputText(minimal, limit);
}
