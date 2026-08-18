import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentIdFor,
  applyTaskPatch,
  buildTaskEnvelope,
  createTask,
  isTerminalTaskStatus,
  linkageFor,
  TaskSlotQueue,
} from '../src/main/ai/agents/subagentTasks';

test('agentIdFor produces deterministic parentToolCallId:index ids', () => {
  assert.equal(agentIdFor('tool-call-123', 0), 'tool-call-123:0');
  assert.equal(agentIdFor('tool-call-123', 3), 'tool-call-123:3');
});

test('createTask sets initial pending state with correct agentKind classification', () => {
  const taskMonitor = createTask({
    parentToolCallId: 'call-1',
    index: 0,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    title: 'Background monitor',
    prompt: 'Do something',
    taskType: 'monitor',
  });

  assert.equal(taskMonitor.taskId, 'call-1:0');
  assert.equal(taskMonitor.status, 'pending');
  assert.equal(taskMonitor.isFinal, false);
  assert.equal(taskMonitor.agentKind, 'background');

  const taskAgent = createTask({
    parentToolCallId: 'call-1',
    index: 1,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    title: 'Code explorer',
    prompt: 'Explore files',
    taskType: 'subagent',
  });

  assert.equal(taskAgent.taskId, 'call-1:1');
  assert.equal(taskAgent.status, 'pending');
  assert.equal(taskAgent.isFinal, false);
  assert.equal(taskAgent.agentKind, 'agent');
});

test('applyTaskPatch adheres to sticky terminal status and usage max-merge', () => {
  let task = createTask({
    parentToolCallId: 'call-1',
    index: 0,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    title: 'Explore codebase',
    prompt: 'Search files',
  });

  // Apply running status with usage
  task = applyTaskPatch(task, {
    status: 'running',
    progress: 'Searching...',
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  });
  assert.equal(task.status, 'running');
  assert.equal(task.isFinal, false);

  // Apply completion status
  task = applyTaskPatch(task, {
    status: 'completed',
    result: 'Done searching',
    usage: { promptTokens: 120, completionTokens: 60, totalTokens: 180 },
  });
  assert.equal(task.status, 'completed');
  assert.equal(task.isFinal, true);
  assert.equal(isTerminalTaskStatus(task.status), true);
  assert.equal(task.usage?.totalTokens, 180);

  // Late progress patch MUST NOT overwrite sticky terminal status or wipe result
  const lateTask = applyTaskPatch(task, {
    status: 'running',
    progress: 'Stray late update',
    result: null,
    usage: { promptTokens: 90, completionTokens: 40, totalTokens: 130 },
  });
  assert.equal(lateTask.status, 'completed');
  assert.equal(lateTask.isFinal, true);
  assert.equal(lateTask.result, 'Done searching');
  assert.equal(lateTask.usage?.totalTokens, 180); // field-wise max merge kept higher usage
});

test('buildTaskEnvelope repeats full TaskAgentLinkage on payload', () => {
  let task = createTask({
    parentToolCallId: 'call-99',
    index: 2,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    title: 'Subagent task',
    prompt: 'Perform analysis',
    model: 'gpt-4o',
    role: 'researcher',
  });

  task = applyTaskPatch(task, { status: 'running', progress: 'In progress' });

  const linkage = linkageFor(task);
  assert.equal(linkage.agentId, 'call-99:2');
  assert.equal(linkage.toolCallId, 'call-99');
  assert.equal(linkage.agentIndex, 2);
  assert.equal(linkage.model, 'gpt-4o');

  const envelope = buildTaskEnvelope(task, 'task.progress', {
    eventId: 'evt-1',
    sequence: 5,
    occurredAt: '2026-08-08T01:00:00.000Z',
  });

  assert.equal(envelope.activityType, 'task.progress');
  assert.equal(envelope.agentId, 'call-99:2');
  assert.equal(envelope.parentToolCallId, 'call-99');
  assert.equal(envelope.payload.agentId, 'call-99:2');
  assert.equal(envelope.payload.toolCallId, 'call-99');
  assert.equal(envelope.payload.title, 'Subagent task');
  assert.equal(envelope.payload.progress, 'In progress');
  assert.equal(envelope.payload.status, 'running');
  assert.equal(envelope.payload.isFinal, false);
});

test('buildTaskEnvelope serializes status and isFinal for terminal task states', () => {
  let task = createTask({
    parentToolCallId: 'call-100',
    index: 0,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    title: 'Failing subagent',
    prompt: 'Do task',
  });

  task = applyTaskPatch(task, { status: 'failed', error: 'Execution error' });

  const envelope = buildTaskEnvelope(task, 'task.completed', {
    eventId: 'evt-2',
    sequence: 6,
    occurredAt: '2026-08-08T01:05:00.000Z',
  });

  assert.equal(envelope.payload.status, 'failed');
  assert.equal(envelope.payload.isFinal, true);
  assert.equal(envelope.payload.error, 'Execution error');
});

