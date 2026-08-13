import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getBufferedEventKey,
  mergeBufferedEvents,
  type BufferedStreamEvent,
} from '../src/main/ai/core/streamBuffer.js';

/**
 * R1 — pin the 33ms stream coalescer (`STREAM_BATCH_INTERVAL_MS`) merge contract.
 *
 * `queueBufferedEvent` in ChatEngine coalesces every `chunk` / `reasoning` /
 * `tool-input-delta` into one buffered row keyed by `getBufferedEventKey` and
 * merged by `mergeBufferedEvents` before flushing to the renderer. These tests
 * hold that contract: which keys merge, which never cross-merge, and that a
 * written batch preserves order.
 */

const REQUESTS = { rid: 'request-1' };

function chunk(partial: { requestId?: string; id: string; delta: string }): BufferedStreamEvent {
  return { type: 'chunk', requestId: REQUESTS.rid, ...partial };
}

function reasoning(partial: { requestId?: string; id: string; delta: string }): BufferedStreamEvent {
  return { type: 'reasoning', requestId: REQUESTS.rid, ...partial };
}

function toolInputDelta(partial: {
  requestId?: string;
  toolCallId: string;
  delta: string;
}): BufferedStreamEvent {
  return { type: 'tool-input-delta', requestId: REQUESTS.rid, ...partial };
}

test('two chunk deltas with the same part id and type merge into one row', () => {
  const a = chunk({ id: 'part-1', delta: 'Hel' });
  const b = chunk({ id: 'part-1', delta: 'lo' });

  assert.equal(getBufferedEventKey(a), getBufferedEventKey(b));
  const merged = mergeBufferedEvents(mergeBufferedEvents(undefined, a), b);
  assert.equal(merged.type, 'chunk');
  assert.equal((merged as Extract<BufferedStreamEvent, { type: 'chunk' }>).delta, 'Hello');
});

test('two different part ids get different keys and never merge', () => {
  const a = chunk({ id: 'part-1', delta: 'Hel' });
  const b = chunk({ id: 'part-2', delta: 'World' });

  assert.notEqual(getBufferedEventKey(a), getBufferedEventKey(b));
  // Two independent rows, each holding its own text.
  assert.equal((mergeBufferedEvents(undefined, a) as { delta: string }).delta, 'Hel');
  assert.equal((mergeBufferedEvents(undefined, b) as { delta: string }).delta, 'World');
});

test('a chunk and a tool-input-delta for the same part never share a key', () => {
  const text = chunk({ id: 'part-1', delta: 'answer' });
  const tool = toolInputDelta({ toolCallId: 'tool-1', delta: '{"q":1}' });

  assert.notEqual(getBufferedEventKey(text), getBufferedEventKey(tool));
});

test('a reasoning delta and a chunk delta never cross-merge, even with the same part id', () => {
  const thought = reasoning({ id: 'part-1', delta: 'hm' });
  const text = chunk({ id: 'part-1', delta: 'answer' });

  assert.notEqual(getBufferedEventKey(thought), getBufferedEventKey(text));

  // Direct merge (unreachable via the Map, but the function is total): the new
  // event wins, never a concatenation of a thought and an answer.
  const forced = mergeBufferedEvents(thought, text);
  assert.equal(forced.type, 'chunk');
  assert.equal((forced as { delta: string }).delta, 'answer');
});

test('all tool-input-deltas for one tool call share a key so input streams into one row', () => {
  const a = toolInputDelta({ toolCallId: 'tool-1', delta: '{"a":' });
  const b = toolInputDelta({ toolCallId: 'tool-1', delta: '1}' });

  assert.equal(getBufferedEventKey(a), getBufferedEventKey(b));
  const merged = mergeBufferedEvents(mergeBufferedEvents(undefined, a), b);
  assert.equal((merged as { delta: string }).delta, '{"a":1}');
});

test('two tool calls get distinct keys', () => {
  const a = toolInputDelta({ toolCallId: 'tool-1', delta: '1' });
  const b = toolInputDelta({ toolCallId: 'tool-2', delta: '2' });
  assert.notEqual(getBufferedEventKey(a), getBufferedEventKey(b));
});

test('a coalesced batch flushes in insertion order (Map preserves first-write order)', () => {
  const batch = new Map<string, BufferedStreamEvent>();
  const e1 = chunk({ id: 'part-1', delta: 'a' });
  const e2 = reasoning({ id: 'part-r', delta: 'r' });
  const e3 = chunk({ id: 'part-1', delta: 'b' });
  const e4 = toolInputDelta({ toolCallId: 'tool-1', delta: 't' });

  // Simulate queueBufferedEvent: key + merge into the map.
  const write = (e: BufferedStreamEvent) => {
    const key = getBufferedEventKey(e);
    batch.set(key, mergeBufferedEvents(batch.get(key), e));
  };
  write(e1);
  write(e2);
  write(e3);
  write(e4);

  const rows = [...batch.values()];
  assert.equal(rows.length, 3, 'chunk merged into its earlier row, no new entry');
  assert.deepEqual(
    rows.map((r) => ({ t: r.type, d: (r as { delta: string }).delta })),
    [
      { t: 'chunk', d: 'ab' },
      { t: 'reasoning', d: 'r' },
      { t: 'tool-input-delta', d: 't' },
    ],
    'first-write key order is preserved after a merge'
  );
});

test('a buffer with no prior entry returns the event unchanged', () => {
  const a = chunk({ id: 'part-1', delta: 'x' });
  assert.equal(mergeBufferedEvents(undefined, a), a);
});
