import assert from 'node:assert/strict';
import test from 'node:test';

import type { WorkLogEntry } from '../src/shared/contracts';
import {
  filterQuietTimeline,
  foldAgents,
  groupMembersByPhase,
  isAgentAttributedToolEntry,
  isTimelineBypassEntry,
  phaseMemberStatus,
  selectBatchWorkflows,
  summarizeWorkflow,
} from '../src/renderer/lib/agentFold';

function makeEntry(overrides: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return {
    id: 'task-1',
    conversationId: 'conv-1',
    turnId: 'turn-1',
    requestId: 'req-1',
    messageId: null,
    activityType: 'task.progress',
    tone: 'info',
    toolType: null,
    toolCallId: null,
    approvalId: null,
    title: '',
    summary: null,
    status: 'running',
    sequence: 1,
    isFinal: false,
    createdAt: '2026-08-08T01:00:00.000Z',
    updatedAt: '2026-08-08T01:00:00.000Z',
    ...overrides,
    payload: overrides.payload !== undefined ? overrides.payload : {},
  };
}

test('workflow coordinator + members fold into one run with stable slot ids', () => {
  const coordinator = makeEntry({
    id: 'task:flow-1',
    activityType: 'task.started',
    title: 'audit-auth-flow',
    payload: {
      agentKind: 'agent',
      agentId: 'flow-1',
      taskType: 'workflow',
      title: 'audit-auth-flow',
      workflowName: 'audit-auth-flow',
      workflowId: 'flow-1',
      phases: [
        { index: 0, title: 'Audit' },
        { index: 1, title: 'Verify' },
      ],
      status: 'running',
      runHandles: { scriptPath: '/tmp/run.sh' },
    },
  });
  const memberA = makeEntry({
    id: 'task:flow-1:0',
    activityType: 'task.started',
    title: 'audit:entrypoints',
    payload: {
      agentKind: 'agent',
      agentId: 'attempt-aaa',
      workflowId: 'flow-1',
      workflowName: 'audit-auth-flow',
      agentIndex: 0,
      phaseIndex: 0,
      phaseTitle: 'Audit',
      status: 'running',
      title: 'audit:entrypoints',
    },
  });
  // Retry of slot 0 with a different per-attempt id must reactivate, not duplicate.
  const memberARetry = makeEntry({
    id: 'task:flow-1:0',
    activityType: 'task.started',
    title: 'audit:entrypoints',
    createdAt: '2026-08-08T01:05:00.000Z',
    updatedAt: '2026-08-08T01:05:00.000Z',
    payload: {
      agentKind: 'agent',
      agentId: 'attempt-bbb',
      workflowId: 'flow-1',
      workflowName: 'audit-auth-flow',
      agentIndex: 0,
      phaseIndex: 0,
      phaseTitle: 'Audit',
      status: 'running',
      title: 'audit:entrypoints',
    },
  });

  const model = foldAgents([coordinator, memberA, memberARetry]);
  assert.equal(model.workflows.length, 1);
  const workflow = model.workflows[0]!;
  assert.equal(workflow.id, 'flow-1');
  assert.equal(workflow.members.length, 1);
  assert.equal(workflow.members[0]!.id, 'flow-1:0');
  assert.equal(workflow.members[0]!.activationCount, 1);
  // Coordinator repeats phases so start can age out; members carry phase.
  assert.equal(workflow.phases.length, 2);
  assert.equal(workflow.runHandles?.scriptPath, '/tmp/run.sh');
  // Direct agents exclude workflow rows (only roster).
  assert.equal(model.directAgents.length, 0);
});

test('coordinator status is authoritative for the run', () => {
  const coordinator = makeEntry({
    id: 'task:flow-2',
    activityType: 'task.completed',
    payload: {
      agentKind: 'agent',
      agentId: 'flow-2',
      taskType: 'workflow',
      workflowName: 'fix',
      workflowId: 'flow-2',
      status: 'failed',
      title: 'fix',
    },
  });
  const member = makeEntry({
    id: 'task:flow-2:0',
    activityType: 'task.progress',
    payload: {
      agentKind: 'agent',
      agentId: 'flow-2:0',
      workflowId: 'flow-2',
      agentIndex: 0,
      phaseIndex: 0,
      status: 'running',
      title: 'worker',
    },
  });
  const model = foldAgents([member, coordinator]);
  const workflow = model.workflows[0]!;
  assert.equal(workflow.status, 'failed');
  const summary = summarizeWorkflow(workflow, Date.parse('2026-08-08T02:00:00.000Z'));
  assert.equal(summary.status, 'failed');
  assert.equal(summary.coordinatorStatus, 'failed');
});

