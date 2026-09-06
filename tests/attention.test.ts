import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatMessagePart } from '../src/shared/contracts.js';
import {
  deriveAttentionState,
  hasPendingApprovalInParts,
  pickNextAttentionConversation,
  type AttentionLevel,
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
  assert.equal(
    deriveAttentionState({
      hasPendingApproval: true,
      conversationStatus: 'running',
    }),
    'needsInput'
  );
});

test('needsInput: approval pending when nothing else is happening', () => {
  assert.equal(deriveAttentionState({ hasPendingApproval: true }), 'needsInput');
});

test('a failed draft is needsInput — an error wants a decision, not just eyes', () => {
  assert.equal(deriveAttentionState({ draftStatus: 'error' }), 'needsInput');
});

test('a failed conversation is needsInput — persisted failure wants a decision', () => {
  assert.equal(deriveAttentionState({ conversationStatus: 'failed' }), 'needsInput');
});

test('active turn supersedes stale persisted conversation failure', () => {
  assert.equal(
    deriveAttentionState({
      conversationStatus: 'failed',
      draftStatus: 'streaming',
    }),
    'running'
  );
  assert.equal(
    deriveAttentionState({
      conversationStatus: 'failed',
      draftStatus: 'queued',
    }),
    'queued'
  );
  assert.equal(
    deriveAttentionState({
      conversationStatus: 'failed',
      draftStatus: 'streaming',
      hasPendingApproval: true,
    }),
    'needsInput'
  );
  assert.equal(
    deriveAttentionState({
      conversationStatus: 'failed',
      draftStatus: 'error',
    }),
    'needsInput'
  );
});

test('running: draft streaming or background liveness or persisted running status', () => {
  assert.equal(deriveAttentionState({ draftStatus: 'streaming' }), 'running');
  assert.equal(deriveAttentionState({ backgroundLiveness: 'working' }), 'running');
  assert.equal(deriveAttentionState({ conversationStatus: 'running' }), 'running');
});

test('queued: draft queued, conversation queued, or follow-ups present', () => {
  assert.equal(deriveAttentionState({ draftStatus: 'queued' }), 'queued');
  assert.equal(deriveAttentionState({ conversationStatus: 'queued' }), 'queued');
  assert.equal(deriveAttentionState({ queuedFollowups: 2 }), 'queued');
});

test('live background jobs count as running; settled ones do not', () => {
  assert.equal(deriveAttentionState({ backgroundJobsLive: 1 }), 'running');
  assert.equal(deriveAttentionState({ backgroundJobsLive: 3 }), 'running');
  assert.equal(deriveAttentionState({ backgroundJobsLive: 0 }), 'idle');
  // NeedsInput outranks live jobs when an approval is pending.
  assert.equal(
    deriveAttentionState({ hasPendingApproval: true, backgroundJobsLive: 2 }),
    'needsInput'
  );
});

test('unread: positive unread count with no higher-priority condition', () => {
  assert.equal(deriveAttentionState({ unreadCount: 1 }), 'unread');
  assert.equal(deriveAttentionState({ unreadCount: 5 }), 'unread');
});

test('active goal suppresses unread tier only', () => {
  // Unread suppressed.
  assert.equal(deriveAttentionState({ unreadCount: 3, hasActiveGoal: true }), 'idle');
  // Needs-input still surfaces.
  assert.equal(
    deriveAttentionState({ hasPendingApproval: true, hasActiveGoal: true }),
    'needsInput'
  );
  // Running still surfaces.
  assert.equal(
    deriveAttentionState({ draftStatus: 'streaming', hasActiveGoal: true }),
    'running'
  );
});

test('idle: none of the above conditions met', () => {
  assert.equal(deriveAttentionState({}), 'idle');
  assert.equal(deriveAttentionState({ unreadCount: 0, conversationStatus: 'idle' }), 'idle');
});

test('precedence: needsInput > running > queued > unread > idle', () => {
  // All present: needsInput wins.
  assert.equal(
    deriveAttentionState({
      hasPendingApproval: true,
      draftStatus: 'streaming',
      queuedFollowups: 1,
      unreadCount: 4,
    }),
    'needsInput'
  );

  // Running > queued.
  assert.equal(
    deriveAttentionState({
      backgroundLiveness: 'working',
      queuedFollowups: 1,
      unreadCount: 4,
    }),
    'running'
  );

  // Queued > unread.
  assert.equal(
    deriveAttentionState({
      conversationStatus: 'queued',
      unreadCount: 4,
    }),
    'queued'
  );
});

test('hasPendingApprovalInParts detects approval-requested tool part', () => {
  assert.equal(hasPendingApprovalInParts(undefined), false);
  assert.equal(hasPendingApprovalInParts([]), false);
  assert.equal(hasPendingApprovalInParts([toolPart('running')]), false);
  assert.equal(hasPendingApprovalInParts([toolPart('complete')]), false);
  assert.equal(hasPendingApprovalInParts([toolPart('approval-requested')]), true);
  assert.equal(
    hasPendingApprovalInParts([toolPart('running'), toolPart('approval-requested')]),
    true
  );
});

test('pickNextAttentionConversation prefers higher attention level, breaks ties by recency', () => {
  const items = [
    { id: 'c1', level: 'unread' as AttentionLevel, timestampMs: 100 },
    { id: 'c2', level: 'needsInput' as AttentionLevel, timestampMs: 50 },
    { id: 'c3', level: 'running' as AttentionLevel, timestampMs: 200 },
  ];
  // c2 has highest tier (needsInput).
  assert.equal(pickNextAttentionConversation(items, null), 'c2');
});

test('pickNextAttentionConversation skips current selection and idle items', () => {
  const items = [
    { id: 'current', level: 'needsInput' as AttentionLevel, timestampMs: 500 },
    { id: 'idle-one', level: 'idle' as AttentionLevel, timestampMs: 400 },
    { id: 'next', level: 'running' as AttentionLevel, timestampMs: 100 },
  ];
  assert.equal(pickNextAttentionConversation(items, 'current'), 'next');
});

test('pickNextAttentionConversation breaks ties by most recent timestamp', () => {
  const items = [
    { id: 'older', level: 'unread' as AttentionLevel, timestampMs: 100 },
    { id: 'newer', level: 'unread' as AttentionLevel, timestampMs: 200 },
  ];
  assert.equal(pickNextAttentionConversation(items, null), 'newer');
});

test('pickNextAttentionConversation returns null when no candidate needs attention', () => {
  const items = [
    { id: 'c1', level: 'idle' as AttentionLevel, timestampMs: 100 },
    { id: 'current', level: 'running' as AttentionLevel, timestampMs: 200 },
  ];
  assert.equal(pickNextAttentionConversation(items, 'current'), null);
  assert.equal(pickNextAttentionConversation([], null), null);
});
