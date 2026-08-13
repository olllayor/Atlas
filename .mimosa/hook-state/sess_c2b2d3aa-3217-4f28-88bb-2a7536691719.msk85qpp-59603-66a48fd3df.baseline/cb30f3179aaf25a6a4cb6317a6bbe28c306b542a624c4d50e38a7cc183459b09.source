/**
 * Notices are the fix for a turn that retried three times in silence: the
 * transcript could only say "Thinking" because nothing between `turn.started`
 * and the eventual failure was expressible as an event.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRetryNotice } from '../src/main/ai/core/ChatSessionRuntime';
import {
  applyNoticeEvent,
  applyStreamingEvent,
  type RuntimeEventFanOut,
} from '../src/renderer/stores/streamEventReducers';

function stateWithDraft(overrides: Record<string, unknown> = {}): RuntimeEventFanOut {
  return {
    draftsByConversation: {
      c1: {
        requestId: 'r1',
        providerId: 'custom:one',
        modelId: 'model-a',
        parts: [],
        status: 'streaming',
        startedAt: '2026-07-31T00:00:00.000Z',
        ...overrides,
      },
    },
    conversationDetails: {},
    requestToConversation: { r1: 'c1' },
    runtimeSequenceByConversation: {},
  } as RuntimeEventFanOut;
}

test('a notice lands on the live draft', () => {
  const patch = applyNoticeEvent(stateWithDraft(), 'c1', {
    type: 'notice',
    requestId: 'r1',
    code: 'retrying',
    level: 'warning',
    message: 'The provider did not respond in time. Retrying — Attempt 2 of 2.',
  });

  assert.deepEqual(patch?.draftsByConversation?.c1?.notice, {
    code: 'retrying',
    level: 'warning',
    message: 'The provider did not respond in time. Retrying — Attempt 2 of 2.',
  });
});

test('a notice for a conversation with nothing in flight is dropped', () => {
  const state = stateWithDraft();
  const patch = applyNoticeEvent(state, 'c-other', {
    type: 'notice',
    requestId: 'r1',
    code: 'retrying',
    level: 'warning',
    message: 'Retrying.',
  });

  assert.equal(patch, null);
});

test('the first token clears the notice', () => {
  const state = stateWithDraft({
    notice: { code: 'retrying', level: 'warning', message: 'Retrying.' },
  });

  const patch = applyStreamingEvent(state, 'c1', {
    type: 'chunk',
    requestId: 'r1',
    id: 'assistant-text',
    delta: 'Hello',
  });

  assert.equal(patch?.draftsByConversation?.c1?.notice, null);
});

test('retry copy names the reason and the position in the sequence', () => {
  assert.equal(
    buildRetryNotice('timeout', 1, 1),
    'The provider did not respond in time. Retrying — Attempt 2 of 2.',
  );
  assert.match(buildRetryNotice('rate_limited', 1, 3), /rate limiting/);
  assert.match(buildRetryNotice('network_error', 2, 3), /connection .* dropped/);
  // An unrecognised code still produces a sentence rather than a bare code.
  assert.match(buildRetryNotice('something_new', 1, 3), /^The request failed and is being retried/);
});