test('phase helpers: live vs done predicates and grouping', () => {
  const rows: WorkLogEntry[] = [
    makeEntry({
      id: 'task:flow-3:0',
      activityType: 'task.started',
      payload: { agentKind: 'agent', agentId: 'flow-3:0', workflowId: 'flow-3', agentIndex: 0, phaseIndex: 0, phaseTitle: 'Audit', status: 'running', title: 'a' },
    }),
    makeEntry({
      id: 'task:flow-3:1',
      activityType: 'task.completed',
      payload: { agentKind: 'agent', agentId: 'flow-3:1', workflowId: 'flow-3', agentIndex: 1, phaseIndex: 1, phaseTitle: 'Verify', status: 'completed', title: 'b' },
    }),
  ];
  const model = foldAgents(rows);
  const workflow = model.workflows[0]!;
  const live = phaseMemberStatus(workflow.members, 0);
  const done = phaseMemberStatus(workflow.members, 1);
  assert.equal(live.live, true);
  assert.equal(live.done, false);
  assert.equal(done.done, true);
  const groups = groupMembersByPhase(workflow.members);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.phase?.title, 'Audit');
});

test('quiet timeline: agent tool rows and bypass drop, background stays', () => {
  const agentTool = makeEntry({
    id: 'tool:child-1',
    activityType: 'tool.completed',
    toolCallId: 'child-1',
    agentId: 'call-a:0',
    payload: { agentKind: 'agent', agentId: 'call-a:0', toolName: 'read' },
  });
  const bypass = makeEntry({
    id: 'task:codex-child',
    activityType: 'task.progress',
    payload: { agentKind: 'agent', agentId: 'child-x', timelineBypass: true, progress: 'working' },
  });
  const shell = makeEntry({
    id: 'tool:shell-1',
    activityType: 'tool.completed',
    toolCallId: 'shell-1',
    payload: { agentKind: 'background', toolName: 'bash' },
  });
  assert.equal(isAgentAttributedToolEntry(agentTool), true);
  assert.equal(isAgentAttributedToolEntry(shell), false);
  assert.equal(isTimelineBypassEntry(bypass), true);
  const kept = filterQuietTimeline([agentTool, bypass, shell]);
  assert.deepEqual(
    kept.map((entry) => entry.id),
    ['tool:shell-1']
  );
  // Bypass rows still fold into the panel roster.
  const model = foldAgents([bypass]);
  assert.equal(model.agents.length, 1);
});

test('selectBatchWorkflows pins by spawn call and workflow id', () => {
  const rows: WorkLogEntry[] = [
    makeEntry({
      id: 'task:flow-9',
      activityType: 'task.started',
      parentToolCallId: 'call-w',
      payload: { agentKind: 'agent', agentId: 'flow-9', taskType: 'workflow', workflowName: 'w', workflowId: 'flow-9', status: 'running', title: 'w' },
    }),
    makeEntry({
      id: 'task:flow-9:0',
      activityType: 'task.started',
      parentToolCallId: 'call-w',
      payload: { agentKind: 'agent', agentId: 'flow-9:0', workflowId: 'flow-9', agentIndex: 0, status: 'running', title: 'm' },
    }),
  ];
  const model = foldAgents(rows);
  const byCall = selectBatchWorkflows(model.workflows, ['call-w']);
  assert.equal(byCall.length, 1);
  const byId = selectBatchWorkflows(model.workflows, ['flow-9']);
  assert.equal(byId.length, 1);
  assert.deepEqual(selectBatchWorkflows(model.workflows, ['other']), []);
});

test('idle presents as settled visual (not live)', () => {
  const rows: WorkLogEntry[] = [
    makeEntry({
      activityType: 'task.updated',
      payload: { agentKind: 'agent', agentId: 'idle-1', status: 'idle', title: 'parked' },
    }),
  ];
  const model = foldAgents(rows);
  assert.equal(model.activeAgents.length, 0);
  assert.equal(model.settledAgents.length, 1);
  assert.equal(model.workflows.length, 0);
  assert.equal(model.directAgents.length, 1);
});
