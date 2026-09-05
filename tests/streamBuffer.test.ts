import assert from "node:assert/strict";
import test from "node:test";

import {
  coalesceStreamEvents,
  dropSupersededBufferedToolEvents,
  getBufferedEventKey,
  isBufferedStreamEvent,
  isToolCompletedEvent,
  mergeBufferedEvents,
  type BufferedStreamEvent,
} from "../src/main/ai/core/streamBuffer.js";
import type { StreamEvent } from "../src/shared/contracts.js";

/**
 * R1 — pin the 33ms stream coalescer (`STREAM_BATCH_INTERVAL_MS`) merge contract.
 *
 * `queueBufferedEvent` in ChatEngine coalesces every `chunk` / `reasoning` /
 * `tool-input-delta` / in-flight tool updates into one buffered row keyed by
 * `getBufferedEventKey` and merged by `mergeBufferedEvents` before flushing to the renderer.
 * These tests hold that contract: which keys merge, which never cross-merge, and that a
 * written batch preserves order.
 *
 * Additionally pins t3code PR #8368 parity:
 * - In-flight tool updates merge into the latest row per toolCallId
 * - Completions supersede preceding in-flight updates
 * - Anonymous calls without a toolCallId are preserved
 * - Order is preserved across flushes
 */

const REQUESTS = { rid: "request-1" };

function chunk(partial: { requestId?: string; id: string; delta: string }): BufferedStreamEvent {
  return { type: "chunk", requestId: REQUESTS.rid, ...partial };
}

function reasoning(partial: { requestId?: string; id: string; delta: string }): BufferedStreamEvent {
  return { type: "reasoning", requestId: REQUESTS.rid, ...partial };
}

function toolInputDelta(partial: {
  requestId?: string;
  toolCallId: string;
  delta: string;
}): BufferedStreamEvent {
  return { type: "tool-input-delta", requestId: REQUESTS.rid, ...partial };
}

function toolInputAvailable(partial: {
  requestId?: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
}): BufferedStreamEvent {
  return { type: "tool-input-available", requestId: REQUESTS.rid, ...partial };
}

function toolOutputAvailable(partial: {
  requestId?: string;
  toolCallId: string;
  toolName: string;
  output: unknown;
  preliminary?: boolean;
}): StreamEvent {
  return { type: "tool-output-available", requestId: REQUESTS.rid, ...partial };
}

test("two chunk deltas with the same part id and type merge into one row", () => {
  const a = chunk({ id: "part-1", delta: "Hel" });
  const b = chunk({ id: "part-1", delta: "lo" });

  assert.equal(getBufferedEventKey(a), getBufferedEventKey(b));
  const merged = mergeBufferedEvents(mergeBufferedEvents(undefined, a), b);
  assert.equal(merged.type, "chunk");
  assert.equal((merged as Extract<BufferedStreamEvent, { type: "chunk" }>).delta, "Hello");
});

test("two different part ids get different keys and never merge", () => {
  const a = chunk({ id: "part-1", delta: "Hel" });
  const b = chunk({ id: "part-2", delta: "World" });

  assert.notEqual(getBufferedEventKey(a), getBufferedEventKey(b));
  // Two independent rows, each holding its own text.
  assert.equal((mergeBufferedEvents(undefined, a) as { delta: string }).delta, "Hel");
  assert.equal((mergeBufferedEvents(undefined, b) as { delta: string }).delta, "World");
});

test("a chunk and a tool-input-delta for the same part never share a key", () => {
  const text = chunk({ id: "part-1", delta: "answer" });
  const tool = toolInputDelta({ toolCallId: "tool-1", delta: "{\"q\":1}" });

  assert.notEqual(getBufferedEventKey(text), getBufferedEventKey(tool));
});

