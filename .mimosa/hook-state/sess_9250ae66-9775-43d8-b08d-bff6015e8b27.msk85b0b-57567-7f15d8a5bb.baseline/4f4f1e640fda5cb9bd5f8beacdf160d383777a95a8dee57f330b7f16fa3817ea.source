import assert from 'node:assert/strict';
import test from 'node:test';

import type { RuntimeEventEnvelope, StreamEvent } from '../src/shared/contracts';
import { SubagentRuntime } from '../src/main/ai/agents/SubagentRuntime';
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

test('Concurrency cap: 10 spawns with cap 4 never exceeds 4 active slots concurrently', async () => {
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

  const tasks = Array.from({ length: 10 }, (_, i) => ({
    title: `Task ${i}`,
    prompt: `Prompt ${i}`,
  }));

  const results = await runtime.spawnBatch({
    conversationId: 'conv-concurrency',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-batch',
    tasks,
  });

  assert.equal(results.length, 10);
  assert.ok(maxActiveObserved <= 4, `Expected max active <= 4, got ${maxActiveObserved}`);
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
    maxConcurrent: 1,
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

  // Task 1 for conv-1 (runs immediately, holding slot)
  const conv1Run = runtime.spawn({
    conversationId: 'conv-1',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-1',
    title: 'Conv 1 active',
    prompt: 'Run 1',
  });

  // Task 2 for conv-1 (queued behind maxConcurrent 1)
  const conv1Queued = runtime.spawn({
    conversationId: 'conv-1',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-2',
    title: 'Conv 1 queued',
    prompt: 'Run 2',
  });

  // Task for conv-2 (queued behind maxConcurrent 1)
  const conv2Queued = runtime.spawn({
    conversationId: 'conv-2',
    parentTurnId: 'turn-2',
    parentToolCallId: 'call-3',
    title: 'Conv 2 queued',
    prompt: 'Run 3',
  });

  await new Promise((res) => setTimeout(res, 20));

  // Interrupt conv-1
  const count = await runtime.interruptAll('conv-1', 'Cancelled conv-1');
  assert.equal(count, 2); // 1 active + 1 queued

  const res1 = await conv1Run;
  const res2 = await conv1Queued;
  assert.equal(res1.status, 'interrupted');
  assert.equal(res2.status, 'interrupted');

  // conv-2 should now get the slot and finish normally
  const res3 = await conv2Queued;
  assert.equal(res3.status, 'completed');
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
