import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import {
  MESSAGE_SEARCH_MATCH_CLOSE,
  MESSAGE_SEARCH_MATCH_OPEN,
  type SearchMessagesRequest
} from '../src/shared/contracts.js';
import type { SqliteDatabase } from '../src/main/db/client.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { MessageSearchRepo, toFtsMatchExpression } from '../src/main/db/repositories/messageSearchRepo.js';
import { MESSAGE_SEARCH_TABLE, applySchema } from '../src/main/db/schema.js';

function wrap(raw: DatabaseSync): SqliteDatabase {
  return {
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
}

function makeDatabase(t: TestContext, label: string) {
  const tempDir = mkdtempSync(join(tmpdir(), `atlas-${label}-`));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const database = wrap(raw);
  applySchema(database);

  return { database, raw };
}

/**
 * What the database looks like on a SQLite built without FTS5: no index, no
 * triggers pointing at one. Dropping them reproduces that exactly, which is the
 * only way to reach the fallback on a machine whose SQLite does have FTS5.
 */
function removeSearchIndex(raw: DatabaseSync) {
  raw.exec(`
    DROP TRIGGER IF EXISTS messages_fts_insert;
    DROP TRIGGER IF EXISTS messages_fts_delete;
    DROP TRIGGER IF EXISTS messages_fts_update;
    DROP TABLE IF EXISTS ${MESSAGE_SEARCH_TABLE};
  `);
}

function seed(conversations: ConversationsRepo) {
  const live = conversations.create();
  conversations.rename(live.id, 'Refactor the sidebar');
  conversations.addMessage({
    conversationId: live.id,
    role: 'user',
    content: 'Please make the migration idempotent so a reopen cannot break it',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });
  conversations.addMessage({
    conversationId: live.id,
    role: 'assistant',
    content: 'Done — the column probe now runs before every ALTER statement.',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });

  const noise = conversations.create();
  conversations.addMessage({
    conversationId: noise.id,
    role: 'user',
    content: 'Something else entirely about typography',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });

  const archived = conversations.create();
  conversations.addMessage({
    conversationId: archived.id,
    role: 'user',
    content: 'An idempotent migration lives here too, but this chat is archived',
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });
  conversations.setArchived(archived.id, true);

  return { live, noise, archived };
}

test('FTS5 is available in this build, so search runs on the index', (t) => {
  const { database } = makeDatabase(t, 'search-index-present');
  const search = new MessageSearchRepo(database);

  // If this ever fails the app is not broken — it is running on the fallback,
  // which the tests below cover — but the fast path is gone and worth knowing.
  assert.equal(search.hasSearchIndex(), true);
});

test('search finds a phrase in a message body and returns a marked-up snippet', (t) => {
  const { database } = makeDatabase(t, 'search-phrase');
  const conversations = new ConversationsRepo(database);
  const { live } = seed(conversations);

  const hits = conversations.searchMessages({ query: 'idempotent migration' });

  assert.equal(hits.length, 1, 'both words must appear, so only the one message qualifies');
  const [hit] = hits;
  assert.equal(hit.conversationId, live.id);
  assert.equal(hit.conversationTitle, 'Refactor the sidebar');
  assert.equal(hit.role, 'user');
  assert.equal(hit.archived, false);
  assert.ok(hit.messageId);
  assert.ok(!Number.isNaN(Date.parse(hit.createdAt)));
  assert.ok(
    hit.snippet.includes(`${MESSAGE_SEARCH_MATCH_OPEN}idempotent${MESSAGE_SEARCH_MATCH_CLOSE}`),
    'the matched term is wrapped in the contract markers'
  );

  // The last term is a prefix, so results appear before the word is finished.
  assert.equal(conversations.searchMessages({ query: 'idempot' }).length, 1);
});

test('search ranks by relevance and caps the result set', (t) => {
  const { database } = makeDatabase(t, 'search-rank');
  const conversations = new ConversationsRepo(database);
  const conversation = conversations.create();

  const mention = (content: string) =>
    conversations.addMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content,
      status: 'complete',
      providerId: 'openrouter',
      modelId: 'openrouter/test-model',
    });

  mention('archive mentioned once, padded out with a good deal of unrelated prose '.padEnd(400, 'x '));
  const dense = mention('archive archive archive');

  const hits = conversations.searchMessages({ query: 'archive' });
  assert.equal(hits[0]?.messageId, dense, 'the denser match ranks first');

  for (let index = 0; index < 5; index += 1) {
    mention(`archive number ${index}`);
  }

  assert.equal(conversations.searchMessages({ query: 'archive', limit: 3 }).length, 3);
  // Out-of-range limits are clamped rather than trusted.
  assert.ok(conversations.searchMessages({ query: 'archive', limit: 10_000 }).length <= 100);
  assert.equal(conversations.searchMessages({ query: 'archive', limit: 0 }).length, 1);
});

