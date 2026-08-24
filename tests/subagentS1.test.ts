import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { applySchema } from '../src/main/db/schema';
import { ConversationsRepo } from '../src/main/db/repositories/conversationsRepo';
import { SubagentRuntime } from '../src/main/ai/agents/SubagentRuntime';
import {
  snapshotSubagentDescriptor,
  parseSubagentDescriptor,
  foldSubagentDescriptor,
  SUBAGENT_DESCRIPTOR_VERSION,
} from '../src/main/ai/agents/subagentDescriptor';
import { validateSpawnRequest, CHILD_STEP_LIMIT } from '../src/main/ai/agents/subagentCapabilities';

// ── descriptor ────────────────────────────────────────────────────────────

test('descriptor snapshot detaches and validates required fields', () => {
  const d = snapshotSubagentDescriptor({
    mode: 'one-shot',
    provider: 'atlas-turn-executor',
    label: 'test',
    agentId: 'a:0',
    parentConversationId: 'p1',
    delegationDepth: 1,
  });
  assert.equal(d.version, SUBAGENT_DESCRIPTOR_VERSION);
  assert.equal(d.mode, 'one-shot');
  // detachment: mutating input does not affect snapshot
  const input: any = { mode: 'one-shot', provider: 'x', label: 'y', agentId: 'a:1', parentConversationId: 'p', delegationDepth: 0 };
  const snap = snapshotSubagentDescriptor(input);
  input.label = 'mutated';
  assert.equal(snap.label, 'y');
});

test('descriptor parse rejects unknown keys and bad version', () => {
  const base = snapshotSubagentDescriptor({
    mode: 'one-shot', provider: 'p', label: 'l', agentId: 'a:0', parentConversationId: 'p1', delegationDepth: 0,
  });
  assert.throws(() => parseSubagentDescriptor({ ...base, extra: 1 } as any), /unknown field/);
  assert.throws(() => parseSubagentDescriptor({ ...base, version: 999 } as any), /unsupported/);
  assert.throws(() => parseSubagentDescriptor({ ...base, version: '1' } as any), /must be a number/);
});

test('descriptor future version is diagnostic not crash in fold', () => {
  const good = snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'p', label: 'l', agentId: 'a:0', parentConversationId: 'p', delegationDepth: 0 });
  const future = { ...good, version: 999 };
  const events: any[] = [
    { activityType: 'subagent.descriptor', payload: { subagentDescriptor: good } },
    { activityType: 'subagent.descriptor', payload: { subagentDescriptor: future } },
  ];
  const folded = foldSubagentDescriptor(events);
  // future throws -> fold resets to undefined per harness rule
  assert.equal(folded, undefined);
});

test('foldSubagentDescriptor last-wins', () => {
  const d1 = snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'p', label: 'first', agentId: 'a:0', parentConversationId: 'p', delegationDepth: 0 });
  const d2 = snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'p', label: 'second', agentId: 'a:0', parentConversationId: 'p', delegationDepth: 0 });
  const events: any[] = [
    { activityType: 'subagent.descriptor', payload: { subagentDescriptor: d1 } },
    { activityType: 'subagent.descriptor', payload: { subagentDescriptor: d2 } },
  ];
  const folded = foldSubagentDescriptor(events);
  assert.equal(folded?.label, 'second');
});

// ── capability validation ─────────────────────────────────────────────────

test('validateSpawnRequest covers depth, background, maxSteps', () => {
  const caps = { provider: 'x', maxDepth: 3, maxConcurrent: 4, supportsBackground: true, stepLimit: CHILD_STEP_LIMIT };
  assert.equal(validateSpawnRequest(caps, { depth: 0 }).length, 0);
  assert.equal(validateSpawnRequest(caps, { depth: 4 })[0].code, 'depth-exceeded');
  assert.equal(validateSpawnRequest({ ...caps, supportsBackground: false }, { background: true })[0].code, 'background-unsupported');
  assert.equal(validateSpawnRequest(caps, { maxSteps: 0 })[0].code, 'max-steps-out-of-range');
  assert.equal(validateSpawnRequest(caps, { maxSteps: 100 })[0].code, 'max-steps-out-of-range');
  // multiple violations returned together
  const multi = validateSpawnRequest({ ...caps, supportsBackground: false }, { depth: 4, background: true, maxSteps: 0 });
  assert.equal(multi.length, 3);
});

// ── background surfaces ───────────────────────────────────────────────────

