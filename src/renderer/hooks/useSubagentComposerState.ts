import { useCallback, useEffect, useRef, useState } from 'react';

import type { SubagentComposerState } from '../../shared/contracts';
import { useAppStore } from '../stores/useAppStore';

/**
 * Composer takeover for subagent conversations (plan §3.5).
 *
 * An ordinary conversation renders the normal composer and sends through the
 * chat path. A subagent conversation must not: a one-shot child has no inbox
 * to receive anything, and a continuable child only accepts turns its exact
 * parent authorizes via `subagents:followup`. This hook decides which of the
 * two worlds the composer is in.
 */
export type SubagentComposerTakeover =
  | { mode: 'normal' }
  /** No input at all — the transcript is an execution record. */
  | { mode: 'readOnly'; reason: string }
  /** Parent can authorize followups: normal input, send queues as next FIFO turn. */
  | { mode: 'live'; running: boolean }
  /**
   * Parent gone but a live activation is still working: nothing new can be
   * queued, Stop still reaches the running turn.
   */
  | { mode: 'interruptOnly' };

const ONE_SHOT_REASON = 'This execution record is read-only.';
const ORPHANED_REASON =
  'The parent conversation is gone, so this session can no longer continue. The transcript stays available read-only.';
const INTERRUPT_ONLY_HINT =
  "The parent conversation is gone, so new messages can't be queued.";

/** How often live activation state is re-read while a child view is open. */
const POLL_MS = 2000;
/** Transcript refetch cadence while the child is mid-turn. */
const SYNC_MS = 2500;

export function useSubagentComposerState(conversationId: string | null): SubagentComposerTakeover {
  const detail = useAppStore((state) =>
    conversationId ? state.conversationDetails[conversationId] : undefined
  );
  const origin = detail?.conversation.origin ?? null;
  const subagentMode = detail?.conversation.subagentMode ?? null;

  const [remote, setRemote] = useState<SubagentComposerState | null>(null);
  const wasRunningRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!conversationId) return;
    try {
      const next = await window.atlasChat.subagents.getComposerState(conversationId);
      // Two booleans, re-read every two seconds, almost always unchanged.
      // Committing the fresh object anyway re-rendered App on every poll for
      // as long as a child conversation was open.
      setRemote((previous) =>
        previous &&
        next &&
        previous.parentAvailable === next.parentAvailable &&
        previous.running === next.running
          ? previous
          : next
      );
    } catch {
      // Keep the last known state; the next poll retries.
    }
  }, [conversationId]);

  // Conversation switch resets the cached answer so one child's liveness
  // never paints onto another's composer.
  useEffect(() => {
    setRemote(null);
    void refresh();
  }, [refresh]);

  const isSubagent = origin === 'subagent' && subagentMode != null;

  useEffect(() => {
    if (!isSubagent) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [isSubagent, refresh]);

  // While the child is mid-turn its transcript grows outside the ordinary
  // request/stream plumbing (no push event carries continuable turn events),
  // so poll the page itself until the turn settles, then land one final
  // reload that captures the completed message.
  useEffect(() => {
    if (!isSubagent || subagentMode !== 'continuable') return;
    if (!remote?.running) return;
    const store = useAppStore.getState;
    const sync = setInterval(() => {
      if (conversationId) void store().reloadConversationDetail(conversationId);
    }, SYNC_MS);
    return () => clearInterval(sync);
  }, [isSubagent, subagentMode, remote?.running, conversationId]);

  useEffect(() => {
    if (!isSubagent || !conversationId) return;
    if (wasRunningRef.current && remote && !remote.running) {
      void useAppStore.getState().reloadConversationDetail(conversationId);
    }
    wasRunningRef.current = Boolean(remote?.running);
  }, [isSubagent, conversationId, remote]);

  if (!detail || origin !== 'subagent') return { mode: 'normal' };

  if (subagentMode !== 'continuable') {
    return { mode: 'readOnly', reason: ONE_SHOT_REASON };
  }

  // Before the first IPC round trip assume the common case (parent available)
  // rather than flashing a read-only slab on every open.
  const state = remote ?? { parentAvailable: true, running: false };

  if (state.parentAvailable) {
    return { mode: 'live', running: state.running };
  }
  if (state.running) {
    return { mode: 'interruptOnly' };
  }
  return { mode: 'readOnly', reason: ORPHANED_REASON };
}

export const SUBAGENT_INTERRUPT_ONLY_HINT = INTERRUPT_ONLY_HINT;
