import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { applySchema } from '../src/main/db/schema';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo';
import { SubagentContinuationManager } from '../src/main/ai/agents/SubagentContinuationManager';
import { enrichSubagentEntries, computeHasChildrenMap } from '../src/main/ai/agents/subagentProjections';

test('S4: hasChildren batched GROUP BY header-only', async () => {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  const child1 = convRepo.createSubagentConversation({ parentConversationId: parent.id, title: 'c1', delegationDepth: 0, agentId: 'a:0', mode: 'continuable', parentTurnId: 't1' });
  const child2 = convRepo.createSubagentConversation({ parentConversationId: parent.id, title: 'c2', delegationDepth: 0, agentId: 'a:1', mode: 'one-shot', parentTurnId: 't1' });
  // grandchild under child1
  convRepo.createSubagentConversation({ parentConversationId: child1, title: 'gc', delegationDepth: 1, agentId: 'a:2', mode: 'continuable', parentTurnId: 't1' });

  const children = convRepo.listSubagentChildren(parent.id);
  assert.equal(children.length, 2);
  const enriched = enrichSubagentEntries(children as any, convRepo as any);
  const c1 = enriched.find((e) => e.id === child1)!;
  const c2 = enriched.find((e) => e.id === child2)!;
  assert.equal(c1.hasChildren, true, 'child1 should haveChildren true');
  assert.equal(c2.hasChildren, false, 'child2 should haveChildren false');

  // computeHasChildrenMap directly
  const map = computeHasChildrenMap(convRepo as any, [child1, child2]);
  assert.equal(map.get(child1), true);
  assert.equal(map.get(child2), false);
});

test('S4: status reflects live manager state (running vs inactive)', async () => {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  const manager = new SubagentContinuationManager({
    conversationsRepo: convRepo as any,
    runtimeStateRepo: { recordEvent: (e: any) => ({ ...e, sequence: 1, occurredAt: new Date().toISOString() }) } as any,
    executeTurn: async ({ prompt, signal }: any) => {
      await new Promise((res, rej) => {
        const t = setTimeout(() => res(null), 300);
        signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }, { once: true });
      });
      return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any;
    },
  });
  const c = await manager.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', title: 'c', prompt: 'first', depth: 0 });
  // Immediately after start, should be running (processing)
  let enriched = enrichSubagentEntries(convRepo.listSubagentChildren(parent.id) as any, convRepo as any, manager as any);
  assert.equal(enriched[0].status, 'running');
  await manager.whenIdle(c.childId);
  enriched = enrichSubagentEntries(convRepo.listSubagentChildren(parent.id) as any, convRepo as any, manager as any);
  assert.equal(enriched[0].status, 'inactive');
});

test('S4: queued work counts as running even when parked mid-drain', async () => {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  const manager = new SubagentContinuationManager({
    conversationsRepo: convRepo as any,
    runtimeStateRepo: { recordEvent: (e: any) => ({ ...e, sequence: 1, occurredAt: new Date().toISOString() }) } as any,
    executeTurn: async ({ signal }: any) => {
      await new Promise((res, rej) => {
        const t = setTimeout(() => res(null), 500);
        signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }, { once: true });
      });
      return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any;
    },
  });
  const c = await manager.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', title: 'c', prompt: 'first', depth: 0 });
  await new Promise((r) => setTimeout(r, 20));
  await manager.followup(parent.id, c.childId, 'pending');
  manager.interrupt(c.childId); // parks; current turn aborts, queue keeps 'pending'
  await new Promise((r) => setTimeout(r, 60));
  const enriched = enrichSubagentEntries(convRepo.listSubagentChildren(parent.id) as any, convRepo as any, manager as any);
  assert.equal(manager.getActivation(c.childId)?.parked, true);
  assert.equal(enriched[0].status, 'running', 'parked child with queued work is not settled');
});

