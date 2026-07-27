import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConversationPage, RuntimeStateSnapshot, StreamEvent } from '../src/shared/contracts.js';
import {
  applyMetaEvent,
  applyRecoveredRuntimeEventsToStore,
  applyRuntimeSnapshotToStore,
  applyStreamingEvent,
  isStreamingEvent,
  type RuntimeEventFanOut
} from '../src/renderer/stores/streamEventReducers.js';

function makeFanOut(overrides: Partial<RuntimeEventFanOut> = {}): RuntimeEventFanOut {
  return {
    draftsByConversation: {},
    conversationDetails: {},
    requestToConversation: {},
    runtimeSequenceByConversation: {},
    ...overrides,
  };
}

function makeMessage(overrides: Partial<{ id: string; content: string; status: 'complete' | 'streaming' }> = {}) {
  return {
    id: overrides.id ?? 'message-1',
    conversationId: 'conversation-1',
    role: 'assistant' as const,
    content: overrides.content ?? '',
    reasoning: null,
    parts: [],
    status: overrides.status ?? 'complete' as const,
    providerId: null,
    modelId: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    latencyMs: null,
    errorCode: null,
    createdAt: new Date(0).toISOString(),
  };
}

test('isStreamingEvent recognizes the streaming event set', () => {
  assert.equal(isStreamingEvent({ type: 'chunk', requestId: 'r', id: 'i', delta: 'd' } as StreamEvent), true);
  assert.equal(isStreamingEvent({ type: 'reasoning', requestId: 'r', id: 'i', delta: 'd' } as StreamEvent), true);
  assert.equal(isStreamingEvent({ type: 'tool-input-start', requestId: 'r', toolCallId: 't', toolName: 'read_file' } as StreamEvent), true);
  assert.equal(isStreamingEvent({ type: 'meta', requestId: 'r', inputTokens: 0, outputTokens: 0, reasoningTokens: 0, latencyMs: 0 } as StreamEvent), false);
  assert.equal(isStreamingEvent({ type: 'finish', requestId: 'r' } as StreamEvent), false);
});

test('applyStreamingEvent appends text deltas to a draft', () => {
  const state = makeFanOut({
    draftsByConversation: {
      'c1': {
        requestId: 'r1',
        providerId: 'openrouter',
        modelId: 'm1',
        parts: [],
        status: 'streaming',
        startedAt: new Date(0).toISOString(),
      }
    }
  });
  const event: StreamEvent = { type: 'chunk', requestId: 'r1', id: 'part-1', delta: 'hello ' };
  const patch = applyStreamingEvent(state, 'c1', event);
  assert.ok(patch, 'patch should exist');
  const next = { ...state, ...patch } as RuntimeEventFanOut;
  const draft = next.draftsByConversation['c1'];
  assert.ok(draft, 'draft should still exist');
  const text = draft.parts.find((part) => part.type === 'text');
  assert.equal(text && text.type === 'text' ? text.text : null, 'hello ');
});

test('applyStreamingEvent is a no-op when there is no draft and no detail', () => {
  const state = makeFanOut();
  const event: StreamEvent = { type: 'chunk', requestId: 'r1', id: 'part-1', delta: 'hello' };
  assert.equal(applyStreamingEvent(state, 'c1', event), null);
});

test('applyStreamingEvent updates the streaming assistant message when one exists', () => {
  const detail: ConversationPage = {
    conversation: {
      id: 'c1',
      title: 't',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      defaultProviderId: null,
      defaultModelId: null,
    },
    messages: [makeMessage({ id: 'a1', status: 'streaming' })],
    hasOlder: false,
    nextCursor: null,
    limit: 100,
  };
  const state = makeFanOut({ conversationDetails: { c1: detail } });
  const event: StreamEvent = { type: 'chunk', requestId: 'r1', id: 'p1', delta: 'world' };
  const patch = applyStreamingEvent(state, 'c1', event);
  assert.ok(patch);
  const next = { ...state, ...patch } as RuntimeEventFanOut;
  const updated = next.conversationDetails['c1'].messages[0];
  const text = updated.parts.find((part) => part.type === 'text');
  assert.equal(text && text.type === 'text' ? text.text : null, 'world');
});

