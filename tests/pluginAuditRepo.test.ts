import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { PluginAuditRepo } from '../src/main/db/repositories/pluginAuditRepo.js';
import { applySchema } from '../src/main/db/schema.js';
import { buildAuditRecord } from '../src/shared/pluginAudit.js';

/**
 * Durability, the property `McpAuditLog`'s in-memory ring cannot offer.
 *
 * The whole reason this table exists: an audit record has to survive the
 * process that wrote it exiting. `reopen()` below is not a simulation of
 * that — it closes the real database handle and opens a fresh one at the same
 * path, which is exactly what happens across an app restart.
 */

function createDatabase(dir: string) {
  const path = join(dir, 'atlas.db');
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

  applySchema(database);

  return { database, raw, path };
}

function setup(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-plugin-audit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  let current = createDatabase(dir);
  t.after(() => current.raw.close());

  return {
    repo: () => new PluginAuditRepo(current.database),
    /** The live `conversations` table, for the cascade test below. */
    raw: () => current.raw,
    /** Closes the handle and opens a fresh one at the same path — a restart. */
    reopen: () => {
      current.raw.close();
      current = createDatabase(dir);
      return new PluginAuditRepo(current.database);
    }
  };
}

const AT = '2026-08-07T12:00:00.000Z';

function sample(overrides: Partial<Parameters<typeof buildAuditRecord>[0]> = {}) {
  return buildAuditRecord({
    id: 'a1',
    requestId: 'req-1',
    conversationId: 'conv-1',
    type: 'mcp_call',
    at: AT,
    server: { name: 'github/github', transport: 'http', endpoint: 'https://api.example.com/mcp' },
    plugin: { name: 'github', version: '1.4.0' },
    tool: 'search_issues',
    outcome: 'ok',
    approvalId: 'ap-1',
    toolCallId: 'call-1',
    detail: null,
    payload: { arguments: { q: 'bugs' } },
    ...overrides
  });
}

/* ------------------------------------------------------------------ *
 * Round-tripping
 * ------------------------------------------------------------------ */

test('a written record reads back with every field intact', (t) => {
  const { repo } = setup(t);
  const audit = repo();

  audit.append(sample(), 'mc:call-1:ok');

  const [read] = audit.forRequest('req-1');

  assert.deepEqual(read, sample());
});

test('a record with no payload round-trips payload as undefined, not null', (t) => {
  const { repo } = setup(t);
  const audit = repo();

  audit.append(sample({ payload: undefined, tool: null, server: null, plugin: null }), 'pi:req-1:github:');

  const [read] = audit.forRequest('req-1');

  assert.equal(read.payload, undefined);
  assert.equal(read.server, null);
  assert.equal(read.plugin, null);
});

/* ------------------------------------------------------------------ *
 * The property this table exists for
 * ------------------------------------------------------------------ */

test('a record survives the process that wrote it exiting', (t) => {
  const { repo, reopen } = setup(t);

  repo().append(sample(), 'mc:call-1:ok');

  // Not a fresh instance over the same handle — a new handle at the same
  // path, which is what a restart actually is.
  const restarted = reopen();

  assert.deepEqual(restarted.forRequest('req-1'), [sample()]);
});

test('a truncated record keeps its truncation metadata across a restart', (t) => {
  const { repo, reopen } = setup(t);

  const record = buildAuditRecord({
    id: 'a2',
    requestId: 'req-2',
    conversationId: 'conv-1',
    type: 'mcp_call',
    at: AT,
    server: null,
    plugin: null,
    tool: 'huge_tool',
    outcome: 'ok',
    approvalId: null,
    toolCallId: 'call-2',
    detail: null,
    payload: { body: 'x'.repeat(50_000) }
  });

  assert.ok(record.truncation, 'sanity: the fixture actually triggers truncation');

  repo().append(record, 'mc:call-2:ok');

  const [read] = reopen().forRequest('req-2');

  assert.deepEqual(read.truncation, record.truncation);
});

