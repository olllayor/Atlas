/**
 * Quarantine-and-reopen recovery for a corrupt on-disk SQLite file.
 *
 * better-sqlite3 is compiled against Electron's ABI and cannot load under
 * plain Node (same note as `tests/helpers/sqliteTestDb.ts`), so the open
 * callback is injected. The tests still touch real files: quarantine is an
 * fs rename, not a mock.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client';
import {
  looksLikeSqliteCorruption,
  openSqliteDatabaseWithRecovery,
  quarantineDatabaseFiles,
} from '../src/main/db/sqliteRecovery';

function setup(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-sqlite-recovery-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, databasePath: join(dir, 'atlas-chat.db') };
}

function corruptError(message = 'database disk image is malformed'): Error & { code?: string } {
  const error = new Error(message) as Error & { code?: string };
  error.code = 'SQLITE_CORRUPT';
  return error;
}

/** Minimal stand-in for better-sqlite3's Database surface used by recovery. */
function fakeDatabase(options: { integrityOk?: boolean } = {}): SqliteDatabase {
  const integrityOk = options.integrityOk ?? true;
  return {
    pragma: (name: string) =>
      name === 'integrity_check' ? [{ integrity_check: integrityOk ? 'ok' : '*** in database 1 ***' }] : [],
    close: () => undefined,
  } as unknown as SqliteDatabase;
}

test('looksLikeSqliteCorruption matches codes and messages', () => {
  assert.equal(looksLikeSqliteCorruption(corruptError()), true);
  assert.equal(looksLikeSqliteCorruption(new Error('file is not a database')), true);

  const notADb = new Error('unable to open database file') as Error & { code?: string };
  notADb.code = 'SQLITE_CANTOPEN';
  assert.equal(looksLikeSqliteCorruption(notADb), false);
  assert.equal(looksLikeSqliteCorruption(new Error('disk I/O error')), false);
  assert.equal(looksLikeSqliteCorruption('SQLITE_CORRUPT'), false);
});

test('quarantine renames the db and its WAL sidecars, leaves the path free', (t) => {
  const { dir, databasePath } = setup(t);
  writeFileSync(databasePath, 'not-a-database');
  writeFileSync(`${databasePath}-wal`, 'stale-wal');
  writeFileSync(`${databasePath}-shm`, 'stale-shm');

  const quarantinedTo = quarantineDatabaseFiles(databasePath);

  assert.equal(existsSync(databasePath), false);
  assert.equal(existsSync(`${databasePath}-wal`), false);
  assert.equal(existsSync(`${databasePath}-shm`), false);
  assert.equal(existsSync(quarantinedTo), true);
  assert.equal(existsSync(`${quarantinedTo}-wal`), true);
  assert.equal(existsSync(`${quarantinedTo}-shm`), true);
  assert.equal(readFileSync(quarantinedTo, 'utf8'), 'not-a-database');
  assert.ok(quarantinedTo.startsWith(`${databasePath}.corrupt-`));
  // One timestamped quarantine per call; the helper never overwrites.
  assert.notEqual(quarantineDatabaseFiles(databasePath), quarantinedTo);
});

test('open failure that looks like corruption quarantines and reopens a fresh db', (t) => {
  const { databasePath } = setup(t);
  writeFileSync(databasePath, 'garbage');

  let opens = 0;
  let configureCalls = 0;
  const result = openSqliteDatabaseWithRecovery(
    databasePath,
    (path) => {
      opens += 1;
      if (opens === 1) {
        // Simulate better-sqlite3 failing once it actually reads the file.
        throw corruptError();
      }
      writeFileSync(path, 'fresh');
      return fakeDatabase();
    },
    () => {
      configureCalls += 1;
    },
  );

  assert.equal(opens, 2);
  // First open throws inside `open`, so configure only runs on the fresh reopen.
  assert.equal(configureCalls, 1);
  assert.ok(result.recovery);
  assert.equal(existsSync(result.recovery!.quarantinedTo), true);
  assert.equal(readFileSync(result.recovery!.quarantinedTo, 'utf8'), 'garbage');
  assert.equal(readFileSync(databasePath, 'utf8'), 'fresh');
  assert.match(result.recovery!.reason, /malformed/);
});

test('open succeeds when the file is healthy — no recovery record', (t) => {
  const { databasePath } = setup(t);
  writeFileSync(databasePath, 'healthy');

  const result = openSqliteDatabaseWithRecovery(databasePath, () => fakeDatabase(), () => undefined);

  assert.equal(result.recovery, null);
  assert.equal(readFileSync(databasePath, 'utf8'), 'healthy');
});

test('ambiguous open failure still quarantines when integrity_check fails', (t) => {
  const { databasePath } = setup(t);
  writeFileSync(databasePath, 'half-written-header');

  let opens = 0;
  const result = openSqliteDatabaseWithRecovery(
    databasePath,
    () => {
      opens += 1;
      // First open fails with a non-corruption-shaped error; the integrity
      // probe (second open) reports a bad image.
      if (opens === 1) {
        throw new Error('unable to open database file');
      }
      return fakeDatabase({ integrityOk: opens !== 2 });
    },
    (raw) => {
      if (opens === 1) {
        return;
      }
      // Configure on the post-quarantine open (3rd) succeeds; probe is 2nd.
      if (opens === 3) {
        return;
      }
      throw new Error('schema apply failed');
    },
  );

  assert.ok(result.recovery);
  assert.equal(existsSync(result.recovery!.quarantinedTo), true);
  assert.equal(existsSync(databasePath), false); // quarantine moved it; fake open does not recreate
});

test('non-corruption open failure is rethrown without quarantining', (t) => {
  const { dir, databasePath } = setup(t);
  writeFileSync(databasePath, 'healthy-enough');
  const before = readFileSync(databasePath, 'utf8');

  assert.throws(
    () =>
      openSqliteDatabaseWithRecovery(
        databasePath,
        () => fakeDatabase(),
        () => {
          throw new Error('disk I/O error');
        },
      ),
    /disk I\/O error/,
  );
  // File untouched: integrity_check on a readable non-corrupt file returns ok,
  // so recovery declines and the original error surfaces.
  assert.equal(readFileSync(databasePath, 'utf8'), before);
  assert.deepEqual(
    readdirSync(dir).filter((name) => name.includes('.corrupt-')),
    [],
  );
});
