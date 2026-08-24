import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { applySchema } from '../src/main/db/schema';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo';
import { SubagentRuntime } from '../src/main/ai/agents/SubagentRuntime';
import { SubagentContinuationManager } from '../src/main/ai/agents/SubagentContinuationManager';

function makeDbWithManager(executeImpl?: any) {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  const manager = new SubagentContinuationManager({
    conversationsRepo: convRepo as any,
    runtimeStateRepo: { recordEvent: (e: any) => ({ ...e, sequence: 1, occurredAt: new Date().toISOString() }) } as any,
    executeTurn: executeImpl ?? (async ({ prompt }: any) => {
      return { messageId: 'm', status: 'completed', parts: [{ type: 'text', text: `reply:${prompt}` }], responseMessages: [], pendingApprovals: [] } as any;
    }),
  });
  const runtime = new SubagentRuntime({
    runtimeStateRepo: { recordEvent: (e: any) => ({ ...e, sequence: 1, occurredAt: new Date().toISOString() }) } as any,
    createChildConversation: (input: any) => convRepo.createSubagentConversation(input),
    deleteChildConversation: (id: string) => convRepo.delete(id),
    continuationManager: manager as any,
    childExecutor: async () => ({ content: 'should not be called for continuable' } as any),
  });
  return { db, convRepo, parent, manager, runtime };
}

test('S2: SubagentRuntime background:true with manager creates continuable', async () => {
  const { convRepo, parent, manager, runtime } = makeDbWithManager();
  const res = await runtime.spawn({
    conversationId: parent.id,
    parentTurnId: 't1',
    parentToolCallId: 'c1',
    title: 'cont',
    prompt: 'hello',
    background: true,
    depth: 0,
  });
  assert.equal(res.status, 'pending');
  assert.ok(res.childConversationId);
  const children = convRepo.listSubagentChildren(parent.id);
  assert.equal(children.length, 1);
  assert.equal(children[0].mode, 'continuable');
  assert.equal(manager.listActivations().length, 1);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(manager.getActivation(res.childConversationId!)?.queue.length, 0);
});

test('S2: inline background:false still creates one-shot via Task', async () => {
  const { convRepo, parent, manager, runtime } = makeDbWithManager();
  const res = await runtime.spawn({
    conversationId: parent.id,
    parentTurnId: 't1',
    parentToolCallId: 'c2',
    title: 'inline',
    prompt: 'hi',
    background: false,
    depth: 0,
  });
  assert.equal(res.status, 'completed');
  const children = convRepo.listSubagentChildren(parent.id);
  assert.equal(children[0].mode, 'one-shot');
  assert.equal(manager.listActivations().length, 0);
});

test('S2: manager followup FIFO and cold resume', async () => {
  const order: string[] = [];
  const { convRepo, parent, manager } = makeDbWithManager(async ({ prompt }: any) => {
    order.push(prompt);
    await new Promise((r) => setTimeout(r, 30));
    return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any;
  });
  const start = await manager.startContinuable({
    parentConversationId: parent.id,
    parentTurnId: 't1',
    parentToolCallId: 'c1',
    title: 'c',
    prompt: 'first',
    depth: 1,
  });
  const p1 = manager.followup(parent.id, start.childId, 'a');
  const p2 = manager.followup(parent.id, start.childId, 'b');
  const [id1, id2] = await Promise.all([p1, p2]);
  assert.ok(id1);
  assert.ok(id2);
  await manager.whenIdle(start.childId);
  assert.deepEqual(order, ['first', 'a', 'b']);
});

test('S2: manager bounded inbox and interrupt', async () => {
  const { convRepo, parent, manager } = makeDbWithManager(async ({ prompt, signal }: any) => {
    await new Promise((res, rej) => {
      const t = setTimeout(() => res(null), 500);
      signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }, { once: true });
    });
    return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any;
  });
  const start = await manager.startContinuable({
    parentConversationId: parent.id,
    parentTurnId: 't1',
    parentToolCallId: 'c1',
    title: 'c',
    prompt: 'first',
    depth: 1,
  });
  await new Promise((r) => setTimeout(r, 20));
  // fill inbox (first turn still running, so queue holds pending)
  for (let i = 0; i < 10; i++) await manager.followup(parent.id, start.childId, `msg${i}`);
  await assert.rejects(() => manager.followup(parent.id, start.childId, 'overflow'), /inbox full/);
  const before = manager.getActivation(start.childId)?.queue.length;
  // queue holds pending; current turn is not counted. May be 10 (if first still running) or 9 if first just finished and dequeued one.
  assert.ok(before !== undefined && before >= 9 && before <= 10, `expected queue ~10, got ${before}`);
  manager.interrupt(start.childId);
  await new Promise((r) => setTimeout(r, 100));
  // after interrupt, queue should still be parked, not discarded (allow 9-10)
  const after = manager.getActivation(start.childId)?.queue.length;
  assert.ok(after !== undefined && after >= 9 && after <= 10, `expected parked queue ~10, got ${after}`);
});

