import assert from 'node:assert/strict';
import test from 'node:test';

import { filterHistoryMessages } from '../src/renderer/components/chatHistoryFilter.js';
import type { ChatMessage } from '../src/shared/contracts.js';

function makeMessage(
  id: string,
  role: 'user' | 'assistant',
  status: 'streaming' | 'complete' | 'error' | 'aborted' = 'complete',
  content = 'hello',
): ChatMessage {
  return {
    id,
    conversationId: 'test-conv',
    role,
    content,
    reasoning: null,
    parts: [{ id: `part-${id}`, type: 'text', text: content, state: status === 'streaming' ? 'streaming' : 'done' }],
    status,
    providerId: 'test',
    modelId: 'test',
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    latencyMs: null,
    errorCode: null,
    createdAt: new Date().toISOString(),
  };
}

test('the streaming placeholder is excluded while draft.status === "streaming"', () => {
  const userMsg = makeMessage('m1', 'user', 'complete', 'What is 2+2?');
  const placeholder = makeMessage('m2', 'assistant', 'streaming', '4');
  const messages = [userMsg, placeholder];

  // Tested with boolean true
  const filteredWithBool = filterHistoryMessages(messages, true);
  assert.equal(filteredWithBool.length, 1);
  assert.equal(filteredWithBool[0].id, 'm1');

  // Tested with draft status string 'streaming'
  const filteredWithDraftStatus = filterHistoryMessages(messages, 'streaming');
  assert.equal(filteredWithDraftStatus.length, 1);
  assert.equal(filteredWithDraftStatus[0].id, 'm1');
});

test('the corresponding history message is included again after settle', () => {
  const userMsg = makeMessage('m1', 'user', 'complete', 'What is 2+2?');
  const settledMsg = makeMessage('m2', 'assistant', 'complete', '4');
  const messages = [userMsg, settledMsg];

  // Case 1: isStreaming is false (turn settled, draft removed)
  const resultNotStreaming = filterHistoryMessages(messages, false);
  assert.equal(resultNotStreaming.length, 2);
  assert.equal(resultNotStreaming[0].id, 'm1');
  assert.equal(resultNotStreaming[1].id, 'm2');
  assert.equal(resultNotStreaming[1].status, 'complete');

  // Case 2: draft status is null/undefined
  const resultNullStatus = filterHistoryMessages(messages, null);
  assert.equal(resultNullStatus.length, 2);
  assert.equal(resultNullStatus[1].id, 'm2');

  // Case 3: message is complete even if draft state was somehow 'idle' or non-streaming
  const resultIdleStatus = filterHistoryMessages(messages, 'idle');
  assert.equal(resultIdleStatus.length, 2);
  assert.equal(resultIdleStatus[1].id, 'm2');
});

test('no unrelated messages are filtered out', () => {
  const m1 = makeMessage('m1', 'user', 'complete', 'first query');
  const m2 = makeMessage('m2', 'assistant', 'complete', 'first response');
  const m3 = makeMessage('m3', 'user', 'complete', 'second query');
  const m4 = makeMessage('m4', 'assistant', 'error', 'failed response');
  const m5 = makeMessage('m5', 'user', 'complete', 'third query');
  const placeholder = makeMessage('m6', 'assistant', 'streaming', 'third response in progress');

  const history = [m1, m2, m3, m4, m5, placeholder];

  // While streaming: only the trailing assistant placeholder is removed;
  // all prior user and assistant (complete or error) messages remain intact.
  const filteredStreaming = filterHistoryMessages(history, true);
  assert.equal(filteredStreaming.length, 5);
  assert.deepEqual(
    filteredStreaming.map((m) => m.id),
    ['m1', 'm2', 'm3', 'm4', 'm5'],
  );

  // When not streaming: every message is preserved.
  const filteredSettled = filterHistoryMessages(history, false);
  assert.equal(filteredSettled.length, 6);
  assert.deepEqual(
    filteredSettled.map((m) => m.id),
    ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'],
  );

  // Edge cases:
  // 1) Empty message list
  assert.deepEqual(filterHistoryMessages([], true), []);
  assert.deepEqual(filterHistoryMessages([], false), []);

  // 2) Last message is a user message while isStreaming is true (e.g., prompt just posted before draft placeholder)
  const userLast = [m1, m2, m3];
  const filteredUserLast = filterHistoryMessages(userLast, true);
  assert.equal(filteredUserLast.length, 3);
  assert.deepEqual(filteredUserLast.map((m) => m.id), ['m1', 'm2', 'm3']);

  // 3) Ensure the original array is not mutated
  const originalCopy = [...history];
  filterHistoryMessages(history, true);
  assert.deepEqual(history, originalCopy);
});