test("a reasoning delta and a chunk delta never cross-merge, even with the same part id", () => {
  const thought = reasoning({ id: "part-1", delta: "hm" });
  const text = chunk({ id: "part-1", delta: "answer" });

  assert.notEqual(getBufferedEventKey(thought), getBufferedEventKey(text));

  // Direct merge (unreachable via the Map, but the function is total): the new
  // event wins, never a concatenation of a thought and an answer.
  const forced = mergeBufferedEvents(thought, text);
  assert.equal(forced.type, "chunk");
  assert.equal((forced as { delta: string }).delta, "answer");
});

test("all tool-input-deltas for one tool call share a key so input streams into one row", () => {
  const a = toolInputDelta({ toolCallId: "tool-1", delta: "{\"a\":" });
  const b = toolInputDelta({ toolCallId: "tool-1", delta: "1}" });

  assert.equal(getBufferedEventKey(a), getBufferedEventKey(b));
  const merged = mergeBufferedEvents(mergeBufferedEvents(undefined, a), b);
  assert.equal((merged as { delta: string }).delta, "{\"a\":1}");
});

test("two tool calls get distinct keys", () => {
  const a = toolInputDelta({ toolCallId: "tool-1", delta: "1" });
  const b = toolInputDelta({ toolCallId: "tool-2", delta: "2" });
  assert.notEqual(getBufferedEventKey(a), getBufferedEventKey(b));
});

test("a coalesced batch flushes in insertion order (Map preserves first-write order)", () => {
  const batch = new Map<string, BufferedStreamEvent>();
  const e1 = chunk({ id: "part-1", delta: "a" });
  const e2 = reasoning({ id: "part-r", delta: "r" });
  const e3 = chunk({ id: "part-1", delta: "b" });
  const e4 = toolInputDelta({ toolCallId: "tool-1", delta: "t" });

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
  assert.equal(rows.length, 3, "chunk merged into its earlier row, no new entry");
  assert.deepEqual(
    rows.map((r) => ({ t: r.type, d: (r as { delta: string }).delta })),
    [
      { t: "chunk", d: "ab" },
      { t: "reasoning", d: "r" },
      { t: "tool-input-delta", d: "t" },
    ],
    "first-write key order is preserved after a merge"
  );
});

test("a buffer with no prior entry returns the event unchanged", () => {
  const a = chunk({ id: "part-1", delta: "x" });
  assert.equal(mergeBufferedEvents(undefined, a), a);
});

/* -------------------------------------------------------------------------- */
/* t3code PR #8368 Parity: Live Tool-Update Coalescing & Superseding          */
/* -------------------------------------------------------------------------- */

test("preliminary tool-output-available events merge into the latest output for that toolCallId", () => {
  const a = toolOutputAvailable({ toolCallId: "call-1", toolName: "bash", output: "line 1\n", preliminary: true }) as BufferedStreamEvent;
  const b = toolOutputAvailable({ toolCallId: "call-1", toolName: "bash", output: "line 1\nline 2\n", preliminary: true }) as BufferedStreamEvent;

  assert.equal(getBufferedEventKey(a), getBufferedEventKey(b));
  const merged = mergeBufferedEvents(a, b);
  assert.equal(merged.type, "tool-output-available");
  assert.equal((merged as Extract<BufferedStreamEvent, { type: "tool-output-available" }>).output, "line 1\nline 2\n");
});

test("tool-input-available supersedes prior tool-input-delta for the same toolCallId", () => {
  const a = toolInputDelta({ toolCallId: "call-1", delta: "{\"path\":" });
  const b = toolInputAvailable({ toolCallId: "call-1", toolName: "read_file", input: { path: "/foo/bar" } });

  assert.equal(getBufferedEventKey(a), getBufferedEventKey(b));
  const merged = mergeBufferedEvents(a, b);
  assert.equal(merged.type, "tool-input-available");
  assert.deepEqual((merged as Extract<BufferedStreamEvent, { type: "tool-input-available" }>).input, { path: "/foo/bar" });
});

