import { DatabaseSync } from 'node:sqlite';

import type { SqliteDatabase } from '../../src/main/db/client';
import { applySchema } from '../../src/main/db/schema';

/**
 * In-memory SQLite for repository/runtime tests.
 *
 * `better-sqlite3` in this repo is compiled against Electron's Node ABI and
 * cannot load under plain Node (`ERR_DLOPEN_FAILED`), which is what runs
 * `npm test`. Every suite that needs a database therefore uses `node:sqlite`
 * behind the same three-method surface the repos consume: `exec`, `prepare`,
 * and `transaction`. See the longer note in `pluginIntegration.test.ts`.
 */
export function createSqliteTestDatabase(path = ':memory:') {
  const raw = new DatabaseSync(path);
  const database = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction:
      <TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) =>
      (...args: TArgs) => {
        raw.exec('BEGIN');
        try {
          const result = callback(...args);
          raw.exec('COMMIT');
          return result;
        } catch (error) {
          raw.exec('ROLLBACK');
          throw error;
        }
      },
  } as unknown as SqliteDatabase;

  return { database, raw };
}

export function createAppliedSqliteTestDatabase(path = ':memory:') {
  const { database, raw } = createSqliteTestDatabase(path);
  applySchema(database);
  return { database, raw };
}
