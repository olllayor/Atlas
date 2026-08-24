import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { applySchema } from '../src/main/db/schema';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo';
import { SubagentContinuationManager } from '../src/main/ai/agents/SubagentContinuationManager';

function makeManagerWithDb(executeImpl?: any) {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  const manager = new SubagentContinuationManager({
    conversationsRepo: convRepo as any,
    runtimeStateRepo: { recordEvent: (e: any) => ({ ...e, sequence: 1, occurredAt: new Date().toISOString() }) } as any,
    executeTurn: executeImpl ?? (async () => ({ messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any)),
  });
  return { db, convRepo, parent, manager };
}

test('S3: ownedChildren blocks parent settlement (park flag meets disposal ordering)', async () => {
  const { convRepo, parent, manager } = makeManagerWithDb(async ({ prompt, signal }: any) => {
    await new Promise((res, rej) => {
      const t = setTimeout(() => res(null), 200);
      signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }, { once: true });
    });
    return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any;
  });

  // Parent is itself a continuable (nested case)
  const parentAct = await manager.startContinuable({
    parentConversationId: parent.id,
    parentTurnId: 't0',
    parentToolCallId: 'root',
    title: 'parent-cont',
    prompt: 'parent prompt',
    depth: 0,
  });
  await new Promise((r) => setTimeout(r, 20)); // let parent start
  // Parent spawns child
  const child = await manager.startContinuable({
    parentConversationId: parentAct.childId,
    parentTurnId: 't1',
    parentToolCallId: 'c1',
    title: 'child',
    prompt: 'child prompt',
    depth: 1,
  });
  // Parent's Activation should now own child
  const parentActivation = manager.getActivation(parentAct.childId)!;
  assert.ok(parentActivation.ownedChildren.has(child.childId), 'parent should own child');

  // Interrupt child -> parks queue, child still owned
  manager.interrupt(child.childId);
  const childAct = manager.getActivation(child.childId)!;
  assert.equal(childAct.parked, true, 'child should be parked after interrupt');

  // Parent whenIdle should block while it owns a live (parked) child
  let parentIdle = false;
  const whenIdlePromise = manager.whenIdle(parentAct.childId).then(() => { parentIdle = true; });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(parentIdle, false, 'parent should not be idle while owning parked child');

  // Followup resumes child (unparks), then child will process and become idle, but still owned until evicted
  await manager.followup(parentAct.childId, child.childId, 'wake child');
  assert.equal(childAct.parked, false, 'followup should unpark');
  await manager.whenIdle(child.childId);
  // Child idle but still owned -> parent still not idle (ownedChildren still has child)
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(parentIdle, false, 'parent still waiting for owned child even after child idle');

  // Evict child child-first -> parent should be released
  manager.evict(child.childId);
  assert.equal(parentActivation.ownedChildren.has(child.childId), false, 'parent should no longer own evicted child');
  await whenIdlePromise;
  assert.equal(parentIdle, true, 'parent should be idle after child evicted');
});

test('S3: child error notices reach parent via drain', async () => {
  const { convRepo, parent, manager } = makeManagerWithDb(async ({ prompt }: any) => {
    if (prompt === 'failme') throw new Error('child exploded');
    return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any;
  });
  const child = await manager.startContinuable({
    parentConversationId: parent.id,
    parentTurnId: 't1',
    parentToolCallId: 'c1',
    title: 'child',
    prompt: 'failme',
    depth: 1,
  });
  await manager.whenIdle(child.childId);
  // Drain should have one notice for parent
  const notices = manager.drainCompletionNotices(parent.id);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].childId, child.childId);
  assert.match(notices[0].error, /child exploded/);
  // Second drain is exactly once
  assert.equal(manager.drainCompletionNotices(parent.id).length, 0);
});

test('S3: ChatEngine fallback model uses configured model not hardcoded', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync('src/main/ai/core/ChatEngine.ts', 'utf8');
  assert.match(src, /resolveFallbackModel/);
  // Both childExecutor and continuationManager should use the helper, not hardcode the model directly as primary fallback
  const countFallback = (src.match(/google\/gemini-2\.5-flash/g) || []).length;
  // After fix, only at most 1 fallback remains (the final 'unknown' fallback), not 2 hardcodes as primary
  assert.ok(countFallback <= 1, `expected at most 1 hardcoded fallback, got ${countFallback}`);
});

test('S3: park flag meets disposal ordering — child-first evict', async () => {
  const { convRepo, parent, manager } = makeManagerWithDb();
  const p = await manager.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', title: 'parent', prompt: 'p', depth: 0 });
  const c1 = await manager.startContinuable({ parentConversationId: p.childId, parentTurnId: 't1', parentToolCallId: 'c2', title: 'child1', prompt: 'c1', depth: 1 });
  const c2 = await manager.startContinuable({ parentConversationId: p.childId, parentTurnId: 't1', parentToolCallId: 'c3', title: 'child2', prompt: 'c2', depth: 1 });
  assert.equal(manager.getActivation(p.childId)!.ownedChildren.size, 2);
  // Evict parent should evict children first
  manager.evict(p.childId);
  assert.equal(manager.listActivations().length, 0, 'child-first eviction should remove all');
  assert.equal(manager.getActivation(c1.childId), undefined);
  assert.equal(manager.getActivation(c2.childId), undefined);
});

