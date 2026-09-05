import assert from 'node:assert/strict';
import test from 'node:test';

import type { RuntimeEventEnvelope, StreamEvent } from '../src/shared/contracts';
import { CHILD_INTERRUPT_TIMEOUT_MS, SubagentRuntime } from '../src/main/ai/agents/SubagentRuntime';
import { createAgentTools } from '../src/main/ai/tools/agentTools';

test('Spawning 3 children emits 3 task.started rows with distinct deterministic agentIds', async () => {
  const recordedEvents: RuntimeEventEnvelope[] = [];
  const mockRepo = {
    recordEvent: (envelope: RuntimeEventEnvelope) => {
      recordedEvents.push(envelope);
      return envelope;
    },
  };

  const runtime = new SubagentRuntime({
    runtimeStateRepo: mockRepo,
    childExecutor: async ({ prompt }) => ({
      content: `Completed: ${prompt}`,
    }),
  });

  const parentToolCallId = 'tool-spawn-100';
  const results = await runtime.spawnBatch({
    conversationId: 'conv-1',
    parentTurnId: 'turn-1',
    parentToolCallId,
    tasks: [
      { title: 'Subtask A', prompt: 'Do A' },
      { title: 'Subtask B', prompt: 'Do B' },
      { title: 'Subtask C', prompt: 'Do C' },
    ],
  });

  assert.equal(results.length, 3);
  assert.equal(results[0].agentId, 'tool-spawn-100:0');
  assert.equal(results[1].agentId, 'tool-spawn-100:1');
  assert.equal(results[2].agentId, 'tool-spawn-100:2');

  const startEvents = recordedEvents.filter((e) => e.activityType === 'task.started');
  assert.equal(startEvents.length, 3);
  assert.equal(startEvents[0].agentId, 'tool-spawn-100:0');
  assert.equal(startEvents[1].agentId, 'tool-spawn-100:1');
  assert.equal(startEvents[2].agentId, 'tool-spawn-100:2');
});

test('Child tool events carry agentId + parentToolCallId attribution', async () => {
  const capturedEvents: RuntimeEventEnvelope[] = [];
  const emittedRawEvents: any[] = [];

  const runtime = new SubagentRuntime({
    onRuntimeEvent: (envelope) => {
      capturedEvents.push(envelope);
    },
    childExecutor: async ({ onEvent }) => {
      const callEvent = { type: 'tool.call', toolName: 'read_file', toolCallId: 'child-call-1' } as StreamEvent;
      const resultEvent = { type: 'tool.result', result: 'file content', toolCallId: 'child-call-1' } as StreamEvent;

      emittedRawEvents.push(callEvent, resultEvent);

      onEvent(callEvent);
      onEvent(resultEvent);

      return { content: 'Done' };
    },
  });

  await runtime.spawn({
    conversationId: 'conv-1',
    parentTurnId: 'turn-1',
    parentToolCallId: 'parent-call-55',
    title: 'Attributed worker',
    prompt: 'Execute step',
  });

  assert.equal(runtime.getActiveCount('conv-1'), 0);

  // Assert raw emitted events were stamped in-place
  assert.equal(emittedRawEvents[0].agentId, 'parent-call-55:0');
  assert.equal(emittedRawEvents[0].parentToolCallId, 'parent-call-55');
  assert.equal(emittedRawEvents[1].agentId, 'parent-call-55:0');
  assert.equal(emittedRawEvents[1].parentToolCallId, 'parent-call-55');

  // Assert emitted runtime event envelopes carried agentId and parentToolCallId
  const toolEnvelopes = capturedEvents.filter(
    (e) => e.providerEventType === 'tool.call' || e.providerEventType === 'tool.result'
  );
  assert.equal(toolEnvelopes.length, 2);
  assert.equal(toolEnvelopes[0].agentId, 'parent-call-55:0');
  assert.equal(toolEnvelopes[0].parentToolCallId, 'parent-call-55');
  assert.equal(toolEnvelopes[1].agentId, 'parent-call-55:0');
  assert.equal(toolEnvelopes[1].parentToolCallId, 'parent-call-55');
});