function makeRuntimeWithDb(opts: { maxConcurrent?: number, childExecutor?: any } = {}) {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  const events: any[] = [];
  const runtimeRepo = { recordEvent: (e: any) => { events.push(e); return { ...e, sequence: events.length, occurredAt: new Date().toISOString() }; } };
  const runtime = new SubagentRuntime({
    runtimeStateRepo: runtimeRepo as any,
    createChildConversation: (input: any) => convRepo.createSubagentConversation(input),
    deleteChildConversation: (id: string) => convRepo.delete(id),
    childExecutor: opts.childExecutor ?? (async ({ prompt }: any) => ({ content: 'done ' + prompt })),
    maxConcurrent: opts.maxConcurrent,
  });
  return { db, convRepo, parent, runtime, events };
}

test('S1: spawn creates durable child conversation with one-shot mode (not continuable) even when background:true', async () => {
  const { convRepo, parent, runtime, events } = makeRuntimeWithDb();
  const res = await runtime.spawn({
    conversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'call-bg', title: 'bg child', prompt: 'hi', background: true, depth: 0,
  });
  // background returns pending immediately but child row should exist
  assert.equal(res.childConversationId != null, true);
  const children = convRepo.listSubagentChildren(parent.id);
  assert.equal(children.length, 1);
  assert.equal(children[0].mode, 'one-shot'); // lie fixed: always one-shot until S2
  const descEvent = events.find((e) => e.activityType === 'subagent.descriptor');
  assert.ok(descEvent);
  assert.equal((descEvent.payload.subagentDescriptor as any).mode, 'one-shot');
  // eventually settles
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(runtime.listBackgroundAgents(parent.id)[0].isFinal, true);
});

test('S1: inline spawn creates one-shot child and descriptor', async () => {
  const { convRepo, parent, runtime, events } = makeRuntimeWithDb();
  const res = await runtime.spawn({
    conversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'call1', title: 'inline', prompt: 'hi', depth: 0,
  });
  assert.equal(res.status, 'completed');
  assert.ok(res.childConversationId);
  const children = convRepo.listSubagentChildren(parent.id);
  assert.equal(children[0].mode, 'one-shot');
  assert.equal(events.filter((e) => e.activityType === 'subagent.descriptor').length, 1);
});