// ── S3 fix regressions ─────────────────────────────────────────────────────

test('fix: startContinuable rollback unlinks child from parent ownedChildren', async () => {
  const { convRepo, parent, manager } = makeManagerWithDb();
  // Parent itself continuable so the nested-link path runs
  const p = await manager.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'r', title: 'p', prompt: 'p', depth: 0 });
  // Break descriptor persistence: recordEvent throws
  (manager as any).deps.runtimeStateRepo = { recordEvent: () => { throw new Error('db gone'); } };
  await assert.rejects(() => manager.startContinuable({
    parentConversationId: p.childId, parentTurnId: 't2', parentToolCallId: 'c1', title: 'child', prompt: 'p', depth: 1,
  }), /db gone/);
  const parentAct = manager.getActivation(p.childId)!;
  assert.equal(parentAct.ownedChildren.size, 0, 'orphaned child id must not pin the parent in waiting forever');
});

test('fix: evict stops the process loop — no zombie turns after eviction', async () => {
  let turnCount = 0;
  let releaseTurn: (() => void) | undefined;
  const { convRepo, parent, manager } = makeManagerWithDb(async () => {
    turnCount += 1;
    await new Promise<void>((r) => { releaseTurn = r; });
    return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any;
  });
  const c = await manager.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', title: 'c', prompt: 'first', depth: 1 });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(turnCount >= 1);
  // Queue more work, then evict mid-turn.
  await manager.followup(parent.id, c.childId, 'queued');
  manager.evict(c.childId);
  releaseTurn?.();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(turnCount, 1, `evicted activation must run zero further turns (ran ${turnCount})`);
  assert.equal(manager.listActivations().length, 0);
});

test('fix: interruptAllForConversation cascades through owned descendants', async () => {
  const aborted: string[] = [];
  const { convRepo, parent, manager } = makeManagerWithDb(async ({ signal }: any) => {
    await new Promise((res, rej) => {
      const t = setTimeout(() => res(null), 5000);
      signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }, { once: true });
    });
    return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any;
  });
  void convRepo;
  const root = await manager.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'r', title: 'root-child', prompt: 'p', depth: 0 });
  await new Promise((r) => setTimeout(r, 20));
  const mid = await manager.startContinuable({ parentConversationId: root.childId, parentTurnId: 't2', parentToolCallId: 'm', title: 'mid', prompt: 'p', depth: 1 });
  const leaf = await manager.startContinuable({ parentConversationId: mid.childId, parentTurnId: 't3', parentToolCallId: 'l', title: 'leaf', prompt: 'p', depth: 2 });
  for (const id of [root.childId, mid.childId, leaf.childId]) {
    const act = manager.getActivation(id)!;
    if (act.currentController) {
      act.currentController.signal.addEventListener('abort', () => aborted.push(id), { once: true });
    }
  }
  const n = manager.interruptAllForConversation(parent.id);
  assert.equal(n, 3, 'the whole owned tree (root + mid + leaf) is interrupted and counted');
  assert.deepEqual(aborted.sort(), [leaf.childId, mid.childId, root.childId].sort(), 'whole owned tree must be interrupted');
  for (const id of [root.childId, mid.childId, leaf.childId]) {
    assert.equal(manager.getActivation(id)!.parked, true);
  }
});

test('fix: evictForConversation evicts tree and drops undrained notices', async () => {
  const { convRepo, parent, manager } = makeManagerWithDb(async ({ prompt }: any) => {
    if (prompt === 'failme') throw new Error('boom');
    return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any;
  });
  const failing = await manager.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'f', title: 'failer', prompt: 'failme', depth: 1 });
  await manager.whenIdle(failing.childId);
  assert.equal(manager.drainCompletionNotices(parent.id).length, 1); // sanity: notice exists
  // Generate a fresh undrained notice, then delete the conversation without draining it.
  const c2 = await manager.startContinuable({ parentConversationId: parent.id, parentTurnId: 't2', parentToolCallId: 'g', title: 'failer2', prompt: 'failme', depth: 1 });
  void c2;
  await manager.whenIdle(manager.listActivations()[0]);
  const nested = await manager.startContinuable({ parentConversationId: failing.childId, parentTurnId: 't3', parentToolCallId: 'n', title: 'nested', prompt: 'ok', depth: 2 });
  const evicted = manager.evictForConversation(parent.id);
  assert.equal(evicted, 2, 'direct children only (nested evicted recursively)');
  assert.equal(manager.listActivations().length, 0, 'nested activation must be gone too');
  assert.equal(manager.drainCompletionNotices(parent.id).length, 0, 'undrained notices dropped with owner');
});