test("dropSupersededBufferedToolEvents purges in-flight updates when a tool completes", () => {
  const batch = new Map<string, BufferedStreamEvent>();
  const delta = toolInputDelta({ toolCallId: "call-1", delta: "{\"arg\":1}" });
  const preliminary = toolOutputAvailable({ toolCallId: "call-1", toolName: "bash", output: "partial", preliminary: true }) as BufferedStreamEvent;
  const otherCall = toolOutputAvailable({ toolCallId: "call-2", toolName: "bash", output: "call 2 output", preliminary: true }) as BufferedStreamEvent;

  batch.set(getBufferedEventKey(delta), delta);
  batch.set(getBufferedEventKey(preliminary), preliminary);
  batch.set(getBufferedEventKey(otherCall), otherCall);

  assert.equal(batch.size, 3);
  dropSupersededBufferedToolEvents(batch, REQUESTS.rid, "call-1");

  // Both delta and preliminary output for call-1 are purged; call-2 is retained
  assert.equal(batch.size, 1);
  assert.equal([...batch.values()][0]?.toolCallId, "call-2");
});

test("coalesceStreamEvents: coalesces rapid preliminary tool updates into latest per toolCallId", () => {
  const events: StreamEvent[] = [
    toolOutputAvailable({ toolCallId: "call-1", toolName: "bash", output: "chunk 1", preliminary: true }),
    toolOutputAvailable({ toolCallId: "call-2", toolName: "bash", output: "call 2 data", preliminary: true }),
    toolOutputAvailable({ toolCallId: "call-1", toolName: "bash", output: "chunk 1 + 2", preliminary: true }),
  ];

  const coalesced = coalesceStreamEvents(events);
  assert.equal(coalesced.length, 2);
  assert.equal((coalesced[0] as Extract<StreamEvent, { type: "tool-output-available" }>).toolCallId, "call-1");
  assert.equal((coalesced[0] as Extract<StreamEvent, { type: "tool-output-available" }>).output, "chunk 1 + 2");
  assert.equal((coalesced[1] as Extract<StreamEvent, { type: "tool-output-available" }>).toolCallId, "call-2");
});

test("coalesceStreamEvents: terminal completion supersedes preceding in-flight updates", () => {
  const events: StreamEvent[] = [
    toolOutputAvailable({ toolCallId: "call-1", toolName: "bash", output: "running...", preliminary: true }),
    toolOutputAvailable({ toolCallId: "call-1", toolName: "bash", output: "final result", preliminary: false }),
  ];

  const coalesced = coalesceStreamEvents(events);
  assert.equal(coalesced.length, 1);
  assert.equal(coalesced[0].type, "tool-output-available");
  assert.equal((coalesced[0] as Extract<StreamEvent, { type: "tool-output-available" }>).preliminary, false);
  assert.equal((coalesced[0] as Extract<StreamEvent, { type: "tool-output-available" }>).output, "final result");
});

test("coalesceStreamEvents: preserves anonymous tool calls without a stable toolCallId", () => {
  const anon1 = toolOutputAvailable({ toolCallId: "", toolName: "bash", output: "step 1", preliminary: true });
  const anon2 = toolOutputAvailable({ toolCallId: "", toolName: "bash", output: "step 2", preliminary: true });

  const coalesced = coalesceStreamEvents([anon1, anon2]);
  assert.equal(coalesced.length, 2, "anonymous calls must not coalesce or overwrite each other");
});

test("coalesceStreamEvents: flushes pending tool updates before non-update boundaries", () => {
  const events: StreamEvent[] = [
    toolOutputAvailable({ toolCallId: "call-1", toolName: "bash", output: "running", preliminary: true }),
    { type: "notice", message: "retrying" },
    toolOutputAvailable({ toolCallId: "call-1", toolName: "bash", output: "done", preliminary: false }),
  ];

  const coalesced = coalesceStreamEvents(events);
  assert.equal(coalesced.length, 3);
  assert.equal(coalesced[0].type, "tool-output-available");
  assert.equal(coalesced[1].type, "notice");
  assert.equal(coalesced[2].type, "tool-output-available");
});
