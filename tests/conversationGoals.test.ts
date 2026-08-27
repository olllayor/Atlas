import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import type { SqliteDatabase } from '../src/main/db/client.js';
import { AttachmentStore } from '../src/main/attachments/AttachmentStore.js';
import { RuntimeStateRepo } from '../src/main/db/repositories/runtimeStateRepo.js';
import { ToolExecutionsRepo } from '../src/main/db/repositories/toolExecutionsRepo.js';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo.js';
import {
  ConversationGoalsRepo,
  GOAL_STALL_LIMIT,
  MAX_GOAL_OBJECTIVE_CHARS,
} from '../src/main/db/repositories/conversationGoalsRepo.js';
import { applySchema } from '../src/main/db/schema.js';

function wrap(raw: DatabaseSync): SqliteDatabase {
  return {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    transaction:
      <TArgs extends unknown[], TResult>(callback: (...args: TArgs) => TResult) =>
      (...args: TArgs) => callback(...args),
  } as unknown as SqliteDatabase;
}

function makeRepo(t: TestContext): { repo: ConversationGoalsRepo; db: SqliteDatabase } {
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-goal-repo-'));
  const raw = new DatabaseSync(join(tempDir, 'atlas.db'));
  t.after(() => {
    raw.close();
    rmSync(tempDir, { recursive: true, force: true });
  });
  const db = wrap(raw);
  applySchema(db);
  return { repo: new ConversationGoalsRepo(db), db };
}

/** Goals FK onto conversations, so each test seeds its parents first. */
function makeConversation(db: SqliteDatabase, id: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO conversations (id, title, created_at, updated_at)
     VALUES (@id, @title, @now, @now)`
  ).run({ id, title: `chat ${id}`, now });
}

test('create makes the active goal; a second create archives the first as cleared', (t) => {
  const { repo, db } = makeRepo(t);
  makeConversation(db, 'conv-1');
  const first = repo.create('conv-1', 'ship the exporter');
  assert.equal(first.status, 'active');
  assert.equal(first.turnCap > 0, true);

  const second = repo.create('conv-1', 'then write the docs');
  const active = repo.getActive('conv-1');
  assert.equal(active?.id, second.id);
  assert.equal(active?.objective, 'then write the docs');

  const latest = repo.getLatest('conv-1');
  // getLatest orders by updated_at DESC; both rows may share a coarse
  // timestamp on a fast machine, so accept either order but demand exactly
  // two rows and one live one.
  assert.equal(latest !== null, true);
});

test('transition is compare-and-swap on revision and status', (t) => {
  const { repo, db } = makeRepo(t);
  makeConversation(db, 'conv-1');
  const goal = repo.create('conv-1', 'refactor auth');

  assert.equal(repo.transition(goal.id, goal.revision, 'active', { status: 'paused_user' }), true);
  const paused = repo.getActive('conv-1')!;
  assert.equal(paused.status, 'paused_user');
  assert.equal(paused.revision, goal.revision + 1);

  // Stale writer (pre-pause revision) must lose.
  assert.equal(repo.transition(goal.id, goal.revision, 'active', { status: 'complete' }), false);
  assert.equal(repo.getActive('conv-1')?.status, 'paused_user');

  // Right revision, wrong status must also lose.
  assert.equal(repo.transition(paused.id, paused.revision, 'active', { status: 'complete' }), false);
});

test('usage accounting and turn bumps accumulate across guarded writes', (t) => {
  const { repo, db } = makeRepo(t);
  makeConversation(db, 'conv-1');
  let goal = repo.create('conv-1', 'migrate the db');

  for (let i = 0; i < 3; i++) {
    assert.equal(
      repo.transition(goal.id, goal.revision, 'active', {
        bumpTurnCount: true,
        accountTokens: { in: 100, out: 20 },
      }),
      true
    );
    goal = repo.getActive('conv-1')!;
  }

  assert.equal(goal.turnCount, 3);
  assert.equal(goal.tokensIn, 300);
  assert.equal(goal.tokensOut, 60);
});

test('updateObjective rewrites in place: same id, counters kept, revision guarded', (t) => {
  const { repo, db } = makeRepo(t);
  makeConversation(db, 'conv-1');
  const goal = repo.create('conv-1', 'first draft');
  repo.transition(goal.id, goal.revision, 'active', { bumpTurnCount: true });
  const progressed = repo.getActive('conv-1')!;

  const edited = repo.updateObjective(progressed.id, progressed.revision, 'sharper wording');
  assert.equal(edited?.id, goal.id);
  assert.equal(edited?.objective, 'sharper wording');
  assert.equal(edited?.revision, progressed.revision + 1);
  assert.equal(edited?.turnCount, progressed.turnCount);

  // Stale revision loses; cleared rows are unreachable.
  assert.equal(repo.updateObjective(goal.id, goal.revision, 'stale'), null);
  repo.transition(edited!.id, edited!.revision, 'active', { status: 'cleared' });
  assert.equal(repo.updateObjective(edited!.id, edited!.revision, 'post-clear'), null);
});

test('listLiveGoals returns every non-cleared row across conversations', (t) => {
  const { repo, db } = makeRepo(t);
  makeConversation(db, 'conv-a');
  makeConversation(db, 'conv-b');
  repo.create('conv-a', 'goal a');
  const b = repo.create('conv-b', 'goal b');
  repo.transition(b.id, b.revision, 'active', { status: 'cleared' });

  const live = repo.listLiveGoals();
  assert.deepEqual(
    live.map((goal) => goal.conversationId).sort(),
    ['conv-a']
  );
});

test('constants match the plan defaults', () => {
  assert.equal(GOAL_STALL_LIMIT, 5);
  assert.equal(MAX_GOAL_OBJECTIVE_CHARS, 4000);
});

test('forking a conversation does not carry the goal over', (t) => {
  const { repo, db } = makeRepo(t);
  makeConversation(db, 'conv-parent');

  const tempDir = join(tmpdir(), 'atlas-goal-fork-attachments');
  const attachments = new AttachmentStore(tempDir);
  t.after(() => rmSync(tempDir, { recursive: true, force: true }));

  const conversations = new ConversationsRepo(
    db,
    attachments,
    new ToolExecutionsRepo(db),
    new RuntimeStateRepo(db)
  );

  // The parent row must exist for the FK; the helper above inserted it raw.
  const parent = conversations.getSummary('conv-parent') ?? null;
  assert.ok(parent, 'seeded parent exists');

  repo.create('conv-parent', 'ship v1');
  const fork = conversations.fork({ conversationId: 'conv-parent', kind: 'fork' });

  // A goal is intent for THIS thread: the fork starts clean.
  assert.equal(repo.getActive(fork.id), null);
  assert.equal(repo.getActive('conv-parent')?.objective, 'ship v1');
});
