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

import { appendFileSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

/** Roll at 2 MB: small enough to open in anything, large enough for a session. */
const MAX_LOG_BYTES = 2 * 1024 * 1024;

/** The live file plus this many rolled ones. */
const MAX_ROLLED_FILES = 3;

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

class Logger {
  private directory: string | null = null;
  private filePath: string | null = null;
  /** Mirrors to the terminal in development, where nobody opens the file. */
  private echoToConsole = false;
  private sink: LoggerSink | null = null;

  /**
   * Point the log at a directory. Until this is called nothing is written to
   * disk, which is what keeps `logger` a no-op in unit tests.
   */
  configure(options: { directory: string; echoToConsole?: boolean }) {
    try {
      mkdirSync(options.directory, { recursive: true });
      this.directory = options.directory;
      this.filePath = join(options.directory, LOG_FILENAME);
      this.echoToConsole = options.echoToConsole ?? false;
    } catch {
      // A log that cannot be opened must not take the app down with it.
      this.directory = null;
      this.filePath = null;
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

    try {
      this.rollIfNeeded();
      appendFileSync(this.filePath, `${line}\n`, 'utf8');
    } catch {
      // Disk full, permissions, a removed directory: none of it is worth
      // failing a chat turn over.
    }
  }

  private rollIfNeeded() {
    if (!this.filePath || !this.directory) {
      return;
    }

    let size = 0;
    try {
      size = statSync(this.filePath).size;
    } catch {
      // No file yet.
      return;
    }

    if (size < MAX_LOG_BYTES) {
      return;
    }

    // `main.log` → `main.log.1`, and the previous `.1` is dropped rather than
    // shuffled: keeping N generations honest costs N renames per roll, and the
    // oldest is the least interesting thing on disk.
    const stamped = `${LOG_FILENAME}.${Date.now()}`;
    renameSync(this.filePath, join(this.directory, stamped));

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