test('rollback: capacity failure deletes child row (no orphan)', async () => {
  const { convRepo, parent, runtime } = makeRuntimeWithDb({ maxConcurrent: 2 });
  // fill slots with long runners
  const longExec = async ({ signal }: any) => {
    await new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('abort')), { once: true }));
    return { content: 'never' };
  };
  const rt2 = new SubagentRuntime({
    runtimeStateRepo: { recordEvent: (e: any) => ({ ...e, sequence: 1, occurredAt: new Date().toISOString() }) } as any,
    maxConcurrent: 2,
    createChildConversation: (input: any) => convRepo.createSubagentConversation(input),
    deleteChildConversation: (id: string) => convRepo.delete(id),
    childExecutor: longExec as any,
  });
  // need fresh parent for rt2? reuse same db parent
  const p1 = rt2.spawn({ conversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', title: 'c1', prompt: 'hi', depth: 0 });
  const p2 = rt2.spawn({ conversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c2', title: 'c2', prompt: 'hi', depth: 0 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(convRepo.listSubagentChildren(parent.id).length, 2);
  const p3 = await rt2.spawn({ conversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c3', title: 'c3', prompt: 'hi', depth: 0 });
  assert.equal(p3.status, 'failed');
  assert.equal(p3.childConversationId, null);
  assert.equal(convRepo.listSubagentChildren(parent.id).length, 2); // c3 not persisted
  // cleanup
  await rt2.interruptAll(parent.id);
  await Promise.allSettled([p1, p2]);
});

test('rollback: descriptor recordEvent failure deletes child row', async () => {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  let shouldFail = true;
  const runtimeRepo = {
    recordEvent: (e: any) => {
      if (shouldFail && e.activityType === 'subagent.descriptor') throw new Error('DB write failed');
      return { ...e, sequence: 1, occurredAt: new Date().toISOString() };
    },
  };
  const runtime = new SubagentRuntime({
    runtimeStateRepo: runtimeRepo as any,
    createChildConversation: (input: any) => convRepo.createSubagentConversation(input),
    deleteChildConversation: (id: string) => convRepo.delete(id),
    childExecutor: async () => ({ content: 'done' }),
  });
  const res = await runtime.spawn({
    conversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', title: 'fail-desc', prompt: 'hi', depth: 0,
  });
  assert.equal(res.status, 'failed');
  assert.match(res.error ?? '', /DB write failed/);
  assert.equal(convRepo.listSubagentChildren(parent.id).length, 0);
});

test('background surfaces: list, interrupt, readOutput, wait, drain, clear', async () => {
  const { convRepo, parent, runtime } = makeRuntimeWithDb({
    childExecutor: async ({ signal }: any) => {
      await new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('abort')), { once: true }));
      return { content: 'never' };
    },
  });
  const res = await runtime.spawn({
    conversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'bg1', title: 'bg', prompt: 'hi', background: true, depth: 0,
  });
  assert.equal(res.status, 'pending');
  // list
  assert.equal(runtime.listBackgroundAgents(parent.id).length, 1);
  assert.equal(runtime.listBackgroundAgents(parent.id)[0].agentId, 'bg1:0');
  // readOutput while running
  const ro = runtime.readBackgroundOutput('bg1:0', parent.id);
  assert.ok(ro);
  assert.equal(ro!.snapshot.status, 'pending');
  // interrupt
  const interrupted = await runtime.interruptAgent('bg1:0', parent.id);
  assert.equal(interrupted?.status, 'interrupted');
  // wait (already settled)
  const waited = await runtime.waitBackgroundAgent('bg1:0', 100, parent.id);
  assert.equal(waited?.isFinal, true);
  // interrupt marks reported, so drain finds 0 (exactly-once: interrupt already claimed)
  const drained1 = runtime.drainBackgroundNotices(parent.id);
  assert.equal(drained1.length, 0);
  const drained2 = runtime.drainBackgroundNotices(parent.id);
  assert.equal(drained2.length, 0);
  // read after drain still works (error is either the interrupt reason or the abort signal text, depending on race)
  const ro2 = runtime.readBackgroundOutput('bg1:0', parent.id);
  assert.ok(ro2?.text && ro2.text.length > 0);
  assert.equal(ro2?.snapshot.status, 'interrupted');
  // clear
  await runtime.clearConversationBackground(parent.id);
  assert.equal(runtime.listBackgroundAgents(parent.id).length, 0);
  // normal completion drain: spawn short task that completes without interrupt, then drain should find it
  const { convRepo: cr2, parent: p2, runtime: rt2 } = (() => {
    const db2 = new Database(':memory:');
    applySchema(db2);
    const cr = new ConversationsRepo(db2);
    const par = cr.create({});
    const rt = new SubagentRuntime({
      runtimeStateRepo: { recordEvent: (e: any) => ({ ...e, sequence: 1, occurredAt: new Date().toISOString() }) } as any,
      createChildConversation: (input: any) => cr.createSubagentConversation(input),
      deleteChildConversation: (id: string) => cr.delete(id),
      childExecutor: async () => ({ content: 'done' }),
    });
    return { convRepo: cr, parent: par, runtime: rt };
  })();
  await rt2.spawn({ conversationId: p2.id, parentTurnId: 't1', parentToolCallId: 'bg2', title: 'bg2', prompt: 'hi', background: true, depth: 0 });
  await new Promise((r) => setTimeout(r, 30));
  const drainedNormal = rt2.drainBackgroundNotices(p2.id);
  assert.equal(drainedNormal.length, 1);
  assert.equal(drainedNormal[0].agentId, 'bg2:0');
});

test('descriptor persistence under child conversation cascades on delete', async () => {
  const db = new Database(':memory:');
  applySchema(db);
  const convRepo = new ConversationsRepo(db);
  const parent = convRepo.create({});
  const runtime = new SubagentRuntime({
    runtimeStateRepo: {
      recordEvent: (e: any) => {
        // insert into conversation_events via real repo for cascade test
        // Use direct DB insert through repo not available, so just use DB manually
        db.prepare(`INSERT INTO conversation_events (event_id, conversation_id, turn_id, request_id, sequence, occurred_at, activity_type, tone, provider_id, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(e.eventId, e.conversationId, e.turnId, e.requestId, e.sequence, e.occurredAt, e.activityType, e.tone, e.provider, JSON.stringify(e.payload));
        return { ...e, sequence: 1, occurredAt: new Date().toISOString() };
      },
    } as any,
    createChildConversation: (input: any) => convRepo.createSubagentConversation(input),
    deleteChildConversation: (id: string) => convRepo.delete(id),
    childExecutor: async () => ({ content: 'done' }),
  });
  const res = await runtime.spawn({ conversationId: parent.id, parentTurnId: 't1', parentToolCallId: 'c1', title: 'c', prompt: 'hi', depth: 0 });
  const childId = res.childConversationId!;
  const countBefore = db.prepare(`SELECT COUNT(*) as c FROM conversation_events WHERE conversation_id = ?`).get(childId) as any;
  assert.equal(countBefore.c, 1);
  convRepo.delete(childId);
  const countAfter = db.prepare(`SELECT COUNT(*) as c FROM conversation_events WHERE conversation_id = ?`).get(childId) as any;
  assert.equal(countAfter.c, 0); // cascade deleted descriptor
});