test('Global concurrency cap: 10 spawns across conversations never exceed 4 active slots', async () => {
  let maxActiveObserved = 0;
  let currentActive = 0;

  const runtime = new SubagentRuntime({
    maxConcurrent: 4,
    childExecutor: async () => {
      currentActive += 1;
      maxActiveObserved = Math.max(maxActiveObserved, currentActive);
      await new Promise((resolve) => setTimeout(resolve, 20));
      currentActive -= 1;
      return { content: 'Done' };
    },
  });

  // One task per conversation so the per-conversation cap never binds — this
  // isolates the GLOBAL slot limit, which is what this test is about.
  const promises = Array.from({ length: 10 }, (_, i) =>
    runtime.spawn({
      conversationId: `conv-concurrency-${i}`,
      parentTurnId: 'turn-1',
      parentToolCallId: `call-batch-${i}`,
      title: `Task ${i}`,
      prompt: `Prompt ${i}`,
    })
  );

  const results = await Promise.all(promises);

  assert.equal(results.length, 10);
  for (const result of results) {
    assert.equal(result.status, 'completed');
  }
  assert.ok(maxActiveObserved <= 4, `Expected max active <= 4, got ${maxActiveObserved}`);
  assert.ok(maxActiveObserved >= 2, `Expected real concurrency, got ${maxActiveObserved}`);
});

test('Child that throws yields task.completed failed status and does not throw top-level', async () => {
  const recordedEvents: RuntimeEventEnvelope[] = [];
  const mockRepo = {
    recordEvent: (envelope: RuntimeEventEnvelope) => {
      recordedEvents.push(envelope);
      return envelope;
    },
  };

  const runtime = new SubagentRuntime({
    runtimeStateRepo: mockRepo,
    childExecutor: async () => {
      throw new Error('Simulated child failure');
    },
  });

  const result = await runtime.spawn({
    conversationId: 'conv-err',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-err',
    title: 'Failing worker',
    prompt: 'Fail now',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'Simulated child failure');

  const completedEvent = recordedEvents.find((e) => e.activityType === 'task.completed');
  assert.ok(completedEvent);
  assert.equal(completedEvent.payload.error, 'Simulated child failure');
});

test('interruptAll stops all live child tasks for a conversation with status interrupted', async () => {
  const recordedEvents: RuntimeEventEnvelope[] = [];
  const mockRepo = {
    recordEvent: (envelope: RuntimeEventEnvelope) => {
      recordedEvents.push(envelope);
      return envelope;
    },
  };

  const runtime = new SubagentRuntime({
    runtimeStateRepo: mockRepo,
    childExecutor: async ({ signal }) => {
      await new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Aborted by signal')), { once: true });
      });
      return { content: 'Never reached' };
    },
  });

  const spawnPromise = runtime.spawn({
    conversationId: 'conv-interrupt',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-long',
    title: 'Long running child',
    prompt: 'Wait forever',
  });

  // Small sleep to ensure spawn has started running
  await new Promise((res) => setTimeout(res, 20));

  const count = await runtime.interruptAll('conv-interrupt', 'User cancelled');
  assert.equal(count, 1);

  const finalState = await spawnPromise;
  assert.equal(finalState.status, 'interrupted');

  const updatedOrCompleted = recordedEvents.filter(
    (e) => e.activityType === 'task.updated' || e.activityType === 'task.completed'
  );
  assert.ok(updatedOrCompleted.length > 0);
});

test('interruptAllConversations stops live tasks across every conversation', async () => {
  const runtime = new SubagentRuntime({
    childExecutor: async ({ signal }) => {
      await new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Aborted by signal')), { once: true });
      });
      return { content: 'Never reached' };
    },
  });

  const spawnA = runtime.spawn({
    conversationId: 'conv-a',
    parentTurnId: 'turn-a',
    parentToolCallId: 'call-a',
    title: 'Child A',
    prompt: 'Wait forever',
  });
  const spawnB = runtime.spawn({
    conversationId: 'conv-b',
    parentTurnId: 'turn-b',
    parentToolCallId: 'call-b',
    title: 'Child B',
    prompt: 'Wait forever',
  });

  await new Promise((res) => setTimeout(res, 20));

  const count = await runtime.interruptAllConversations('app quitting');
  assert.equal(count, 2);

  const [stateA, stateB] = await Promise.all([spawnA, spawnB]);
  assert.equal(stateA.status, 'interrupted');
  assert.equal(stateB.status, 'interrupted');
  assert.equal(runtime.getActiveCount('conv-a'), 0);
  assert.equal(runtime.getActiveCount('conv-b'), 0);
});

