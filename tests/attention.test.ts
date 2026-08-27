import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatMessagePart } from '../src/shared/contracts.js';
import {
  deriveAttentionState,
  hasPendingApprovalInParts,
  pickNextAttentionConversation,
} from '../src/renderer/lib/attention.js';

function toolPart(state: string): ChatMessagePart {
  return { id: 'p1', type: 'tool', toolCallId: 't1', toolName: 'bash', state } as ChatMessagePart;
}

test('needsInput outranks everything: approval pending', () => {
  assert.equal(
    deriveAttentionState({
      hasPendingApproval: true,
      draftStatus: 'streaming',
      unreadCount: 3,
      conversationStatus: 'running',
    }),
    'needsInput'
  );
});

test('a failed draft is needsInput — an error wants a decision, not just eyes', () => {
  assert.equal(deriveAttentionState({ draftStatus: 'error' }), 'needsInput');
});

test('running: draft streaming or background liveness or persisted running status', () => {
  assert.equal(deriveAttentionState({ draftStatus: 'streaming' }), 'running');
  assert.equal(deriveAttentionState({ backgroundLiveness: 'working' }), 'running');
  assert.equal(deriveAttentionState({ conversationStatus: 'running' }), 'running');
  // Monitoring-only subagents are not work in flight.
  assert.equal(deriveAttentionState({ backgroundLiveness: 'monitoring' }), 'idle');
});

test('live background jobs count as running; settled ones do not', () => {
  assert.equal(deriveAttentionState({ backgroundJobsLive: 1 }), 'running');
  assert.equal(deriveAttentionState({ backgroundJobsLive: 3 }), 'running');
  assert.equal(deriveAttentionState({ backgroundJobsLive: 0 }), 'idle');
  // A live job cannot rescue an unread tier past needsInput.
  assert.equal(
    deriveAttentionState({ hasPendingApproval: true, backgroundJobsLive: 2 }),
    'needsInput'
  );
});

test('queued: queued draft, persisted queue, or durable follow-ups waiting', () => {
  assert.equal(deriveAttentionState({ draftStatus: 'queued' }), 'queued');
  assert.equal(deriveAttentionState({ conversationStatus: 'queued' }), 'queued');
  assert.equal(deriveAttentionState({ queuedFollowups: 2 }), 'queued');
});

test('unread only when nothing louder is going on and the count is positive', () => {
  assert.equal(deriveAttentionState({ unreadCount: 1 }), 'unread');
  assert.equal(deriveAttentionState({ unreadCount: 0 }), 'idle');
});

test('hasPendingApprovalInParts scans tool parts only for approval-requested', () => {
  assert.equal(hasPendingApprovalInParts([toolPart('approval-requested')]), true);
  assert.equal(hasPendingApprovalInParts([toolPart('approval-responded')]), false);
  assert.equal(hasPendingApprovalInParts([]), false);
  assert.equal(hasPendingApprovalInParts(undefined), false);
});

test('pickNextAttentionConversation: needs-input beats running beats unread; current selection skipped', () => {
  const items = [
    { id: 'a', level: 'unread' as const, timestampMs: 100 },
    { id: 'b', level: 'running' as const, timestampMs: 200 },
    { id: 'c', level: 'needsInput' as const, timestampMs: 50 },
    { id: 'd', level: 'idle' as const, timestampMs: 900 },
  ];

  assert.equal(pickNextAttentionConversation(items, null), 'c');
  assert.equal(pickNextAttentionConversation(items, 'c'), 'b', 'selection skipped, next tier wins');
  assert.equal(pickNextAttentionConversation(items, 'c'), 'b', 'idle rows never picked');
});

test('pickNextAttentionConversation: within a tier the most recent wins', () => {
  const items = [
    { id: 'old', level: 'unread' as const, timestampMs: 10 },
    { id: 'new', level: 'unread' as const, timestampMs: 20 },
  ];
  assert.equal(pickNextAttentionConversation(items, null), 'new');
});

test('pickNextAttentionConversation: null when nothing but idle/selected remains', () => {
  assert.equal(pickNextAttentionConversation([{ id: 'x', level: 'idle', timestampMs: 1 }], null), null);
  assert.equal(
    pickNextAttentionConversation([{ id: 'x', level: 'running', timestampMs: 1 }], 'x'),
    null
  );
  assert.equal(pickNextAttentionConversation([], null), null);
});