test('search respects archiving unless it is asked not to', (t) => {
  const { database } = makeDatabase(t, 'search-archived');
  const conversations = new ConversationsRepo(database);
  const { live, archived } = seed(conversations);

  const visible = conversations.searchMessages({ query: 'idempotent' });
  assert.deepEqual(
    [...new Set(visible.map((hit) => hit.conversationId))],
    [live.id],
    'an archived chat is out of sight here too'
  );

  const all = conversations.searchMessages({ query: 'idempotent', includeArchived: true });
  const archivedHit = all.find((hit) => hit.conversationId === archived.id);
  assert.ok(archivedHit, 'opting in surfaces it');
  assert.equal(archivedHit?.archived, true, 'and it says so, so a result row can mark itself');
});

test('a query is sanitized, never handed to FTS5 as written', (t) => {
  const { database } = makeDatabase(t, 'search-sanitize');
  const conversations = new ConversationsRepo(database);
  seed(conversations);

  // Each of these is a syntax error as a raw FTS5 expression.
  const nasty = [
    'idempotent"',
    '"idempotent',
    'idempotent OR',
    'NEAR(idempotent',
    '*',
    '***',
    'idempotent AND NOT',
    '(idempotent',
    'migration NEAR/2 reopen',
    '^idempotent',
    'idempotent -',
    '""""',
    '\\',
  ];

  for (const query of nasty) {
    assert.doesNotThrow(() => conversations.searchMessages({ query }), `query: ${query}`);
  }

  // Punctuation-only input asks for nothing, so it returns nothing rather than
  // matching everything.
  assert.deepEqual(conversations.searchMessages({ query: '*' }), []);
  assert.equal(toFtsMatchExpression('   '), null);

  // Operators survive as literal words: every term is quoted, so `NEAR` is the
  // word "near" and the digits are a term of their own — nothing is an operator
  // the user did not type as text.
  assert.equal(
    toFtsMatchExpression('migration NEAR/2 reopen'),
    '"migration" AND "NEAR" AND "2" AND "reopen"*'
  );
  assert.equal(toFtsMatchExpression('near migration'), '"near" AND "migration"*');
  assert.equal(conversations.searchMessages({ query: 'migration reopen' }).length, 1);
});

test('the LIKE fallback stands in for a SQLite without FTS5', (t) => {
  const { database, raw } = makeDatabase(t, 'search-fallback');
  const conversations = new ConversationsRepo(database);
  const { live, archived } = seed(conversations);

  const request: SearchMessagesRequest = { query: 'idempotent' };
  const indexed = conversations.searchMessages(request);

  removeSearchIndex(raw);

  // A fresh repo, so nothing is remembered from the indexed run.
  const fallbackRepo = new MessageSearchRepo(database);
  assert.equal(fallbackRepo.hasSearchIndex(), false);

  const fallback = fallbackRepo.search(request);
  assert.deepEqual(
    fallback.map((hit) => hit.conversationId),
    indexed.map((hit) => hit.conversationId),
    'the same conversation comes back for a simple query'
  );
  assert.ok(
    fallback[0]?.snippet.includes(`${MESSAGE_SEARCH_MATCH_OPEN}idempotent${MESSAGE_SEARCH_MATCH_CLOSE}`),
    'and the snippet is marked up the same way, so a renderer cannot tell which path ran'
  );

  // Every guarantee the indexed path makes has to hold here too.
  assert.equal(fallbackRepo.search({ query: 'idempotent', includeArchived: true }).length, 2);
  assert.equal(fallbackRepo.search({ query: 'idempotent', limit: 1 }).length, 1);
  assert.deepEqual(fallbackRepo.search({ query: '***' }), []);
  for (const query of ['idempotent"', '100%', 'a_b', '\\', 'NEAR(']) {
    assert.doesNotThrow(() => fallbackRepo.search({ query }), `query: ${query}`);
  }

  // A LIKE wildcard typed by the user is never a pattern: it does not even
  // survive tokenizing, so a bare one asks for nothing at all.
  assert.deepEqual(fallbackRepo.search({ query: '%' }), []);

  assert.ok(archived.id);
  assert.ok(live.id);
});

