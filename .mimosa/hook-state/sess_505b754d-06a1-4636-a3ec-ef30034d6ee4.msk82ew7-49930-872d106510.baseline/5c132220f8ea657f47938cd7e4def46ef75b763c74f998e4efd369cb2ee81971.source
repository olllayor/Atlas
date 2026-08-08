import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import { WorkspaceCheckpointsRepo } from '../src/main/db/repositories/workspaceCheckpointsRepo.js';
import { applySchema } from '../src/main/db/schema.js';

function createDatabase(prefix: string) {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
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
      }
  } as unknown as SqliteDatabase;

  applySchema(database);
  return { raw, database, tempDir };
}

function setup(t: { after: (fn: () => void) => void }) {
  const { raw, database, tempDir } = createDatabase('atlas-checkpoints-repo-');
  const conversations = new ConversationsRepo(database);
  const repo = new WorkspaceCheckpointsRepo(database);

  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  return { conversations, repo };
}

test('the first capture of a turn wins, so a retry cannot redefine the baseline', (t) => {
  const { conversations, repo } = setup(t);
  const conversation = conversations.create();

  repo.record({
    conversationId: conversation.id,
    turnId: 'turn-1',
    kind: 'pre',
    repoRoot: '/repo',
    commitSha: 'aaa',
    treeSha: 'tree-a',
    status: 'captured'
  });

  // What a stream retry or an approval resume would do.
  repo.record({
    conversationId: conversation.id,
    turnId: 'turn-1',
    kind: 'pre',
    repoRoot: '/repo',
    commitSha: 'bbb',
    treeSha: 'tree-b',
    status: 'captured'
  });

  const stored = repo.get('turn-1', 'pre');
  assert.equal(stored?.commitSha, 'aaa');
  assert.equal(repo.listForConversation(conversation.id).length, 1);
});

test('pre and post are separate rows for the same turn', (t) => {
  const { conversations, repo } = setup(t);
  const conversation = conversations.create();

  repo.record({
    conversationId: conversation.id,
    turnId: 'turn-1',
    kind: 'pre',
    repoRoot: '/repo',
    commitSha: 'aaa',
    status: 'captured'
  });
  repo.record({
    conversationId: conversation.id,
    turnId: 'turn-1',
    kind: 'post',
    repoRoot: '/repo',
    commitSha: 'bbb',
    status: 'captured'
  });

  const bounds = repo.getTurnBounds('turn-1');
  assert.equal(bounds.pre?.commitSha, 'aaa');
  assert.equal(bounds.post?.commitSha, 'bbb');
});

test('a skipped capture keeps its reason instead of vanishing', (t) => {
  const { conversations, repo } = setup(t);
  const conversation = conversations.create();

  const stored = repo.record({
    conversationId: conversation.id,
    turnId: 'turn-1',
    kind: 'pre',
    repoRoot: '',
    status: 'skipped',
    skipReason: '/tmp/notes is not a git repository.'
  });

  assert.equal(stored?.status, 'skipped');
  assert.match(stored?.skipReason ?? '', /not a git repository/);
  assert.equal(stored?.commitSha, null);
});

test('conversation bounds span the first pre and the last post, ignoring undo points', (t) => {
  const { conversations, repo } = setup(t);
  const conversation = conversations.create();

  for (const [turn, pre, post] of [
    ['turn-1', 'a1', 'a2'],
    ['turn-2', 'b1', 'b2']
  ] as const) {
    repo.record({
      conversationId: conversation.id,
      turnId: turn,
      kind: 'pre',
      repoRoot: '/repo',
      commitSha: pre,
      status: 'captured'
    });
    repo.record({
      conversationId: conversation.id,
      turnId: turn,
      kind: 'post',
      repoRoot: '/repo',
      commitSha: post,
      status: 'captured'
    });
  }

  repo.record({
    conversationId: conversation.id,
    turnId: 'turn-2',
    kind: 'undo',
    repoRoot: '/repo',
    commitSha: 'undo-1',
    status: 'captured'
  });

  const bounds = repo.getConversationBounds(conversation.id);
  assert.equal(bounds.first?.commitSha, 'a1');
  assert.equal(bounds.last?.commitSha, 'b2', 'an undo must not become the conversation end');
});

test('a skipped row never becomes a diff endpoint', (t) => {
  const { conversations, repo } = setup(t);
  const conversation = conversations.create();

  repo.record({
    conversationId: conversation.id,
    turnId: 'turn-1',
    kind: 'pre',
    repoRoot: '',
    status: 'skipped',
    skipReason: 'No project folder is attached.'
  });

  assert.equal(repo.getConversationBounds(conversation.id).first, null);
});

test('deleting a conversation takes its checkpoints with it', (t) => {
  const { conversations, repo } = setup(t);
  const conversation = conversations.create();

  repo.record({
    conversationId: conversation.id,
    turnId: 'turn-1',
    kind: 'pre',
    repoRoot: '/repo',
    commitSha: 'aaa',
    refName: 'refs/atlas/checkpoints/x/turn-1/pre',
    status: 'captured'
  });

  const removed = repo.deleteForConversation(conversation.id);
  assert.equal(removed.length, 1);
  assert.equal(removed[0]?.refName, 'refs/atlas/checkpoints/x/turn-1/pre');
  assert.deepEqual(repo.listForConversation(conversation.id), []);
});
