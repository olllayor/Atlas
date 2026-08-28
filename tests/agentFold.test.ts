import assert from 'node:assert/strict';
import test from 'node:test';

import type { WorkLogEntry } from '../src/shared/contracts';
import {
  foldAgents,
  isActiveAgentStatus,
  isBackgroundTaskActivity,
  isTerminalAgentStatus,
  selectBatchAgents,
  summarizeBatch,
} from '../src/renderer/lib/agentFold';

function makeEntry(overrides: Partial<WorkLogEntry> = {}): WorkLogEntry {
  const basePayload = {
    agentKind: 'agent',
    agentId: 'agent-1',
    title: 'Test Agent',
  };

  return {
    id: 'task-1',
    conversationId: 'conv-1',
    turnId: 'turn-1',
    activityType: 'task.progress',
    tone: 'info',
    provider: 'system',
    status: 'running',
    isFinal: false,
    occurredAt: '2026-08-08T01:00:00.000Z',
    ...overrides,
    payload: overrides.payload !== undefined ? overrides.payload : basePayload,
  };
}

test('isBackgroundTaskActivity returns true for unstamped or background rows', () => {
  const unstamped = makeEntry({ payload: {} });
  assert.equal(isBackgroundTaskActivity(unstamped), true);

  const background = makeEntry({ payload: { agentKind: 'background' } });
  assert.equal(isBackgroundTaskActivity(background), true);

  const subagent = makeEntry({ payload: { agentKind: 'agent' } });
  assert.equal(isBackgroundTaskActivity(subagent), false);
});

test('foldAgents handles start, progress, and completion events', () => {
  const start = makeEntry({
    activityType: 'task.started',
    occurredAt: '2026-08-08T01:00:00.000Z',
    payload: { agentKind: 'agent', agentId: 'agent-1', status: 'running', title: 'Explorer Agent', model: 'gpt-4o' },
  });

  const progress = makeEntry({
    activityType: 'task.progress',
    occurredAt: '2026-08-08T01:00:05.000Z',
    payload: { agentKind: 'agent', agentId: 'agent-1', status: 'running', progress: 'Reading files', usage: { totalTokens: 100 } },
  });

  const completed = makeEntry({
    activityType: 'task.completed',
    occurredAt: '2026-08-08T01:00:10.000Z',
    payload: { agentKind: 'agent', agentId: 'agent-1', status: 'completed', result: 'Task succeeded', usage: { totalTokens: 250 } },
  });

  const model = foldAgents([start, progress, completed]);

  assert.equal(model.agents.length, 1);
  const agent = model.agents[0];
  assert.equal(agent.id, 'agent-1');
  assert.equal(agent.title, 'Explorer Agent');
  assert.equal(agent.model, 'gpt-4o');
  assert.equal(agent.status, 'completed');
  assert.equal(agent.result, 'Task succeeded');
  assert.equal(agent.usage?.totalTokens, 250);
  assert.equal(agent.completedAt, '2026-08-08T01:00:10.000Z');
  assert.equal(model.activeAgents.length, 0);
  assert.equal(model.settledAgents.length, 1);
});

test('Identity vs activation: reactivation increments activationCount and clears past error/result', () => {
  const run1Start = makeEntry({
    activityType: 'task.started',
    occurredAt: '2026-08-08T01:00:00.000Z',
    payload: { agentKind: 'agent', agentId: 'agent-1', status: 'running' },
  });
  const run1Fail = makeEntry({
    activityType: 'task.completed',
    occurredAt: '2026-08-08T01:00:05.000Z',
    payload: { agentKind: 'agent', agentId: 'agent-1', status: 'failed', error: 'First run error' },
  });

  const model1 = foldAgents([run1Start, run1Fail]);
  assert.equal(model1.agents[0].activationCount, 1);
  assert.equal(model1.agents[0].error, 'First run error');

  const run2Start = makeEntry({
    activityType: 'task.started',
    occurredAt: '2026-08-08T01:00:10.000Z',
    payload: { agentKind: 'agent', agentId: 'agent-1', status: 'running' },
  });

  const model2 = foldAgents([run1Start, run1Fail, run2Start]);
  const agent2 = model2.agents[0];
  assert.equal(agent2.activationCount, 2);
  assert.equal(agent2.error, null); // cleared old error
  assert.equal(agent2.result, null);
  assert.equal(agent2.status, 'running');
});

test('Completion can create: terminal event with no start row produces agent', () => {
  const completed = makeEntry({
    activityType: 'task.completed',
    occurredAt: '2026-08-08T01:00:00.000Z',
    payload: { agentKind: 'agent', agentId: 'agent-1', status: 'completed', title: 'Orphan child', result: 'Done' },
  });

  const model = foldAgents([completed]);
  assert.equal(model.agents.length, 1);
  assert.equal(model.agents[0].title, 'Orphan child');
  assert.equal(model.agents[0].status, 'completed');
  assert.equal(model.agents[0].result, 'Done');
});

test('Late start only fills metadata and never downgrades terminal status', () => {
  const completed = makeEntry({
    activityType: 'task.completed',
    occurredAt: '2026-08-08T01:00:05.000Z',
    payload: { agentKind: 'agent', agentId: 'agent-1', status: 'completed', result: 'Already done' },
  });

  const lateStart = makeEntry({
    activityType: 'task.started',
    occurredAt: '2026-08-08T01:00:00.000Z',
    payload: { agentKind: 'agent', agentId: 'agent-1', status: 'running', title: 'Late arrived start', model: 'gpt-4o' },
  });

  const model = foldAgents([completed, lateStart]);
  const agent = model.agents[0];
  assert.equal(agent.status, 'completed'); // sticky terminal preserved
  assert.equal(agent.result, 'Already done');
  assert.equal(agent.model, 'gpt-4o'); // metadata filled
});

