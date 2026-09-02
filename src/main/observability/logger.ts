/**
 * A small JSONL log for the main process.
 *
 * Written because there was no logging at all. Diagnosing a turn that sat on
 * "Thinking" for seven minutes meant copying the user's SQLite file and
 * replaying the prompt build against it, when the answer — four attempts, each
 * timing out after 180s against a 4.9 MB request body — is something the
 * process knew at the time and threw away.
 *
 * Deliberately dependency-free and deliberately dumb: append a line, roll the
 * file when it gets big, keep a few. Anything cleverer (async queues, a
 * transport abstraction) is a thing that can break while trying to record why
 * something else broke.
 *
 * Records are JSON objects, one per line, so `grep`, `jq` and a spreadsheet all
 * work on them without a parser.
 */

import { closeSync, mkdirSync, openSync, readdirSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

/** Roll at 2 MB: small enough to open in anything, large enough for a session. */
const MAX_LOG_BYTES = 2 * 1024 * 1024;

/** The live file plus this many rolled ones. */
const MAX_ROLLED_FILES = 3;

/**
 * Buffer bounds for the batched file writer. Past either, the buffer drains
 * synchronously instead of growing: a log storm costs one syscall per batch,
 * never unbounded memory.
 */
const MAX_PENDING_LINES = 2048;
const MAX_PENDING_BYTES = 8 * 1024 * 1024;

const LOG_FILENAME = 'main.log';

/**
 * Secrets must never reach disk. Keys are compared lowercased, and the check is
 * a substring so `apiKey`, `api_key` and `providerApiKey` are all caught.
 */
const REDACTED_KEY_PATTERNS = ['apikey', 'api_key', 'secret', 'token', 'password', 'authorization'];

/** Long strings are truncated: a log line is a fact, not a payload. */
const MAX_STRING_LENGTH = 512;

function isRedactedKey(key: string) {
  const normalized = key.toLowerCase();
  return REDACTED_KEY_PATTERNS.some((pattern) => normalized.includes(pattern));
}

/**
 * Make a value safe and small enough to write.
 *
 * Handles the three ways a naive `JSON.stringify` ruins a log file: secrets,
 * megabyte strings (a data URL is one), and cycles.
 */
export function sanitizeLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…[+${value.length - MAX_STRING_LENGTH} chars]`
      : value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function' || typeof value === 'symbol') {
    return `[${typeof value}]`;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeLogValue(value.message, depth + 1, seen),
      stack: typeof value.stack === 'string' ? value.stack.split('\n').slice(0, 6).join('\n') : undefined,
    };
  }

  if (depth >= 4) {
    return '[depth limit]';
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[circular]';
    }
    seen.add(value);

    if (ArrayBuffer.isView(value)) {
      return `[bytes ${(value as ArrayBufferView).byteLength}]`;
    }

    if (Array.isArray(value)) {
      // A long array says nothing a head plus a count does not.
      const head = value.slice(0, 20).map((item) => sanitizeLogValue(item, depth + 1, seen));
      return value.length > 20 ? [...head, `[+${value.length - 20} more]`] : head;
    }

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = isRedactedKey(key) ? '[redacted]' : sanitizeLogValue(item, depth + 1, seen);
    }
    return result;
  }

  return String(value);
}

export type LoggerSink = (line: string) => void;

export class Logger {
  private directory: string | null = null;
  private filePath: string | null = null;
  /** Mirrors to the terminal in development, where nobody opens the file. */
  private echoToConsole = false;
  private sink: LoggerSink | null = null;

  /**
   * Buffered file writes.
   *
   * The old writer did a `statSync` (roll check) plus an `appendFileSync` per
   * line, so logging frequency was directly main-thread cost — and the main
   * process is the thread that answers every IPC call. Now lines accumulate in
   * a small buffer and one `writeSync` drains the whole batch at the end of the
   * current tick: ordering is exact (everything is synchronous, just amortised),
   * a crash can lose at most one tick's worth of debug/info lines, and `error`
   * lines bypass the buffer entirely.
   */
  private pending: string[] = [];
  private pendingBytes = 0;
  private flushQueued = false;
  /** Approximate on-disk size, so the roll check needs no `statSync` per line. */
  private approxSize = 0;
  private fileDescriptor: number | null = null;
  /** Set when a file write fails; file logging stops rather than spamming. */
  private fileDisabled = false;
  private maxLogBytes = MAX_LOG_BYTES;
  private exitHookInstalled = false;

  /**
   * Point the log at a directory. Until this is called nothing is written to
   * disk, which is what keeps `logger` a no-op in unit tests.
   */
  configure(options: { directory: string; echoToConsole?: boolean; maxLogBytes?: number }) {
    try {
      mkdirSync(options.directory, { recursive: true });
      this.directory = options.directory;
      this.filePath = join(options.directory, LOG_FILENAME);
      this.echoToConsole = options.echoToConsole ?? false;
      this.maxLogBytes = options.maxLogBytes ?? MAX_LOG_BYTES;
    } catch {
      // A log that cannot be opened must not take the app down with it.
      this.directory = null;
      this.filePath = null;
    }

    this.closeFile();
    this.fileDisabled = false;
    this.approxSize = 0;
    if (this.filePath) {
      try {
        this.approxSize = statSync(this.filePath).size;
      } catch {
        // No file yet.
      }
    }

    // Buffered lines must survive a normal quit. `exit` allows synchronous
    // work only, which is exactly what `flushSync` is.
    if (!this.exitHookInstalled) {
      this.exitHookInstalled = true;
      process.once('exit', () => this.flushSync());
    }
  }

  /** Test seam: capture lines instead of writing them. */
  setSink(sink: LoggerSink | null) {
    this.sink = sink;
  }

  getLogFilePath() {
    return this.filePath;
  }

  debug(event: string, fields?: LogFields) {
    this.write('debug', event, fields);
  }

  info(event: string, fields?: LogFields) {
    this.write('info', event, fields);
  }

  warn(event: string, fields?: LogFields) {
    this.write('warn', event, fields);
  }

  error(event: string, fields?: LogFields) {
    this.write('error', event, fields);
  }

  /**
   * Drain the buffer now, synchronously. Called from `will-quit`/`exit` so a
   * normal quit never leaves buffered lines unwritten, and internally whenever
   * something must not sit in memory (error lines, backpressure).
   */
  flushSync() {
    if (this.pending.length === 0) {
      return;
    }

    const lines = this.pending;
    this.pending = [];
    const bytes = this.pendingBytes;
    this.pendingBytes = 0;

    // One write per batch. The roll check runs here too — per batch rather
    // than per line, using the tracked size instead of a `statSync`.
    try {
      this.rollIfNeeded();
      const fd = this.ensureFile();
      if (fd === null) {
        return;
      }
      writeSync(fd, lines.join('\n') + '\n', null, 'utf8');
      this.approxSize += bytes;
    } catch (error) {
      // Disk full, permissions, a removed directory: never fail a chat turn
      // over logging, but also never swallow it silently — surface it on
      // stderr and stop trying the file.
      this.fileDisabled = true;
      // eslint-disable-next-line no-console
      console.error('[atlas] log file write failed; file logging disabled:', error);
    }
  }

  private ensureFile(): number | null {
    if (this.fileDisabled || !this.filePath) {
      return null;
    }

    if (this.fileDescriptor === null) {
      this.fileDescriptor = openSync(this.filePath, 'a');
    }

    return this.fileDescriptor;
  }

  private closeFile() {
    if (this.fileDescriptor !== null) {
      try {
        closeSync(this.fileDescriptor);
      } catch {
        // Already closed or the file is gone; nothing to recover.
      }
      this.fileDescriptor = null;
    }
  }

  private scheduleFlush() {
    if (this.flushQueued) {
      return;
    }

    this.flushQueued = true;
    setImmediate(() => {
      this.flushQueued = false;
      this.flushSync();
    });
  }

  private write(level: LogLevel, event: string, fields?: LogFields) {
    if (!this.sink && !this.filePath && !this.echoToConsole) {
      return;
    }

    let line: string;
    try {
      line = JSON.stringify({
        at: new Date().toISOString(),
        level,
        event,
        ...(fields ? (sanitizeLogValue(fields) as LogFields) : {}),
      });
    } catch {
      // Serialisation itself failed; record that rather than nothing.
      line = JSON.stringify({ at: new Date().toISOString(), level, event, note: 'unserialisable fields' });
    }

    if (this.sink) {
      this.sink(line);
      return;
    }

    if (this.echoToConsole) {
      // eslint-disable-next-line no-console
      console[level === 'debug' ? 'log' : level](`[atlas] ${line}`);
    }

    if (!this.filePath) {
      return;
    }

    // Error lines go out immediately — they are the reason the log exists,
    // and the one kind of line a crash must not be able to eat. The pending
    // buffer drains first so ordering is preserved.
    if (level === 'error') {
      this.flushSync();
      this.pending.push(line);
      this.pendingBytes += Buffer.byteLength(line) + 1;
      this.flushSync();
      return;
    }

    this.pending.push(line);
    this.pendingBytes += Buffer.byteLength(line) + 1;

    // Backpressure: a burst of logging must not grow the buffer without
    // bound. Past the cap, drain synchronously — the cost is one syscall,
    // which is what every line used to cost anyway.
    if (this.pendingBytes >= MAX_PENDING_BYTES || this.pending.length >= MAX_PENDING_LINES) {
      this.flushSync();
      return;
    }

    this.scheduleFlush();
  }

  private rollIfNeeded() {
    if (!this.filePath || !this.directory) {
      return;
    }

    if (this.approxSize < this.maxLogBytes) {
      return;
    }

    this.closeFile();

    // `main.log` → `main.log.<stamp>`, and the previous stamp is dropped rather
    // than shuffled: keeping N generations honest costs N renames per roll, and
    // the oldest is the least interesting thing on disk.
    const stamped = `${LOG_FILENAME}.${Date.now()}`;
    renameSync(this.filePath, join(this.directory, stamped));
    this.approxSize = 0;

    try {
      const rolled = readdirSync(this.directory)
        .filter((name) => name.startsWith(`${LOG_FILENAME}.`))
        .sort();

      for (const name of rolled.slice(0, Math.max(0, rolled.length - MAX_ROLLED_FILES))) {
        unlinkSync(join(this.directory, name));
      }
    } catch {
      // Pruning is housekeeping; a failure here just leaves more files.
    }
  }
}

export const logger = new Logger();

/** Elapsed-time helper so call sites do not each invent one. */
export function startTimer() {
  const startedAt = Date.now();
  return () => Date.now() - startedAt;
}