test('spawn_agent tool integrates with SubagentRuntime and formats compact digest', async () => {
  const runtime = new SubagentRuntime({
    childExecutor: async ({ prompt }) => ({
      content: `Result of ${prompt}`,
      usage: { totalTokens: 42 },
    }),
  });

  const tools = createAgentTools(runtime, {
    conversationId: 'conv-tool',
    turnId: 'turn-1',
    parentToolCallId: 'call-spawn-tool',
  });

  assert.ok(tools.spawn_agent);

  const executeRes = await tools.spawn_agent.execute(
    {
      tasks: [
        { title: 'Subtask 1', prompt: 'Run task 1' },
        { title: 'Subtask 2', prompt: 'Run task 2' },
      ],
    },
    { toolCallId: 'call-spawn-tool', messages: [] }
  );

  assert.equal(executeRes.spawnedCount, 2);
  assert.equal(executeRes.tasks[0].title, 'Subtask 1');
  assert.equal(executeRes.tasks[0].tokensUsed, 42);
  assert.equal(executeRes.tasks[0].summary, 'Result of Run task 1');
});

test('interruptAll drains queued tasks and isolates by conversationId', async () => {
  let finishedConv2 = false;

  const runtime = new SubagentRuntime({
    maxConcurrent: 2,
    childExecutor: async ({ conversationId, signal }) => {
      if (conversationId === 'conv-1') {
        await new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Aborted by signal')), { once: true });
        });
      } else {
        await new Promise((res) => setTimeout(res, 50));
        finishedConv2 = true;
      }
      return { content: 'Done' };
    },
  });

  // conv-1 task A: runs immediately, holds a slot, hangs until aborted.
  const conv1Run = runtime.spawn({
    conversationId: 'conv-1',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-1',
    title: 'Conv 1 active',
    prompt: 'Run 1',
  });

  // conv-2 task B: runs immediately, holds the second slot.
  const conv2Run = runtime.spawn({
    conversationId: 'conv-2',
    parentTurnId: 'turn-2',
    parentToolCallId: 'call-2',
    title: 'Conv 2 active',
    prompt: 'Run 2',
  });

  // conv-1 task C: conv-1's pending count is 1 (< cap 2) so it is admitted,
  // but both slots are held, so it queues as a waiter. (Under the
  // per-conversation cap a conversation can still queue — just never beyond
  // the total slot count.)
  const conv1Queued = runtime.spawn({
    conversationId: 'conv-1',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-3',
    title: 'Conv 1 queued',
    prompt: 'Run 3',
  });

  await new Promise((res) => setTimeout(res, 20));

  // Interrupt conv-1: drains its queued waiter and aborts its active task,
  // while conv-2 keeps running (isolation).
  await runtime.interruptAll('conv-1', 'Cancelled conv-1');

  const res1 = await conv1Run;
  const res3 = await conv1Queued;
  assert.equal(res1.status, 'interrupted');
  assert.equal(res3.status, 'interrupted');

  // conv-2 is untouched and completes normally.
  const res2 = await conv2Run;
  assert.equal(res2.status, 'completed');
  assert.equal(finishedConv2, true);
});

