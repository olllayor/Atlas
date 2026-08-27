import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import { AttachmentStore } from '../src/main/attachments/AttachmentStore.js';
import type { SqliteDatabase } from '../src/main/db/client.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { FileChangesRepo } from '../src/main/db/repositories/fileChangesRepo.js';
import { RuntimeStateRepo } from '../src/main/db/repositories/runtimeStateRepo.js';
import { ToolExecutionsRepo } from '../src/main/db/repositories/toolExecutionsRepo.js';
import { applySchema } from '../src/main/db/schema.js';

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

function makeHarness(t: TestContext) {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-side-chat-'));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const db = wrap(raw);
  applySchema(db);

  const attachments = new AttachmentStore(join(tempDir, 'attachments'));
  return new ConversationsRepo(
    db,
    attachments,
    new ToolExecutionsRepo(db),
    new RuntimeStateRepo(db)
  );
}

test('a side chat is hidden until promoted, then joins the listing', (t) => {
  const repo = makeHarness(t);
  const parent = repo.create({});
  assert.equal(repo.list().some((conversation) => conversation.id === parent.id), true);

  const side = repo.fork({ conversationId: parent.id, kind: 'side' });
  // Hidden everywhere except the dedicated side listing.
  assert.equal(repo.list().some((conversation) => conversation.id === side.id), false);
  assert.deepEqual(
    repo.listSideConversations(parent.id).map((conversation) => conversation.id),
    [side.id]
  );

  assert.equal(repo.promoteSideConversation(side.id), true);
  assert.equal(repo.list().some((conversation) => conversation.id === side.id), true);
  assert.equal(repo.listSideConversations(parent.id).length, 0);
});

test('promoting twice reports false the second time', (t) => {
  const repo = makeHarness(t);
  const parent = repo.create({});
  const side = repo.fork({ conversationId: parent.id, kind: 'side' });
  assert.equal(repo.promoteSideConversation(side.id), true);
  assert.equal(repo.promoteSideConversation(side.id), false);
});

test('subagent rows share the link column but can never be promoted', (t) => {
  const repo = makeHarness(t);
  const parent = repo.create({});
  const childId = repo.createSubagentConversation({
    parentConversationId: parent.id,
    title: 'worker',
    delegationDepth: 1,
    agentId: 'agent-1',
    mode: 'one-shot',
  });

  assert.equal(repo.promoteSideConversation(childId), false);
  assert.equal(repo.list().some((conversation) => conversation.id === childId), false);
});
