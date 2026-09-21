/**
 * Quarantine-and-reopen recovery for a corrupt on-disk SQLite database.
 *
 * A half-written header or a truncated WAL can make `new Database(path)` or
 * the first pragma/schema call throw. Without recovery the app either dies at
 * boot or the user loses every conversation. The policy is deliberately
 * simple: keep the bad files on disk under a `.corrupt-<timestamp>` suffix,
 * open a fresh database in their place, and let the caller surface the fact
 * to logs and the user. No backup/restore machinery — YAGNI.
 */

import { existsSync, renameSync } from 'node:fs';

import type { SqliteDatabase } from './client';

export type DatabaseRecovery = {
  /** Where the corrupt files were moved (main db path with the suffix applied). */
  quarantinedTo: string;
  /** Human-readable reason that triggered quarantine, for the log line. */
  reason: string;
};

export type OpenSqliteDatabase = (path: string) => SqliteDatabase;

/** SQLite error codes and message fragments that mean "the file is unusable". */
const CORRUPTION_CODES = ['SQLITE_CORRUPT', 'SQLITE_NOTADB', 'SQLITE_CORRUPT_VTAB'];

const CORRUPTION_MESSAGE =
  /database disk image is malformed|file is not a database|malformed|not a database/i;

export function looksLikeSqliteCorruption(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (CORRUPTION_CODES.some((candidate) => code.includes(candidate))) {
    return true;
  }

  return CORRUPTION_MESSAGE.test(error.message);
}

/**
 * Rename the database and its WAL sidecars out of the way.
 *
 * Sidecars are moved with the main file: leaving a stale `-wal`/`-shm` beside
 * a fresh empty db would either fail the next open or silently mix two
 * databases' journals.
 */
export function quarantineDatabaseFiles(databasePath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Millisecond stamps collide when two quarantines land in the same tick
  // (the test does exactly that). Never reuse a name that is already taken.
  let quarantineBase = `${databasePath}.corrupt-${stamp}`;
  const taken = (base: string) =>
    existsSync(base) || existsSync(`${base}-wal`) || existsSync(`${base}-shm`);
  for (let attempt = 1; taken(quarantineBase); attempt += 1) {
    quarantineBase = `${databasePath}.corrupt-${stamp}-${attempt}`;
  }

  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${databasePath}${suffix}`;
    if (!existsSync(source)) {
      continue;
    }
    renameSync(source, `${quarantineBase}${suffix}`);
  }

  return quarantineBase;
}

/**
 * Ask SQLite whether the file is intact. Used only after an open/configure
 * failure: a full `integrity_check` on a multi-GB transcript db is too slow
 * for the happy path.
 */
function probeIntegrityOk(databasePath: string, open: OpenSqliteDatabase): boolean {
  let probe: SqliteDatabase | null = null;
  try {
    probe = open(databasePath);
    const rows = probe.pragma('integrity_check') as Array<{ integrity_check: string }>;
    return rows.length > 0 && rows.every((row) => row.integrity_check === 'ok');
  } catch {
    // Cannot open far enough to check → treat as corrupt enough to quarantine
    // only when the original error already looked like corruption; the caller
    // only reaches here for ambiguous failures, and a file we cannot probe is
    // not something we should keep serving.
    return false;
  } finally {
    try {
      probe?.close();
    } catch {
      // Already closed or failed to open; nothing to release.
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Open `databasePath`, run `onOpened` (pragmas + schema). On a corruption-like
 * failure, quarantine the files and retry once against a fresh database.
 *
 * `open` is injected so unit tests can drive recovery without better-sqlite3
 * (Electron ABI, unavailable under plain Node).
 */
export function openSqliteDatabaseWithRecovery(
  databasePath: string,
  open: OpenSqliteDatabase,
  onOpened: (raw: SqliteDatabase) => void,
): { raw: SqliteDatabase; recovery: DatabaseRecovery | null } {
  const attempt = (): SqliteDatabase => {
    const raw = open(databasePath);
    try {
      onOpened(raw);
      return raw;
    } catch (error) {
      try {
        raw.close();
      } catch {
        // Already closed; the original failure is what matters.
      }
      throw error;
    }
  };

  try {
    return { raw: attempt(), recovery: null };
  } catch (error) {
    const corrupt =
      looksLikeSqliteCorruption(error) ||
      (existsSync(databasePath) && !probeIntegrityOk(databasePath, open));

    if (!corrupt) {
      throw error;
    }

    const quarantinedTo = quarantineDatabaseFiles(databasePath);
    // Fresh path: a second failure is a real bug (permissions, disk full) and
    // must not be papered over with another quarantine.
    const raw = attempt();
    return {
      raw,
      recovery: { quarantinedTo, reason: describeError(error) },
    };
  }
}