test('S2: cold resume after manager restart', async () => {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  const makeMgr = (log: string[]) => new SubagentContinuationManager({
    conversationsRepo: convRepo as any,
    runtimeStateRepo: { recordEvent: (e: any) => ({ ...e, sequence: 1, occurredAt: new Date().toISOString() }) } as any,
    executeTurn: async ({ prompt }: any) => { log.push(prompt); return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any; },
  });
  const log1: string[] = [];
  const m1 = makeMgr(log1);
  const start = await m1.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', title: 'c', prompt: 'first', depth: 1 });
  await m1.whenIdle(start.childId);
  const log2: string[] = [];
  const m2 = makeMgr(log2);
  await m2.followup(parent.id, start.childId, 'second');
  await m2.whenIdle(start.childId);
  assert.deepEqual(log2, ['second']);
});

test('S2: SubagentRuntime + manager integration via send_message tool', async () => {
  // Verify that the model-facing control tools are wired via builtInTools
  const { convRepo, parent } = (() => {
    const db = new Database(':memory:');
    applySchema(db);
    const cr = new ConversationsRepo(db);
    const p = cr.create({});
    return { convRepo: cr, parent: p };
  })();
  // We test the control tools directly
  const { createSubagentControlTools } = await import('../src/main/ai/tools/subagentControlTools');
  const manager = new SubagentContinuationManager({
    conversationsRepo: convRepo as any,
    runtimeStateRepo: { recordEvent: (e: any) => ({ ...e, sequence: 1, occurredAt: new Date().toISOString() }) } as any,
    executeTurn: async () => ({ messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any),
  });
  const start = await manager.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', title: 'c', prompt: 'first', depth: 1 });
  const tools: any = createSubagentControlTools(manager as any, { conversationId: parent.id });
  const res = await tools.send_message.execute({ subagent_id: start.childId, message: 'hello' }, {}) as any;
  assert.ok(res.messageId);
  const list = await tools.list_agents.execute({}, {}) as any;
  assert.equal(list.agents.length, 1);
  const intr = await tools.interrupt_agent.execute({ agent_id: start.childId }, {}) as any;
  assert.deepEqual(intr, { accepted: true });
});

// ── S2 fix regressions ─────────────────────────────────────────────────────

function captureEvents() {
  const events: any[] = [];
  return { events, repo: { recordEvent: (e: any) => { events.push(e); return { ...e, sequence: events.length, occurredAt: new Date().toISOString() }; } } as any };
}

test('fix: agentIndex keeps agentIds distinct across a fan-out batch', async () => {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  const cap = captureEvents();
  const manager = new SubagentContinuationManager({
    conversationsRepo: convRepo as any,
    runtimeStateRepo: cap.repo,
    executeTurn: async () => ({ messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any),
  });
  await manager.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', agentIndex: 0, title: 'a', prompt: 'p', depth: 1 });
  await manager.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', agentIndex: 1, title: 'b', prompt: 'p', depth: 1 });
  const agentIds = cap.events.filter((e) => e.activityType === 'subagent.descriptor').map((e) => e.payload.subagentDescriptor.agentId);
  assert.deepEqual(new Set(agentIds).size, 2, `expected distinct agentIds, got ${JSON.stringify(agentIds)}`);
});

test('fix: interrupt parks the queue — no auto-run until a waking send', async () => {
  let started = 0;
  const { parent, manager } = (() => {
    const db = new Database(':memory:');
    applySchema(db);
    const cr = new ConversationsRepo(db);
    const p = cr.create({});
    const m = new SubagentContinuationManager({
      conversationsRepo: cr as any,
      runtimeStateRepo: { recordEvent: (e: any) => e } as any,
      executeTurn: async ({ signal }: any) => {
        started += 1;
        await new Promise((res, rej) => {
          const t = setTimeout(() => res(null), 500);
          signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }, { once: true });
        });
        return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any;
      },
    });
    return { parent: p, manager: m };
  })();
  const start = await manager.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', title: 'c', prompt: 'first', depth: 1 });
  await new Promise((r) => setTimeout(r, 20));
  await manager.followup(parent.id, start.childId, 'queued-1');
  manager.interrupt(start.childId);
  await new Promise((r) => setTimeout(r, 80));
  // Parked: the queued message must NOT auto-start after the abort.
  assert.equal(started, 1, 'parked queue must not auto-run');
  assert.equal(manager.getActivation(start.childId)?.queue.length, 1);
  assert.equal(manager.getActivation(start.childId)?.parked, true);
  // Waking send unparks and drains.
  await manager.followup(parent.id, start.childId, 'wake');
  await manager.whenIdle(start.childId);
  assert.equal(started, 3, 'waking send should resume parked queue (queued-1 + wake)');
});

