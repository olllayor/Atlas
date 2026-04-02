import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatMessage, ConversationPage } from '../src/shared/contracts.js';
import { decodeConversationPageCursor } from '../src/shared/conversationPaging.js';
import {
  DEFAULT_CONVERSATION_PAGE_SIZE,
  compactConversationPage,
  mergeConversationPage,
  reconcileConversationCache,
} from '../src/renderer/stores/conversationCache.js';

function createMessage(index: number, conversationId = 'conversation-1'): ChatMessage {
  return {
    id: `message-${index}`,
    conversationId,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${index}`,
    reasoning: null,
    parts: [],
    status: 'complete',
    providerId: 'openrouter',
    modelId: 'openrouter/test-model',
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    latencyMs: null,
    errorCode: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString(),
  };
}

function createPage(messageCount: number, conversationId = 'conversation-1'): ConversationPage {
  return {
    conversation: {
      id: conversationId,
      title: `Conversation ${conversationId}`,
      createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 0, 2)).toISOString(),
      defaultProviderId: 'openrouter',
      defaultModelId: 'openrouter/test-model',
    },
    messages: Array.from({ length: messageCount }, (_value, index) => createMessage(index, conversationId)),
    hasOlder: messageCount > DEFAULT_CONVERSATION_PAGE_SIZE,
    nextCursor: null,
    limit: DEFAULT_CONVERSATION_PAGE_SIZE,
  };
}

test('compactConversationPage keeps only the newest messages and updates the cursor', () => {
  const detail = createPage(130);

  const compacted = compactConversationPage(detail);

  assert.equal(compacted.messages.length, DEFAULT_CONVERSATION_PAGE_SIZE);
  assert.equal(compacted.messages[0]?.id, 'message-30');
  assert.equal(compacted.messages.at(-1)?.id, 'message-129');
  assert.equal(compacted.hasOlder, true);

  assert.ok(compacted.nextCursor);
  const cursor = decodeConversationPageCursor(compacted.nextCursor);
  assert.ok(cursor);
  assert.equal(cursor.id, 'message-30');
});

test('mergeConversationPage preserves already loaded older messages', () => {
  const existing = createPage(150);
  const latest = {
    ...createPage(100),
    messages: createPage(150).messages.slice(50),
    hasOlder: true,
  };

  const merged = mergeConversationPage(existing, latest);

  assert.equal(merged.messages.length, 150);
  assert.equal(merged.messages[0]?.id, 'message-0');
  assert.equal(merged.messages.at(-1)?.id, 'message-149');

  assert.ok(merged.nextCursor);
  const cursor = decodeConversationPageCursor(merged.nextCursor);
  assert.ok(cursor);
  assert.equal(cursor.id, 'message-0');
});

test('reconcileConversationCache compacts the previous active conversation and evicts the oldest inactive entry', () => {
  const result = reconcileConversationCache({
    conversationDetails: {
      active: createPage(140, 'active'),
      next: createPage(12, 'next'),
      inactiveA: createPage(125, 'inactiveA'),
      inactiveB: createPage(115, 'inactiveB'),
    },
    inactiveConversationIds: ['inactiveA', 'inactiveB'],
    previousSelectedId: 'active',
    nextSelectedId: 'next',
    inactiveLimit: 2,
  });

  assert.deepEqual(result.inactiveConversationIds, ['active', 'inactiveA']);
  assert.equal(result.conversationDetails.active.messages.length, DEFAULT_CONVERSATION_PAGE_SIZE);
  assert.equal(result.conversationDetails.active.messages[0]?.id, 'message-40');
  assert.ok(!('inactiveB' in result.conversationDetails));
  assert.ok('next' in result.conversationDetails);
});