test('applyMetaEvent updates token usage on the draft and the streaming message', () => {
  const detail: ConversationPage = {
    conversation: {
      id: 'c1',
      title: 't',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      defaultProviderId: null,
      defaultModelId: null,
    },
    messages: [makeMessage({ id: 'a1', status: 'streaming' })],
    hasOlder: false,
    nextCursor: null,
    limit: 100,
  };
  const state = makeFanOut({
    conversationDetails: { c1: detail },
    draftsByConversation: {
      c1: {
        requestId: 'r1',
        providerId: 'openrouter',
        modelId: 'm1',
        parts: [],
        status: 'streaming',
        startedAt: new Date(0).toISOString(),
      }
    }
  });
  const event: Extract<StreamEvent, { type: 'meta' }> = {
    type: 'meta',
    requestId: 'r1',
    inputTokens: 10,
    outputTokens: 20,
    reasoningTokens: 5,
    latencyMs: 250,
  };
  const patch = applyMetaEvent(state, 'c1', event);
  assert.ok(patch);
  const next = { ...state, ...patch } as RuntimeEventFanOut;
  assert.equal(next.draftsByConversation['c1']?.inputTokens, 10);
  assert.equal(next.draftsByConversation['c1']?.outputTokens, 20);
  assert.equal(next.draftsByConversation['c1']?.reasoningTokens, 5);
  assert.equal(next.draftsByConversation['c1']?.latencyMs, 250);
  assert.equal(next.conversationDetails['c1'].messages[0].inputTokens, 10);
});

test('applyRuntimeSnapshotToStore hydrates drafts and details from a snapshot', () => {
  const snapshot: RuntimeStateSnapshot = {
    conversationId: 'c1',
    conversation: {
      id: 'c1',
      title: 'My chat',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      defaultProviderId: null,
      defaultModelId: null,
    },
    lastSequence: 7,
    checkpointSequence: 0,
    messages: [makeMessage({ id: 'a1', status: 'streaming', content: 'partial' })],
    activities: [],
    pendingApprovals: [],
    providerSession: {
      requestId: 'r1',
      providerId: 'openrouter',
      modelId: 'm1',
      status: 'active',
      startedAt: new Date(0).toISOString(),
    },
    latestCheckpoint: null,
  };
  const patch = applyRuntimeSnapshotToStore(makeFanOut(), 'c1', snapshot);
  assert.ok(patch.conversationDetails);
  assert.ok(patch.draftsByConversation);
  assert.equal(patch.conversationDetails?.['c1']?.conversation.id, 'c1');
  assert.equal(patch.draftsByConversation?.['c1']?.requestId, 'r1');
  assert.equal(patch.runtimeSequenceByConversation?.['c1'], 7);
});

test('applyRecoveredRuntimeEventsToStore skips events at-or-before the last sequence', () => {
  const state = makeFanOut({ runtimeSequenceByConversation: { c1: 5 } });
  const patch = applyRecoveredRuntimeEventsToStore(state, 'c1', [
    {
      eventId: 'e1',
      conversationId: 'c1',
      turnId: 't1',
      requestId: 'r1',
      sequence: 3,
      occurredAt: new Date().toISOString(),
      activityType: 'message.delta',
      tone: 'info',
      provider: 'openrouter',
      payload: {},
    },
  ]);
  assert.deepEqual(patch, {});
});

test('applyRecoveredRuntimeEventsToStore maps recovered requestIds to the conversation', () => {
  const state = makeFanOut({ runtimeSequenceByConversation: { c1: 0 } });
  const patch = applyRecoveredRuntimeEventsToStore(state, 'c1', [
    {
      eventId: 'e1',
      conversationId: 'c1',
      turnId: 't1',
      requestId: 'r1',
      sequence: 1,
      occurredAt: new Date().toISOString(),
      activityType: 'message.delta',
      tone: 'info',
      provider: 'openrouter',
      payload: {},
    },
  ]);
  const next = { ...state, ...patch } as RuntimeEventFanOut;
  assert.equal(next.requestToConversation['r1'], 'c1');
  assert.equal(next.runtimeSequenceByConversation['c1'], 1);
});
