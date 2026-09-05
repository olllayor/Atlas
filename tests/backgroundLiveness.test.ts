import assert from 'node:assert/strict';
import test from 'node:test';

import type { RuntimeEventEnvelope } from '../src/shared/contracts';
import { BackgroundLivenessService } from '../src/main/ai/core/BackgroundLivenessService';
import { SubagentRuntime } from '../src/main/ai/agents/SubagentRuntime';

/**
 * Envelopes here come from the real runtime rather than hand-written rows:
 * the point of the wiring is that the shape the emitter actually puts on the
 * wire is the shape the pill reads.
 */
function livenessFrom(envelopes: RuntimeEventEnvelope[], conversationId: string) {
  const service = new BackgroundLivenessService();
  for (const envelope of envelopes) service.recordTaskEnvelope(envelope);
  return service.getBackgroundLiveness(conversationId);
}

test('a live one-shot fan-out reads as working, and clears when it settles', async () => {
  const envelopes: RuntimeEventEnvelope[] = [];
  let release: (() => void) | null = null;

  const runtime = new SubagentRuntime({
    runtimeStateRepo: {
      recordEvent: (envelope: RuntimeEventEnvelope) => {
        envelopes.push(envelope);
        return envelope;
      },
    },
    childExecutor: async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { content: 'done' };
    },
  });

  const spawned = runtime.spawn({
    conversationId: 'conv-live',
    parentTurnId: 'turn-1',
    parentToolCallId: 'call-1',
    title: 'Explorer',
    prompt: 'Look around',
  });

  await new Promise((res) => setTimeout(res, 20));
  assert.equal(livenessFrom(envelopes, 'conv-live'), 'working');

  release?.();
  await spawned;
  assert.equal(livenessFrom(envelopes, 'conv-live'), null);
});

test('non-task envelopes are ignored', () => {
  const service = new BackgroundLivenessService();
  service.recordTaskEnvelope({
    conversationId: 'conv-1',
    activityType: 'tool.call',
    payload: { taskId: 'task-1', status: 'running' },
  } as unknown as RuntimeEventEnvelope);

  assert.equal(service.getBackgroundLiveness('conv-1'), null);
});

test('idle is not live, and an agent-owned shell rides on its owner', () => {
  const service = new BackgroundLivenessService();
  const envelope = (payload: Record<string, unknown>): RuntimeEventEnvelope =>
    ({ conversationId: 'conv-1', activityType: 'task.updated', payload }) as unknown as RuntimeEventEnvelope;

  service.recordTaskEnvelope(envelope({ taskId: 'agent-1', status: 'running' }));
  assert.equal(service.getBackgroundLiveness('conv-1'), 'working');

  // An idle agent is resumable, not live: it keeps its roster row but must not
  // pin the pill.
  service.recordTaskEnvelope(envelope({ taskId: 'agent-1', status: 'idle' }));
  assert.equal(service.getBackgroundLiveness('conv-1'), null);

  // A shell the agent started is covered by the agent's own liveness.
  service.recordTaskEnvelope(
    envelope({ taskId: 'shell-1', taskType: 'shell', status: 'running', parentAgentId: 'agent-1' })
  );
  assert.equal(service.getBackgroundLiveness('conv-1'), null);

  // A watch loop nobody owns is monitoring, not working.
  service.recordTaskEnvelope(envelope({ taskId: 'dev-server', taskType: 'site_dev_server', status: 'running' }));
  assert.equal(service.getBackgroundLiveness('conv-1'), 'monitoring');
});