test('Child task fails when childExecutor returns status awaiting_approval', async () => {
  const recordedEvents: RuntimeEventEnvelope[] = [];
  const mockRepo = {
    recordEvent: (envelope: RuntimeEventEnvelope) => {
      recordedEvents.push(envelope);
      return envelope;
    },
  };

  const runtime = new SubagentRuntime({
    runtimeStateRepo: mockRepo,
    childExecutor: async () => ({
      content: 'Child requested bash',
      status: 'awaiting_approval',
    }),
  });

  const result = await runtime.spawn({
    conversationId: 'conv-approval',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-unapproved',
    title: 'Unapproved worker',
    prompt: 'Run unapproved bash',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'Child task requested unapproved tool execution');

  const completedEvent = recordedEvents.find((e) => e.activityType === 'task.completed');
  assert.ok(completedEvent);
  assert.equal(completedEvent.payload.status, 'failed');
  assert.equal(completedEvent.payload.error, 'Child task requested unapproved tool execution');
});

test('Nested subagent execution forwards parentAgentId to child executor and nested tasks', async () => {
  const recordedEvents: RuntimeEventEnvelope[] = [];
  const receivedParentAgentIds = new Map<string, string | undefined>();

  let runtime: SubagentRuntime;
  runtime = new SubagentRuntime({
    runtimeStateRepo: {
      recordEvent: (envelope) => {
        recordedEvents.push(envelope);
        return envelope;
      },
    },
    childExecutor: async ({ prompt, parentAgentId }) => {
      receivedParentAgentIds.set(prompt, parentAgentId);
      if (prompt === 'Run parent subagent') {
        const nestedTools = createAgentTools(runtime, {
          conversationId: 'conv-nested',
          turnId: 'turn-nested',
          parentAgentId: parentAgentId,
          parentToolCallId: 'call-nested-spawn',
        });

        await nestedTools.spawn_agent.execute(
          {
            tasks: [{ title: 'Nested Child', prompt: 'Run nested child' }],
          },
          { toolCallId: 'call-nested-spawn', messages: [] }
        );
      }
      return { content: `Done: ${prompt}` };
    },
  });

  const parentResult = await runtime.spawn({
    conversationId: 'conv-nested',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-parent-spawn',
    title: 'Parent Subagent',
    prompt: 'Run parent subagent',
  });

  assert.equal(parentResult.status, 'completed');
  assert.equal(receivedParentAgentIds.get('Run parent subagent'), 'call-parent-spawn:0');
  assert.equal(receivedParentAgentIds.get('Run nested child'), 'call-nested-spawn:0');

  // Verify the nested task event carried parentAgentId: 'call-parent-spawn:0'
  const nestedStartEvent = recordedEvents.find(
    (e) => e.activityType === 'task.started' && e.agentId === 'call-nested-spawn:0'
  );
  assert.ok(nestedStartEvent);
  assert.equal(nestedStartEvent.payload.parentAgentId, 'call-parent-spawn:0');
});

test('canSpawn is depth-only: true at full slots, false only at the depth cap', () => {
  const runtime = new SubagentRuntime({ maxConcurrent: 1, maxDepth: 3 });

  // A depth-2 agent's children would be depth 3 — still allowed.
  assert.equal(runtime.canSpawn(0), true);
  assert.equal(runtime.canSpawn(2), true);
  // A depth-3 agent's children would be depth 4 > maxDepth — gated.
  assert.equal(runtime.canSpawn(3), false);
});

test('spawn_agent stays registered while slots are full; omitted only at depth cap', async () => {
  const runtime = new SubagentRuntime({
    maxConcurrent: 1,
    childExecutor: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { content: 'Done' };
    },
  });

  const context = { conversationId: 'conv-gate', turnId: 'turn-1' };

  // Fill the only slot.
  const running = runtime.spawn({
    conversationId: 'conv-gate',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-filler',
    title: 'Filler',
    prompt: 'Fill the slot',
  });
  await new Promise((res) => setTimeout(res, 10));

  // Slot full — the tool must still be present (catalog stability).
  const toolsAtFullSlots = createAgentTools(runtime, context);
  assert.ok('spawn_agent' in toolsAtFullSlots, 'spawn_agent must stay registered at full slots');

  // Depth cap (maxDepth defaults to 3) — the tool is omitted (static fact,
  // safe to gate on).
  const toolsAtDepthCap = createAgentTools(runtime, { ...context, depth: 3 });
  assert.ok(!('spawn_agent' in toolsAtDepthCap), 'spawn_agent must be omitted at depth cap');

  await running;
});

test('Per-conversation capacity: over-capacity spawn is rejected per task, not queued', async () => {
  const runtime = new SubagentRuntime({
    maxConcurrent: 2,
    childExecutor: async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { content: 'Done' };
    },
  });

  // Two tasks fill both slots; a third from the same conversation must be
  // rejected immediately with an actionable error — not queued behind its own
  // siblings (that wait is the deadlock vector this rule removes).
  const results = await runtime.spawnBatch({
    conversationId: 'conv-cap',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-cap',
    tasks: [
      { title: 'A', prompt: 'Do A' },
      { title: 'B', prompt: 'Do B' },
      { title: 'C', prompt: 'Do C' },
    ],
  });

  assert.equal(results.length, 3);
  assert.equal(results[0].status, 'completed');
  assert.equal(results[1].status, 'completed');
  assert.equal(results[2].status, 'failed');
  assert.match(results[2].error ?? '', /capacity reached/i);
});