test('the app still boots and search still works when the index cannot be built', (t) => {
  const { database, raw } = makeDatabase(t, 'search-no-fts');
  const conversations = new ConversationsRepo(database);
  seed(conversations);

  removeSearchIndex(raw);

  // Re-applying the schema over a database that has no index must not throw,
  // and messages must still be writable — a schema step that fails on boot is
  // an app that will not start.
  assert.doesNotThrow(() => applySchema(database));
  assert.doesNotThrow(() =>
    conversations.addMessage({
      conversationId: conversations.list()[0]!.id,
      role: 'user',
      content: 'written with no index in place',
      status: 'complete',
      providerId: 'openrouter',
      modelId: 'openrouter/test-model',
    })
  );

  assert.equal(conversations.searchMessages({ query: 'idempotent' }).length, 1);
});

test('the index tracks message edits and deletes', (t) => {
  const { database } = makeDatabase(t, 'search-sync');
  const conversations = new ConversationsRepo(database);
  const conversation = conversations.create();

  const messageId = conversations.addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    // Assistant rows are inserted empty and filled in as the turn streams, so
    // the update path — not the insert — is what has to index them.
    content: '',
    status: 'streaming',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
  });

  conversations.updateMessage({ messageId, content: 'the tokenizer stems nothing, deliberately' });
  assert.equal(conversations.searchMessages({ query: 'tokenizer' }).length, 1);

  // A status-only update leaves the text alone and must not disturb the index.
  conversations.updateMessage({ messageId, status: 'complete' });
  assert.equal(conversations.searchMessages({ query: 'tokenizer' }).length, 1);

  conversations.updateMessage({ messageId, content: 'rewritten to say something else' });
  assert.equal(conversations.searchMessages({ query: 'tokenizer' }).length, 0);
  assert.equal(conversations.searchMessages({ query: 'rewritten' }).length, 1);

  conversations.delete(conversation.id);
  assert.equal(conversations.searchMessages({ query: 'rewritten' }).length, 0);
});

test('the search index migration is idempotent across reopen', (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-search-migration-'));
  const path = join(tempDir, 'atlas.db');
  const raw = new DatabaseSync(path);

  t.after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Messages written before the index existed have to be found by the backfill,
  // not just the ones written after it.
  raw.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      default_provider_id TEXT,
      default_model_id TEXT
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    INSERT INTO conversations (id, title, created_at, updated_at)
    VALUES ('legacy', 'Older chat', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

    INSERT INTO messages (id, conversation_id, role, content, status, created_at)
    VALUES ('m-legacy', 'legacy', 'user', 'written long before the search index existed', 'complete', '2026-01-01T00:00:00.000Z');
  `);

  const database = wrap(raw);
  applySchema(database);
  applySchema(database);

  const conversations = new ConversationsRepo(database);
  assert.equal(conversations.searchMessages({ query: 'search index' }).length, 1);

  raw.close();

  const reopened = new DatabaseSync(path);
  t.after(() => reopened.close());
  assert.doesNotThrow(() => applySchema(wrap(reopened)));

  assert.equal(new ConversationsRepo(wrap(reopened)).searchMessages({ query: 'search index' }).length, 1);
});