test('fix: interruptForParent fences by parent conversation', async () => {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parentA = convRepo.create({});
  const parentB = convRepo.create({});
  const manager = new SubagentContinuationManager({
    conversationsRepo: convRepo as any,
    runtimeStateRepo: { recordEvent: (e: any) => e } as any,
    executeTurn: async () => ({ messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any),
  });
  const start = await manager.startContinuable({ parentConversationId: parentA.id, parentTurnId: 't1', parentToolCallId: 'c1', title: 'c', prompt: 'p', depth: 1 });
  assert.equal(await manager.interruptForParent(parentB.id, start.childId), undefined, 'foreign parent must be rejected');
  assert.deepEqual(await manager.interruptForParent(parentA.id, start.childId), { accepted: true });
  assert.equal(await manager.interruptForParent(parentA.id, 'nope'), undefined, 'unknown child is a no-op');
});

test('fix: followup turns carry durable depth and captured model/tools', async () => {
  const seen: any[] = [];
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  const manager = new SubagentContinuationManager({
    conversationsRepo: convRepo as any,
    runtimeStateRepo: { recordEvent: (e: any) => e } as any,
    executeTurn: async (input: any) => {
      seen.push({ depth: input.depth, model: input.model, tools: input.tools });
      return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any;
    },
  });
  const start = await manager.startContinuable({
    parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1',
    title: 'c', prompt: 'first', depth: 2, model: 'anthropic/claude-sonnet-4', tools: ['read_file'], agentIndex: 3,
  });
  await manager.followup(parent.id, start.childId, 'second');
  await manager.whenIdle(start.childId);
  assert.ok(seen.length >= 2, `expected both turns to run, got ${seen.length}`);
  for (const turn of seen) {
    assert.equal(turn.depth, 2, 'depth must stay at durable child depth, never reset to 0');
    assert.equal(turn.model, 'anthropic/claude-sonnet-4', 'model override must reach every turn');
    assert.deepEqual(turn.tools, ['read_file']);
  }
});

test('fix: cold resume restores persisted depth floor', async () => {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  const makeMgr = (log: any[]) => new SubagentContinuationManager({
    conversationsRepo: convRepo as any,
    runtimeStateRepo: { recordEvent: (e: any) => e } as any,
    executeTurn: async (input: any) => { log.push(input.depth); return { messageId: 'm', status: 'completed', parts: [], responseMessages: [], pendingApprovals: [] } as any; },
  });
  const m1 = makeMgr([]);
  const start = await m1.startContinuable({ parentConversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', title: 'c', prompt: 'first', depth: 2 });
  await m1.whenIdle(start.childId);
  const log2: any[] = [];
  const m2 = makeMgr(log2);
  await m2.followup(parent.id, start.childId, 'second');
  await m2.whenIdle(start.childId);
  assert.deepEqual(log2, [2], 'cold-resumed child must keep its persisted depth, not restart at 0');
});

test('fix: clearConversationBackground resolves for continuable records (no deadlock)', async () => {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  const manager = new SubagentContinuationManager({
    conversationsRepo: convRepo as any,
    runtimeStateRepo: { recordEvent: (e: any) => e } as any,
    executeTurn: async () => new Promise(() => {}), // never settles
  });
  const runtime = new SubagentRuntime({
    createChildConversation: (input: any) => convRepo.createSubagentConversation(input),
    deleteChildConversation: (id: string) => convRepo.delete(id),
    continuationManager: manager as any,
  });
  await runtime.spawn({ conversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', title: 'cont', prompt: 'p', background: true, depth: 0 });
  const cleared = await Promise.race([
    runtime.clearConversationBackground(parent.id),
    new Promise<'hang'>((r) => setTimeout(() => r('hang'), 500)),
  ]);
  assert.notEqual(cleared, 'hang', 'clear must not await the never-settling continuable donePromise');
  assert.equal(cleared, 1);
});
