/**
 * Pure merge semantics for the stream coalescer (`STREAM_BATCH_INTERVAL_MS` in
 * `ChatEngine`).
 *
 * Extracted from `ChatEngine` so the coalescing contract — which part keys are
 * allowed to merge, which never cross-merge, and that a written batch is
 * order-preserving — can be pinned by unit tests without a timer or a browser
 * window. These are the exact functions `ChatEngine.queueBufferedEvent` delegates
 * to; keeping them pure here means the "we coalesce chunks to cut IPC traffic"
 * claim cannot silently regress.
 */
import type { StreamEvent } from '../../../shared/contracts';

export type BufferedStreamEvent = Extract<
  StreamEvent,
  { type: 'chunk' | 'reasoning' | 'tool-input-delta' }
>;

/**
 * The Map key a coalesced event flushes under.
 *
 * Same type + same part id share a key and therefore merge; anything that
 * differs in type or id gets its own key and must never cross-merge.
 *
 * `tool-input-delta` intentionally shares a single key per (request, toolCallId)
 * regardless of how many input rows stream in, so partial tool input merges into
 * one row instead of flooding.
 */
export function getBufferedEventKey(event: BufferedStreamEvent): string {
  if (event.type === 'tool-input-delta') {
    return `message:${event.requestId}:tool:${event.toolCallId}`;
  }

  return `message:${event.requestId}:${event.type}:${event.id}`;
}

/**
 * Merge `next` into the existing coalesced event for the same key.
 *
 * Only a same-type delta merges (concatenates its text). A different type — even
 * for a key that looks related — never cross-merges: it overwrites. Reaching the
 * overwrite branch through the Map is essentially impossible (keys carry the
 * type), but the function is total so a caller can never get a type-union back.
 */
export function mergeBufferedEvents(
  existing: BufferedStreamEvent | undefined,
  next: BufferedStreamEvent
): BufferedStreamEvent {
  if (!existing) {
    return next;
  }

  if (existing.type === 'chunk' && next.type === 'chunk') {
    return {
      ...existing,
      delta: `${existing.delta}${next.delta}`
    };
  }

  if (existing.type === 'reasoning' && next.type === 'reasoning') {
    return {
      ...existing,
      delta: `${existing.delta}${next.delta}`
    };
  }

  if (existing.type === 'tool-input-delta' && next.type === 'tool-input-delta') {
    return {
      ...existing,
      delta: `${existing.delta}${next.delta}`
    };
  }

  return next;
}