/* ------------------------------------------------------------------ *
 * Idempotency
 * ------------------------------------------------------------------ */

test('the same idempotency key lands once', (t) => {
  const { repo } = setup(t);
  const audit = repo();

  const first = audit.append(sample(), 'ap:ap-1');
  const second = audit.append(sample({ id: 'a1-retry', detail: 'a different retry' }), 'ap:ap-1');

  assert.equal(first, true, 'the first write is new');
  assert.equal(second, false, 'the second is recognised as the same event');
  assert.equal(audit.forRequest('req-1').length, 1);
  // The row that survives is the *first* one written, not silently replaced by
  // the retry's content — ON CONFLICT DO NOTHING, not DO UPDATE.
  assert.equal(audit.forRequest('req-1')[0].id, 'a1');
});

test('different idempotency keys are different rows even with identical content', (t) => {
  const { repo } = setup(t);
  const audit = repo();

  audit.append(sample({ id: 'a1' }), 'mc:call-1:ok');
  audit.append(sample({ id: 'a2' }), 'mc:call-1:ok:2');

  assert.equal(audit.forRequest('req-1').length, 2);
});

/* ------------------------------------------------------------------ *
 * Retrieval
 * ------------------------------------------------------------------ */

test('forRequest and forConversation each scope correctly', (t) => {
  const { repo } = setup(t);
  const audit = repo();

  audit.append(sample({ id: 'a1', requestId: 'req-1', conversationId: 'conv-1' }), 'k1');
  audit.append(sample({ id: 'a2', requestId: 'req-2', conversationId: 'conv-1' }), 'k2');
  audit.append(sample({ id: 'a3', requestId: 'req-3', conversationId: 'conv-2' }), 'k3');

  assert.deepEqual(
    audit.forRequest('req-1').map((r) => r.id),
    ['a1']
  );
  assert.deepEqual(
    audit.forConversation('conv-1').map((r) => r.id).sort(),
    ['a1', 'a2']
  );
  assert.deepEqual(
    audit.forConversation('conv-2').map((r) => r.id),
    ['a3']
  );
});

test('an unknown request or conversation returns an empty list, not an error', (t) => {
  const { repo } = setup(t);
  const audit = repo();

  assert.deepEqual(audit.forRequest('never-happened'), []);
  assert.deepEqual(audit.forConversation('never-happened'), []);
});

test('a deleted conversation does not take its audit trail with it', (t) => {
  // Deliberate: plugin_audit_records carries no FK/CASCADE to conversations.
  // The audit trail is evidence, and it is exactly the record someone
  // investigating a deletion would go looking for — it must outlive the thing
  // it describes.
  //
  // Driven against a real row in the real `conversations` table, deleted with
  // a real `DELETE`, not just asserted from the schema's shape: if a future
  // migration ever added a FK here, `PRAGMA foreign_keys = ON` (set at the top
  // of schema.ts) would make SQLite itself cascade the delete, and only an
  // actual delete against an actual foreign row would catch that.
  const { repo, raw } = setup(t);
  const audit = repo();

  raw().exec(`
    INSERT INTO conversations (id, title, created_at, updated_at)
    VALUES ('conv-to-delete', 'Test', '2026-08-07T00:00:00.000Z', '2026-08-07T00:00:00.000Z')
  `);

  audit.append(sample({ conversationId: 'conv-to-delete' }), 'k1');
  assert.equal(audit.forConversation('conv-to-delete').length, 1, 'sanity: the row exists before the delete');

  raw().exec(`DELETE FROM conversations WHERE id = 'conv-to-delete'`);

  assert.equal(
    raw().prepare('SELECT COUNT(*) AS n FROM conversations').get()?.n,
    0,
    'sanity: the conversation is actually gone'
  );
  assert.equal(audit.forConversation('conv-to-delete').length, 1, 'the audit trail survived the delete');
});