test('S4: ChatEngine listSubagents enriches via manager', async () => {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  // Mock ChatEngine listSubagents path: just test enrich directly via ChatEngine
  const { ChatEngine } = await import('../src/main/ai/core/ChatEngine');
  const fakeModelsRepo: any = { list: () => [], getById: () => null, getRuntimeHints: () => ({}) };
  const fakeKeychain: any = { getSecret: async () => 'sk' };
  const fakeProviders: any = new Map([['openrouter', {}]]);
  const fakeAttachmentStore: any = { deleteConversationAttachments: () => {}, readAttachmentData: () => null, copyAttachment: () => null };
  const engine: any = new ChatEngine(convRepo as any, fakeModelsRepo, fakeKeychain, fakeProviders, fakeAttachmentStore);
  const parent = convRepo.create({});
  const child = convRepo.createSubagentConversation({ parentConversationId: parent.id, title: 'c', delegationDepth: 0, agentId: 'a:0', mode: 'continuable', parentTurnId: 't1' });
  // No manager activation yet, so status inactive, hasChildren false
  let list = engine.listSubagents(parent.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].hasChildren, false);
  assert.equal(list[0].status, 'inactive');
  // Create a continuable activation via manager
  const start = await engine.continuations.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c2', title: 'c2', prompt: 'hi', depth: 0 });
  list = engine.listSubagents(parent.id);
  assert.equal(list.length, 2);
  const c2 = list.find((e: any) => e.id === start.childId)!;
  assert.equal(c2.status, 'running');
});

test('S4: timing reflects real turn start while processing, absent when idle', async () => {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  const manager = new SubagentContinuationManager({
    conversationsRepo: convRepo as any,
    runtimeStateRepo: { recordEvent: (e: any) => ({ ...e, sequence: 1, occurredAt: new Date().toISOString() }) } as any,
    executeTurn: async ({ signal }: any) => {
      await new Promise((res, rej) => {
        const t = setTimeout(() => res(null), 300);
        signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }, { once: true });
      });
      return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any;
    },
  });
  const c = await manager.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', title: 'c', prompt: 'first', depth: 0 });
  await new Promise((r) => setTimeout(r, 30));
  const { computeTiming } = await import('../src/main/ai/agents/subagentProjections');
  const before = Date.now();
  const live = computeTiming(c.childId, manager);
  assert.ok(live.active, 'mid-turn child must expose an active interval');
  // since must be the actual turn start, not the query time
  assert.ok(live.active!.since <= before - 10, `active.since should be turn start (got ${live.active!.since}, query at ${before})`);
  assert.ok(live.active!.through >= before);
  await manager.whenIdle(c.childId);
  const idle = computeTiming(c.childId, manager);
  assert.equal(idle.active, undefined, 'idle child has no open interval');
  assert.equal(idle.settledMs, 0);
});

test('S4: settledMs sums persisted assistant-turn latencies', async () => {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  const child1 = convRepo.createSubagentConversation({ parentConversationId: parent.id, title: 'c1', delegationDepth: 0, agentId: 'a:0', mode: 'continuable', parentTurnId: 't1' });
  const child2 = convRepo.createSubagentConversation({ parentConversationId: parent.id, title: 'c2', delegationDepth: 0, agentId: 'a:1', mode: 'one-shot', parentTurnId: 't1' });

  const insertMessage = db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, status, latency_ms, created_at) VALUES (?, ?, ?, '', 'complete', ?, ?)`
  );
  insertMessage.run('m1', child1, 'assistant', 1500, new Date().toISOString());
  insertMessage.run('m2', child1, 'assistant', 500, new Date().toISOString());
  // user rows and null-latency assistant rows must not count
  insertMessage.run('m3', child1, 'user', null as unknown as number, new Date().toISOString());
  insertMessage.run('m4', child2, 'assistant', null as unknown as number, new Date().toISOString());

  const enriched = enrichSubagentEntries(convRepo.listSubagentChildren(parent.id) as any, convRepo as any);
  const c1 = enriched.find((e) => e.id === child1)!;
  const c2 = enriched.find((e) => e.id === child2)!;
  assert.equal(c1.timing.settledMs, 2000);
  assert.equal(c2.timing.settledMs, 0);

  // Live turn overlays the open interval on top of the settled sum
  const manager = new SubagentContinuationManager({
    conversationsRepo: convRepo as any,
    executeTurn: async ({ signal }: any) => {
      await new Promise((res, rej) => {
        const t = setTimeout(() => res(null), 300);
        signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }, { once: true });
      });
      return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any;
    },
  });
  const liveStart = await manager.startContinuable({ parentConversationId: parent.id, parentTurnId: 't2', parentToolCallId: 'c9', title: 'c9', prompt: 'x', depth: 0 });
  await new Promise((r) => setTimeout(r, 30));
  const liveEnriched = enrichSubagentEntries(convRepo.listSubagentChildren(parent.id) as any, convRepo as any, manager as any);
  const live = liveEnriched.find((e) => e.id === liveStart.childId)!;
  assert.ok(live.timing.active, 'running child exposes active interval');
  assert.equal(liveEnriched.find((e) => e.id === child1)!.timing.settledMs, 2000, 'settled sum unaffected by another child running');
  await manager.whenIdle(liveStart.childId);
});