test('TaskSlotQueue enforces bounded concurrency and FIFO release', async () => {
  const queue = new TaskSlotQueue(2);

  assert.equal(queue.inUse, 0);
  assert.equal(queue.queued, 0);

  const release1 = await queue.acquire();
  const release2 = await queue.acquire();

  assert.equal(queue.inUse, 2);
  assert.equal(queue.queued, 0);

  let slot3Acquired = false;
  const slot3Promise = queue.acquire().then((rel) => {
    slot3Acquired = true;
    return rel;
  });

  assert.equal(queue.inUse, 2);
  assert.equal(queue.queued, 1);
  assert.equal(slot3Acquired, false);

  // Release first slot, letting slot3 resolve (slot transferred, inUse stays 2)
  release1();
  const release3 = await slot3Promise;
  assert.equal(slot3Acquired, true);
  assert.equal(queue.inUse, 2);

  release2();
  release3();
  assert.equal(queue.inUse, 0);
});

test('TaskSlotQueue drainQueue rejects waiting promises with AbortError', async () => {
  const queue = new TaskSlotQueue(1);
  await queue.acquire();

  const p1 = queue.acquire();
  const p2 = queue.acquire();

  assert.equal(queue.queued, 2);
  const drained = queue.drainQueue();
  assert.equal(drained, 2);
  assert.equal(queue.queued, 0);

  await assert.rejects(p1, (err: Error) => err.name === 'AbortError');
  await assert.rejects(p2, (err: Error) => err.name === 'AbortError');
});

test('TaskSlotQueue drainQueue isolates by conversationId', async () => {
  const queue = new TaskSlotQueue(2);
  const release1 = await queue.acquire('conv-1');
  const release2 = await queue.acquire('conv-2');

  // Both slots held; each conversation's second acquire is admitted (pending
  // 1 < cap 2) but must wait as a queued waiter.
  const p1 = queue.acquire('conv-1');
  const p2 = queue.acquire('conv-2');

  assert.equal(queue.queued, 2);

  const drained = queue.drainQueue('conv-1');
  assert.equal(drained, 1);
  assert.equal(queue.queued, 1);

  await assert.rejects(p1, (err: Error) => err.name === 'AbortError');

  let p2Settled = false;
  p2.then(() => { p2Settled = true; }, () => { p2Settled = true; });
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(p2Settled, false);

  // conv-2's waiter survives the conv-1 drain and takes the freed slot.
  release1();
  const release3 = await p2;
  assert.equal(p2Settled, true);

  release2();
  release3();
  assert.equal(queue.inUse, 0);
});

test('TaskSlotQueue rejects a conversation at the per-conversation cap', async () => {
  const queue = new TaskSlotQueue(2);
  const release1 = await queue.acquire('conv-1');
  const p1 = queue.acquire('conv-1'); // admitted (pending 1 < 2), queued behind full slots

  // conv-1 is now at the cap (1 running + 1 waiting): the next acquire is
  // rejected outright instead of queueing — that wait is the deadlock vector.
  await assert.rejects(queue.acquire('conv-1'), /capacity reached/i);

  // Freeing conv-1's slot promotes its waiter.
  release1();
  const release3 = await p1;

  release3();
  assert.equal(queue.inUse, 0);

  // Counts fully returned: conv-1 can fill the cap again from zero.
  const r1 = await queue.acquire('conv-1');
  const r2 = await queue.acquire('conv-1');
  await assert.rejects(queue.acquire('conv-1'), /capacity reached/i);
  r1();
  r2();
  assert.equal(queue.inUse, 0);
});

test('createTask and linkageFor preserve parentAgentId when spawned in nested subagent context', () => {
  const task = createTask({
    parentToolCallId: 'call-child-1',
    parentAgentId: 'call-parent-0:0',
    index: 0,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    title: 'Nested subagent task',
    prompt: 'Do nested work',
  });

  assert.equal(task.parentAgentId, 'call-parent-0:0');

  const linkage = linkageFor(task);
  assert.equal(linkage.parentAgentId, 'call-parent-0:0');

  const envelope = buildTaskEnvelope(task, 'task.started', {
    eventId: 'evt-nested-1',
    sequence: 1,
    occurredAt: '2026-08-08T01:00:00.000Z',
  });

  assert.equal(envelope.payload.parentAgentId, 'call-parent-0:0');
});
