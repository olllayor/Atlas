import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConversationPage, StreamEvent, WorkLogEntry } from '../src/shared/contracts.js';
import {
  applyStreamingEvent,
  type RuntimeEventFanOut,
} from '../src/renderer/stores/streamEventReducers.js';
import {
  projectDraftSummaries,
  type DraftSummaryMap,
} from '../src/renderer/stores/draftSummaries.js';
import { countRunningAgents } from '../src/renderer/lib/agentActivity.js';
import { buildSidebarConversationItems } from '../src/renderer/components/sidebarViewModel.js';

/**
 * What the window must not do on a token.
 *
 * `App` subscribes to a handful of narrow, turn-level values; the transcript
 * subscribes to the live page and draft. These tests drive real stream events
 * through the real reducer and count how many times each of those subscriptions
 * would have woken its subscriber, which is the whole mechanism behind the
 * per-token whole-window render this suite exists to prevent.
 */

const CONVERSATION_ID = 'c1';
const REQUEST_ID = 'r1';
const STARTED_AT = new Date(0).toISOString();

function makePage(): ConversationPage {
  return {
    conversation: {
      id: CONVERSATION_ID,
      title: 'Ship the thing',
      createdAt: STARTED_AT,
      updatedAt: STARTED_AT,
    },
    messages: [
      {
        id: 'm1',
        conversationId: CONVERSATION_ID,
        role: 'assistant',
        content: '',
        reasoning: null,
        parts: [],
        status: 'streaming',
        providerId: null,
        modelId: null,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        latencyMs: null,
        errorCode: null,
        createdAt: STARTED_AT,
      },
    ],
    hasMore: false,
    nextCursor: null,
  } as unknown as ConversationPage;
}

function makeState(): RuntimeEventFanOut {
  return {
    draftsByConversation: {
      [CONVERSATION_ID]: {
        requestId: REQUEST_ID,
        providerId: 'openrouter',
        modelId: 'm1',
        parts: [],
        status: 'streaming',
        startedAt: STARTED_AT,
      },
    },
    conversationDetails: { [CONVERSATION_ID]: makePage() },
    requestToConversation: { [REQUEST_ID]: CONVERSATION_ID },
    runtimeSequenceByConversation: {},
    activitiesByConversation: {},
  };
}

/** Replay `count` text deltas, returning the state after each flush. */
function streamDeltas(count: number): RuntimeEventFanOut[] {
  let state = makeState();
  const frames: RuntimeEventFanOut[] = [];

  for (let index = 0; index < count; index += 1) {
    const event: StreamEvent = {
      type: 'chunk',
      requestId: REQUEST_ID,
      id: 'part-1',
      delta: `token-${index} `,
    } as StreamEvent;
    const patch = applyStreamingEvent(state, CONVERSATION_ID, event);
    state = { ...state, ...patch } as RuntimeEventFanOut;
    frames.push(state);
  }

  return frames;
}

const FLUSHES = 30;

test('a token replaces the draft and the page — the transcript has to re-render', () => {
  const frames = streamDeltas(FLUSHES);

  let draftChanges = 0;
  let detailChanges = 0;
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index]!.draftsByConversation !== frames[index - 1]!.draftsByConversation) draftChanges += 1;
    if (frames[index]!.conversationDetails !== frames[index - 1]!.conversationDetails) detailChanges += 1;
  }

  // The premise of the whole isolation exercise: these two maps really do move
  // on every flush, which is why nothing but the transcript may read them.
  assert.equal(draftChanges, FLUSHES - 1);
  assert.equal(detailChanges, FLUSHES - 1);
});

test('the values App subscribes to hold still across a whole response', () => {
  const frames = streamDeltas(FLUSHES);

  const titles = new Set<string | null>();
  const started = new Set<boolean>();
  const statuses = new Set<string | null>();
  const agentCounts = new Set<number>();

  for (const frame of frames) {
    titles.add(frame.conversationDetails[CONVERSATION_ID]?.conversation.title ?? null);
    started.add((frame.conversationDetails[CONVERSATION_ID]?.messages.length ?? 0) > 0);
    statuses.add(frame.draftsByConversation[CONVERSATION_ID]?.status ?? null);
    agentCounts.add(
      countRunningAgents(frame.activitiesByConversation?.[CONVERSATION_ID] as WorkLogEntry[] | undefined)
    );
  }

  // One distinct value each across thirty flushes means zero re-renders for
  // every App-level subscriber of these.
  assert.deepEqual([...titles], ['Ship the thing']);
  assert.deepEqual([...started], [true]);
  assert.deepEqual([...statuses], ['streaming']);
  assert.deepEqual([...agentCounts], [0]);
});

test('the draft summary keeps its identity across a whole response', () => {
  const frames = streamDeltas(FLUSHES);

  let summaries: DraftSummaryMap = {};
  let identityChanges = 0;

  for (const frame of frames) {
    const next = projectDraftSummaries(frame.draftsByConversation, summaries);
    if (next !== summaries) identityChanges += 1;
    summaries = next;
  }

  // Once, for the first projection. Every later flush returns the same object,
  // so the sidebar's subscription never fires.
  assert.equal(identityChanges, 1);
  assert.equal(summaries[CONVERSATION_ID]?.status, 'streaming');
  assert.equal(summaries[CONVERSATION_ID]?.hasPendingApproval, false);
});

test('the draft summary does change when the turn does', () => {
  const streaming = projectDraftSummaries({
    [CONVERSATION_ID]: {
      requestId: REQUEST_ID,
      providerId: 'openrouter',
      modelId: 'm1',
      parts: [],
      status: 'streaming',
      startedAt: STARTED_AT,
    },
  });

  const settled = projectDraftSummaries(
    {
      [CONVERSATION_ID]: {
        requestId: REQUEST_ID,
        providerId: 'openrouter',
        modelId: 'm1',
        parts: [],
        status: 'error',
        errorMessage: 'boom',
        startedAt: STARTED_AT,
      },
    },
    streaming
  );

  assert.notEqual(settled, streaming);
  assert.equal(settled[CONVERSATION_ID]?.status, 'error');

  // A conversation that goes away shrinks the map even though every surviving
  // entry compares equal.
  const emptied = projectDraftSummaries({}, settled);
  assert.notEqual(emptied, settled);
  assert.deepEqual(emptied, {});
});

test('a pending approval reaches the sidebar through the summary, not the parts', () => {
  const summaries = projectDraftSummaries({
    [CONVERSATION_ID]: {
      requestId: REQUEST_ID,
      providerId: 'openrouter',
      modelId: 'm1',
      parts: [
        {
          type: 'tool',
          state: 'approval-requested',
          toolCallId: 't1',
          toolName: 'bash',
        },
      ],
      status: 'streaming',
      startedAt: STARTED_AT,
    } as never,
  });

  assert.equal(summaries[CONVERSATION_ID]?.hasPendingApproval, true);

  const [item] = buildSidebarConversationItems({
    conversations: [
      {
        id: CONVERSATION_ID,
        title: 'Ship the thing',
        status: 'running',
        updatedAt: STARTED_AT,
      } as never,
    ],
    draftsByConversation: summaries,
    now: Date.parse('2026-01-01T00:00:00.000Z'),
  });

  assert.equal(item?.attention, 'needsInput');
});
