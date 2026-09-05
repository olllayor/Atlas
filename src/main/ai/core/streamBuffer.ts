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
 *
 * Extended with bounded-window tool-update coalescing (modeled after t3code PR #8368):
 * in-flight tool updates (e.g. streaming command stdout or partial tool arguments)
 * are coalesced per tool-call ID, completions supersede preceding in-flight updates,
 * and boundary events trigger immediate flushes.
 */
import { randomUUID } from 'node:crypto';
import type { StreamEvent } from '../../../shared/contracts';

export const MAX_PENDING_UPDATES = 512;

export type BufferedStreamEvent =
  | Extract<StreamEvent, { type: 'chunk' | 'reasoning' | 'tool-input-delta' | 'tool-input-available' }>
  | (Extract<StreamEvent, { type: 'tool-output-available' }> & { preliminary: true });

export function isBufferedStreamEvent(event: StreamEvent): event is BufferedStreamEvent {
  if (
    event.type === 'chunk' ||
    event.type === 'reasoning' ||
    event.type === 'tool-input-delta' ||
    event.type === 'tool-input-available'
  ) {
    return true;
  }

  if (event.type === 'tool-output-available' && Boolean(event.preliminary)) {
    return true;
  }

  return false;
}

export function isToolCompletedEvent(
  event: StreamEvent
): event is Extract<
  StreamEvent,
  { type: 'tool-output-available' | 'tool-output-error' | 'tool-output-denied' }
> {
  if (event.type === 'tool-output-error' || event.type === 'tool-output-denied') {
    return true;
  }

  if (event.type === 'tool-output-available' && !event.preliminary) {
    return true;
  }

  return false;
}

/**
 * The Map key a coalesced event flushes under.
 *
 * Same type + same part id share a key and therefore merge; anything that
 * differs in type or id gets its own key and must never cross-merge.
 *
 * `tool-input-delta` and `tool-input-available` share a key per (request, toolCallId)
 * so partial or updated tool inputs merge into one row instead of flooding.
 * Anonymous calls (missing/empty toolCallId) receive unique keys so they pass through.
 */
export function getBufferedEventKey(event: BufferedStreamEvent): string {
  if (event.type === 'tool-input-delta' || event.type === 'tool-input-available') {
    if (!event.toolCallId || event.toolCallId.trim() === '') {
      return `message:${event.requestId}:tool:anon:${randomUUID()}`;
    }
    return `message:${event.requestId}:tool:${event.toolCallId}`;
  }

  if (event.type === 'tool-output-available') {
    if (!event.toolCallId || event.toolCallId.trim() === '') {
      return `message:${event.requestId}:tool-output:anon:${randomUUID()}`;
    }
    return `message:${event.requestId}:tool-output:${event.toolCallId}`;
  }

  return `message:${event.requestId}:${event.type}:${event.id}`;
}

/**
 * Merge `next` into the existing coalesced event for the same key.
 *
 * Only a same-type delta merges (concatenates its text). For structured tool updates
 * (like tool-input-available or preliminary tool-output-available), the newer update
 * supersedes the older in-flight state.
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

  if (existing.type === 'tool-output-available' && next.type === 'tool-output-available') {
    return next;
  }

  if (existing.type === 'tool-input-available' && next.type === 'tool-input-available') {
    return next;
  }

  return next;
}

/**
 * Removes any in-flight pending updates for the given `toolCallId` from the buffered map,
 * matching t3code PR #8368 where completion supersedes preceding in-flight updates.
 */
export function dropSupersededBufferedToolEvents(
  bufferedMap: Map<string, BufferedStreamEvent>,
  requestId: string,
  toolCallId: string | null | undefined
): void {
  if (!toolCallId || toolCallId.trim() === '') {
    return;
  }

  for (const [key, event] of bufferedMap.entries()) {
    if (
      (event.type === 'tool-input-delta' ||
        event.type === 'tool-input-available' ||
        event.type === 'tool-output-available') &&
      event.requestId === requestId &&
      event.toolCallId === toolCallId
    ) {
      bufferedMap.delete(key);
    }
  }
}

/**
 * Coalesces a sequence of stream events using bounded window coalescing:
 * - Keeps the newest tool update for each stable toolCallId
 * - Drops in-flight tool updates when superseded by a completion event
 * - Preserves anonymous tool calls without stable toolCallId
 * - Preserves sequence order of surviving events
 */
export function coalesceStreamEvents(
  events: ReadonlyArray<StreamEvent>
): StreamEvent[] {
  const survivors: StreamEvent[] = [];
  const pendingToolUpdates = new Map<string, BufferedStreamEvent>();

  const flushPending = () => {
    if (pendingToolUpdates.size === 0) return;
    for (const event of pendingToolUpdates.values()) {
      survivors.push(event);
    }
    pendingToolUpdates.clear();
  };

  for (const event of events) {
    if (isToolCompletedEvent(event)) {
      if (event.toolCallId) {
        dropSupersededBufferedToolEvents(pendingToolUpdates, event.requestId, event.toolCallId);
      }
      flushPending();
      survivors.push(event);
      continue;
    }

    if (isBufferedStreamEvent(event)) {
      const key = getBufferedEventKey(event);
      const existing = pendingToolUpdates.get(key);
      pendingToolUpdates.set(key, mergeBufferedEvents(existing, event));

      if (pendingToolUpdates.size >= MAX_PENDING_UPDATES) {
        flushPending();
      }
      continue;
    }

    // Boundary event flushes pending updates
    flushPending();
    survivors.push(event);
  }

  flushPending();
  return survivors;
}