test('Cross-conversation spawns still queue behind a busy slot', async () => {
  const order: string[] = [];

  const runtime = new SubagentRuntime({
    maxConcurrent: 1,
    childExecutor: async ({ conversationId }) => {
      order.push(`start:${conversationId}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(`end:${conversationId}`);
      return { content: `Done ${conversationId}` };
    },
  });

  const first = runtime.spawn({
    conversationId: 'conv-a',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-a',
    title: 'A',
    prompt: 'A',
  });
  const second = runtime.spawn({
    conversationId: 'conv-b',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-b',
    title: 'B',
    prompt: 'B',
  });

  const [resA, resB] = await Promise.all([first, second]);
  assert.equal(resA.status, 'completed');
  assert.equal(resB.status, 'completed');
  // conv-b waited for conv-a's slot: strict serialization, no rejection.
  assert.deepEqual(order, ['start:conv-a', 'end:conv-a', 'start:conv-b', 'end:conv-b']);
});

test('Deadlock scenario: nested spawn at capacity is rejected, not hung', async () => {
  let runtime: SubagentRuntime;
  runtime = new SubagentRuntime({
    maxConcurrent: 1,
    childExecutor: async ({ prompt, parentAgentId }) => {
      if (prompt === 'Parent holds the only slot') {
        // The parent child holds the only slot and tries to spawn a nested
        // task from the same conversation. Old behaviour: the nested task
        // queued behind its own ancestor and hung the turn. New behaviour:
        // immediate per-task rejection.
        const nestedTools = createAgentTools(runtime, {
          conversationId: 'conv-deadlock',
          turnId: 'turn-1',
          parentAgentId,
          parentToolCallId: 'call-nested',
          depth: 1,
        });

        const nestedResult = await (nestedTools.spawn_agent as any).execute(
          { tasks: [{ title: 'Nested', prompt: 'Nested child' }] },
          { toolCallId: 'call-nested', messages: [] }
        );

        assert.equal(nestedResult.tasks.length, 1);
        assert.equal(nestedResult.tasks[0].status, 'failed');
        assert.match(nestedResult.tasks[0].error ?? '', /capacity reached/i);
      }
      return { content: `Done: ${prompt}` };
    },
  });

  const parentResult = await runtime.spawn({
    conversationId: 'conv-deadlock',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-parent',
    title: 'Parent',
    prompt: 'Parent holds the only slot',
  });

  assert.equal(parentResult.status, 'completed');
});

test('Rejected spawn does not leak the pending count: later spawns succeed', async () => {
  const runtime = new SubagentRuntime({
    maxConcurrent: 1,
    childExecutor: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { content: 'Done' };
    },
  });

  // First batch: one runs, one is rejected at the per-conversation cap.
  const firstBatch = await runtime.spawnBatch({
    conversationId: 'conv-leak',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-1',
    tasks: [
      { title: 'A', prompt: 'A' },
      { title: 'B', prompt: 'B' },
    ],
  });
  assert.equal(firstBatch[0].status, 'completed');
  assert.equal(firstBatch[1].status, 'failed');

  // After the slot frees, the same conversation can spawn again — the
  // rejected waiter must not have left a phantom pending count behind.
  const secondBatch = await runtime.spawnBatch({
    conversationId: 'conv-leak',
    parentTurnId: 'turn-2',
    parentToolCallId: 'call-2',
    tasks: [{ title: 'C', prompt: 'C' }],
  });
  assert.equal(secondBatch[0].status, 'completed');
});

test('a wedged child cannot hold the cascade stop open', async () => {
  // The child ignores its abort signal entirely. The stop must still return
  // within the bounded wait, because the parent turn's own interrupt is
  // queued behind it.
  let releaseChild: (() => void) | null = null;
  const runtime = new SubagentRuntime({
    childExecutor: async () => {
      await new Promise<void>((resolve) => {
        releaseChild = resolve;
      });
      return { content: 'Eventually' };
    },
  });

  const spawnPromise = runtime.spawn({
    conversationId: 'conv-wedged',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-wedged',
    title: 'Wedged child',
    prompt: 'Ignore the signal',
  });

  await new Promise((res) => setTimeout(res, 20));

  const startedAt = Date.now();
  const count = await runtime.interruptAll('conv-wedged', 'User cancelled');
  const waited = Date.now() - startedAt;

  assert.equal(count, 1);
  assert.ok(
    waited < CHILD_INTERRUPT_TIMEOUT_MS + 400,
    `cascade stop waited ${waited}ms on a child that never settles`
  );

  releaseChild?.();
  await spawnPromise;
});
