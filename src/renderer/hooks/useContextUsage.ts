import { useEffect, useRef, useState } from 'react';

import type { ContextUsageSnapshot, GetContextUsageRequest, ToolPermissionMode } from '../../shared/contracts';

/**
 * Prompt size for the next request, measured by the main process.
 *
 * The renderer cannot compute this: it sees the transcript, but the prompt is
 * the transcript *after* `ContextManager` compresses older turns, plus a system
 * prompt and tool schemas it never receives. So this pulls the number from the
 * process that builds the request instead of re-deriving a different one.
 *
 * Refetches when the conversation, model, tool settings or turn state change.
 * Composer keystrokes are debounced — the pending text moves the number, but
 * not once per character.
 */

/** Long enough that ordinary typing does not queue a request per keystroke. */
const PENDING_TEXT_DEBOUNCE_MS = 250;

export type ContextUsageInput = {
  conversationId: string | null;
  modelId: string | null;
  providerId?: string | null;
  enableTools: boolean;
  toolPermissionMode: ToolPermissionMode;
  pendingText: string;
  pendingAttachments: GetContextUsageRequest['pendingAttachments'];
  /**
   * Changes once per turn boundary. Streaming deltas must not refetch — the
   * request is already in flight and its prompt is fixed — but the moment a
   * turn lands, history grew and the snapshot is stale.
   */
  turnKey: string;
};

export function useContextUsage({
  conversationId,
  modelId,
  providerId,
  enableTools,
  toolPermissionMode,
  pendingText,
  pendingAttachments,
  turnKey,
}: ContextUsageInput): ContextUsageSnapshot | null {
  const [snapshot, setSnapshot] = useState<ContextUsageSnapshot | null>(null);

  // Attachment identity changes on every render of the parent's array literal;
  // a stable signature keeps that from retriggering the effect.
  const attachmentSignature = (pendingAttachments ?? [])
    .map((item) => `${item.mediaType ?? ''}:${item.previewWidth ?? 0}x${item.previewHeight ?? 0}`)
    .join('|');

  const attachmentsRef = useRef(pendingAttachments);
  attachmentsRef.current = pendingAttachments;

  useEffect(() => {
    if (!conversationId || !modelId) {
      setSnapshot(null);
      return;
    }

    let cancelled = false;

    const run = () => {
      void window.atlasChat.chat
        .getContextUsage({
          conversationId,
          modelId,
          providerId: providerId ?? undefined,
          enableTools,
          toolPermissionMode,
          pendingText,
          pendingAttachments: attachmentsRef.current,
        })
        .then((next) => {
          if (!cancelled) {
            setSnapshot(next);
          }
        })
        .catch(() => {
          // A model missing from the catalog has no window to measure against;
          // the control hides itself rather than showing a wrong number.
          if (!cancelled) {
            setSnapshot(null);
          }
        });
    };

    // Only the typing path needs to wait; everything else should land at once.
    const timer = pendingText ? setTimeout(run, PENDING_TEXT_DEBOUNCE_MS) : null;
    if (!timer) {
      run();
    }

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [
    conversationId,
    modelId,
    providerId,
    enableTools,
    toolPermissionMode,
    pendingText,
    attachmentSignature,
    turnKey,
  ]);

  return snapshot;
}
