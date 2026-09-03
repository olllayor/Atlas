import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ConversationPage, StreamEvent } from '../src/shared/contracts.js';
import {
  applyStreamingEvent,
  type RuntimeEventFanOut,
} from '../src/renderer/stores/streamEventReducers.js';

/**
 * ARCHITECTURE INVARIANT: the composer stays off the token path.
 *
 * Typing benchmarks showed ~26 ms keyboard-to-paint during 33 ms active
 * streaming (delta ~+1.9 ms over idle) with Composer React commits under
 * 0.1 ms, because `ChatComposerSlot` subscribes to turn identity
 * (`requestId`, `status`) rather than live `parts`. `parts` is replaced on
 * every stream flush; anything reading it re-renders thirty times a second.
 * Future features (streaming meters, token counters, inline tool previews)
 * must follow the same subscriber pattern. These tests fail loudly if the
 * composer or its slot rebinds to the raw token stream.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPOSER_PATH = path.resolve(__dirname, '../src/renderer/components/Composer.tsx');
const SLOT_PATH = path.resolve(__dirname, '../src/renderer/components/ChatComposerSlot.tsx');

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
    const event = {
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

/** Mirror of the selectors `ChatComposerSlot` uses. */
function selectComposerInputs(state: RuntimeEventFanOut) {
  const draft = state.draftsByConversation[CONVERSATION_ID];
  return {
    draftRequestId: draft?.requestId ?? null,
    draftStatus: draft?.status ?? null,
  };
}

const FLUSHES = 30;

test('the values the composer subscribes to hold still across a whole response', () => {
  const frames = streamDeltas(FLUSHES);

  // Sanity: tokens really did flow (the transcript draft moves every flush).
  let partChanges = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const before = frames[index - 1]!.draftsByConversation[CONVERSATION_ID]?.parts;
    const after = frames[index]!.draftsByConversation[CONVERSATION_ID]?.parts;
    if (before !== after) partChanges += 1;
  }
  assert.equal(partChanges, FLUSHES - 1);

  const requestIds = new Set<string | null>();
  const statuses = new Set<string | null>();
  for (const frame of frames) {
    const inputs = selectComposerInputs(frame);
    requestIds.add(inputs.draftRequestId);
    statuses.add(inputs.draftStatus);
  }

  // One distinct value each across thirty flushes: the slot never refires, so
  // the Composer (and the context meter keyed off `turnKey`) never re-renders.
  assert.deepEqual([...requestIds], [REQUEST_ID]);
  assert.deepEqual([...statuses], ['streaming']);
});

test('ChatComposerSlot subscribes to turn identity only, never token content', () => {
  const source = fs.readFileSync(SLOT_PATH, 'utf8');

  const accessed = new Set<string>();
  for (const match of source.matchAll(/draftsByConversation\[[^\]]+\]\?\.\s*(\w+)/g)) {
    accessed.add(match[1]!);
  }

  assert.ok(accessed.size > 0, 'Expected the slot to read the draft store');
  for (const field of accessed) {
    assert.ok(
      field === 'requestId' || field === 'status',
      `ChatComposerSlot reads draftsByConversation.${field}: subscribe to turn identity (requestId/status), never token content`,
    );
  }

  assert.ok(
    !source.includes('.parts'),
    'ChatComposerSlot must not touch `.parts`: that array is replaced on every 33ms flush',
  );
});

test('Composer never reads the draft store and exposes no token-stream props', () => {
  const source = fs.readFileSync(COMPOSER_PATH, 'utf8');

  assert.ok(
    !source.includes('draftsByConversation'),
    'Composer must not subscribe to draftsByConversation: receive turn identity via props from ChatComposerSlot',
  );

  const propsStart = source.indexOf('export type ComposerProps');
  assert.ok(propsStart !== -1, 'Expected to find ComposerProps in Composer.tsx');
  const propsBlock = source.slice(propsStart, source.indexOf('\n};', propsStart));
  const fieldNames = [...propsBlock.matchAll(/^\s*(\w+)\s*\??:/gm)].map((m) => m[1]!);
  assert.ok(fieldNames.length > 0, 'Expected to parse field names out of ComposerProps');

  const forbidden = new Set([
    'parts',
    'tokens',
    'inputTokens',
    'outputTokens',
    'delta',
    'deltas',
    'streamingText',
    'streamingParts',
    'liveParts',
    'draft',
  ]);
  for (const field of fieldNames) {
    assert.ok(
      !forbidden.has(field),
      `ComposerProps.${field} binds the composer to the token stream: pass turn identity (draftRequestId/draftStatus) instead`,
    );
  }

  const draftFields = fieldNames.filter((name) => name === 'draftRequestId' || name === 'draftStatus');
  assert.deepEqual(
    [...draftFields].sort(),
    ['draftRequestId', 'draftStatus'],
    'Composer must receive exactly draftRequestId + draftStatus as its turn identity',
  );
});