test('First-write terminal timestamps: completedAt is set once', () => {
  const term1 = makeEntry({
    activityType: 'task.completed',
    occurredAt: '2026-08-08T01:00:05.000Z',
    payload: { agentKind: 'agent', agentId: 'agent-1', status: 'completed' },
  });

  const term2 = makeEntry({
    activityType: 'task.completed',
    occurredAt: '2026-08-08T01:00:15.000Z',
    payload: { agentKind: 'agent', agentId: 'agent-1', status: 'completed' },
  });

  const model = foldAgents([term1, term2]);
  assert.equal(model.agents[0].completedAt, '2026-08-08T01:00:05.000Z');
});

test('Recent activity ring buffer caps at 6 items', () => {
  const entries: WorkLogEntry[] = [];
  for (let i = 1; i <= 10; i++) {
    entries.push(
      makeEntry({
        activityType: 'task.progress',
        occurredAt: `2026-08-08T01:00:${i < 10 ? '0' + i : i}.000Z`,
        payload: { agentKind: 'agent', agentId: 'agent-1', progress: `Step ${i}` },
      })
    );
  }

  const model = foldAgents(entries);
  const ring = model.agents[0].recentActivity;
  assert.equal(ring.length, 6);
  assert.equal(ring[0].summary, 'Step 5');
  assert.equal(ring[5].summary, 'Step 10');
});

// ── batch membership (Variant B: one CTA per spawn batch) ──────────────────

test('selectBatchAgents picks only the agents a spawn call owns', () => {
  const rows: WorkLogEntry[] = [
    makeEntry({
      id: 'task:call-a:0',
      activityType: 'task.started',
      parentToolCallId: 'call-a',
      payload: { agentKind: 'agent', agentId: 'call-a:0', status: 'running', title: 'First fleet' },
    }),
    makeEntry({
      id: 'task:call-b:0',
      activityType: 'task.started',
      parentToolCallId: 'call-b',
      payload: { agentKind: 'agent', agentId: 'call-b:0', status: 'running', title: 'Second fleet' },
    }),
  ];

  const { agents } = foldAgents(rows);
  assert.equal(agents.length, 2);

  const first = selectBatchAgents(agents, ['call-a']);
  assert.deepEqual(
    first.map((agent) => agent.title),
    ['First fleet']
  );

  const both = selectBatchAgents(agents, ['call-a', 'call-b']);
  assert.equal(both.length, 2);
  assert.deepEqual(selectBatchAgents(agents, []), []);
});

test('selectBatchAgents falls back to the id prefix for rows with no linkage', () => {
  // Ids are minted as `${parentToolCallId}:${index}`, so a row persisted
  // before the linkage field existed is still attributable.
  const rows: WorkLogEntry[] = [
    makeEntry({
      activityType: 'task.started',
      payload: { agentKind: 'agent', agentId: 'call-legacy:2', status: 'running', title: 'Legacy' },
    }),
  ];

  const { agents } = foldAgents(rows);
  assert.equal(agents[0].parentToolCallId, null);
  assert.deepEqual(
    selectBatchAgents(agents, ['call-legacy']).map((agent) => agent.title),
    ['Legacy']
  );
  assert.deepEqual(selectBatchAgents(agents, ['call-other']), []);
});

test('summarizeBatch counts live work, tokens, and the longest run', () => {
  const now = Date.parse('2026-08-08T01:00:30.000Z');
  const rows: WorkLogEntry[] = [
    makeEntry({
      activityType: 'task.started',
      occurredAt: '2026-08-08T01:00:00.000Z',
      updatedAt: '2026-08-08T01:00:00.000Z',
      parentToolCallId: 'call-a',
      payload: { agentKind: 'agent', agentId: 'call-a:0', status: 'running', usage: { totalTokens: 400 } },
    }),
    makeEntry({
      activityType: 'task.completed',
      occurredAt: '2026-08-08T01:00:10.000Z',
      updatedAt: '2026-08-08T01:00:10.000Z',
      parentToolCallId: 'call-a',
      payload: { agentKind: 'agent', agentId: 'call-a:1', status: 'completed', usage: { totalTokens: 600 } },
    }),
  ];

  const batch = summarizeBatch(foldAgents(rows).agents, now);
  assert.equal(batch.total, 2);
  assert.equal(batch.active, 1);
  assert.equal(batch.settled, 1);
  assert.equal(batch.totalTokens, 1000);
  // The still-running agent has been up for 30s; the settled one for 0s.
  assert.equal(batch.elapsedMs, 30_000);
});

test('an all-idle batch reports no live work', () => {
  const rows: WorkLogEntry[] = [
    makeEntry({
      activityType: 'task.updated',
      parentToolCallId: 'call-a',
      payload: { agentKind: 'agent', agentId: 'call-a:0', status: 'idle' },
    }),
  ];

  const batch = summarizeBatch(foldAgents(rows).agents, Date.now());
  assert.equal(batch.active, 0);
  assert.equal(batch.settled, 1);
});
