import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { PluginConsentRepo } from '../src/main/db/repositories/pluginConsentRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import { spawnConsentKey } from '../src/shared/mcp.js';

function createDatabase() {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-spawn-consent-'));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));
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

  applySchema(database);

  return { database, raw, tempDir };
}

test('spawnConsentKey: same identity produces a stable key', () => {
  const identity = {
    id: 'plugin:github:github',
    command: 'node',
    args: ['server.js', '--port', '3000'],
    cwd: '/opt/plugin'
  };

  const first = spawnConsentKey(identity);
  const second = spawnConsentKey(identity);

  assert.equal(first, second);
  assert.ok(first.length > 8, 'key should carry enough identity to be useful');
});

test('spawnConsentKey: distinct commands produce distinct keys', () => {
  const identity = {
    id: 'plugin:github:github',
    command: 'node',
    args: ['server.js'],
    cwd: '/opt/plugin'
  };

  const a = spawnConsentKey(identity);
  const b = spawnConsentKey({ ...identity, command: '/usr/bin/node' });

  assert.notEqual(a, b, 'changing the executable must change the key');
});

test('spawnConsentKey: args or cwd changes produce distinct keys', () => {
  const identity = {
    id: 'plugin:github:github',
    command: 'node',
    args: ['server.js'],
    cwd: '/opt/plugin'
  };

  const base = spawnConsentKey(identity);
  const withArgs = spawnConsentKey({ ...identity, args: ['server.js', '--debug'] });
  const withCwd = spawnConsentKey({ ...identity, cwd: '/tmp' });

  assert.notEqual(base, withArgs, 'changing args must change the key');
  assert.notEqual(base, withCwd, 'changing cwd must change the key');
});

test('spawnConsentKey: null command throws (HTTP servers are not a consent case)', () => {
  assert.throws(
    () =>
      spawnConsentKey({
        id: 'plugin:github:github',
        command: null,
        args: [],
        cwd: null
      }),
    /command/
  );
});

test('pluginConsentRepo: grant, get, deny-overwrites-grant, clear', () => {
  const { database, tempDir } = createDatabase();
  const repo = new PluginConsentRepo(database);
  const consentKey = 'plugin:github:github|abc123';
  const serverId = 'plugin:github:github';

  try {
    assert.equal(repo.get(consentKey), null, 'unknown key must not look decided');

    repo.grant({ consentKey, serverId, grantedAt: '2026-08-11T00:00:00Z' });
    const granted = repo.get(consentKey);
    assert.equal(granted?.decision, 'granted');
    assert.equal(granted?.serverId, serverId);
    assert.equal(granted?.grantedAt, '2026-08-11T00:00:00Z');

    repo.deny({ consentKey, serverId, grantedAt: '2026-08-11T01:00:00Z' });
    const denied = repo.get(consentKey);
    assert.equal(denied?.decision, 'denied', 'deny must overwrite a prior grant');
    assert.equal(denied?.grantedAt, '2026-08-11T01:00:00Z');

    repo.clear(consentKey);
    assert.equal(repo.get(consentKey), null, 'clear must drop the record entirely');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
