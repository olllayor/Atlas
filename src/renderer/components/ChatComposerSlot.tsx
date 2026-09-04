import { useCallback } from 'react';

import { EMPTY_COMPOSER_ATTACHMENTS, EMPTY_COMPOSER_CITATIONS, selectQueuedFollowups, useAppStore } from '../stores/useAppStore';
import { Composer, type ComposerAttachment, type ComposerProps } from './Composer';
import type { CitedQuoteEntry } from '../../shared/citations';
import { QueueDock } from './transcript/QueueDock';
import { GoalDock } from './goal/GoalDock';

/**
 * Everything the composer needs that is *not* the half-typed message itself.
 * The four draft-owning props are removed because this component supplies
 * them, and `conversationId` replaces them as the only thing the caller has
 * to say about which draft is on screen.
 */
type ChatComposerSlotProps = Omit<
  ComposerProps,
  | 'value'
  | 'attachments'
  | 'onChange'
  | 'onAttachmentsChange'
  | 'citations'
  | 'onCitationsChange'
  | 'conversationId'
  | 'draftRequestId'
  | 'draftStatus'
  | 'isStreaming'
> & {
  conversationId: string | null;
};

/**
 * Owns the composer's subscription to the draft store, and exists only to own it.
 *
 * `App` reads the store through a single `useShallow` selector covering most of
 * the app's state. That is fine for state that changes when something happens,
 * and ruinous for state that changes while you type: `setComposerDraft` replaces
 * `composerDraftsByConversation` on every keystroke, the shallow compare sees a
 * new reference, and `App` re-renders — taking the sidebar, the transcript and
 * the workbench with it, none of which are memoised and none of which care what
 * is in the composer. One character of typing re-rendered the entire window.
 *
 * Reading the two draft slices *here* instead confines that to this subtree.
 * Nothing else in `App` ever read them — they only ever reached `<Composer>` —
 * so nothing above needs them and nothing below changes.
 *
 * Deliberately not wrapped in `memo`: the caller passes fresh closures for
 * `onSend`, `onAbort` and friends on every one of its own renders, so a memo
 * here would compare unequal every time and buy nothing but the illusion of a
 * fast path. The win is that `App` no longer renders on keystroke *at all*.
 */
export function ChatComposerSlot({ conversationId, ...composerProps }: ChatComposerSlotProps) {
  // Two narrow selectors rather than one object: a selector returning a fresh
  // object would re-render on every store write regardless of what changed.
  const value = useAppStore((state) =>
    conversationId ? state.composerDraftsByConversation[conversationId] ?? '' : ''
  );
  // The `??` falls back to a module-level constant, so a conversation with no
  // staged files yields the *same* array every time and the identity is stable.
  const attachments = useAppStore((state) =>
    conversationId
      ? state.composerAttachmentsByConversation[conversationId] ?? EMPTY_COMPOSER_ATTACHMENTS
      : EMPTY_COMPOSER_ATTACHMENTS
  );
  const citations = useAppStore((state) =>
    conversationId
      ? state.composerCitationsByConversation[conversationId] ?? EMPTY_COMPOSER_CITATIONS
      : EMPTY_COMPOSER_CITATIONS
  );
  /*
    Turn identity, not turn content. `draftsByConversation` is replaced on every
    33ms stream flush; these two fields change when a request starts, settles or
    fails. Subscribing to them instead keeps the composer — and the context
    meter it owns — off the token path.
  */
  const draftRequestId = useAppStore((state) =>
    conversationId ? state.draftsByConversation[conversationId]?.requestId ?? null : null
  );
  const draftStatus = useAppStore((state) =>
    conversationId ? state.draftsByConversation[conversationId]?.status ?? null : null
  );
  const setComposerDraft = useAppStore((state) => state.setComposerDraft);
  const setComposerAttachments = useAppStore((state) => state.setComposerAttachments);
  const setComposerCitations = useAppStore((state) => state.setComposerCitations);
  const cancelQueuedFollowup = useAppStore((state) => state.cancelQueuedFollowup);
  // Queued follow-ups for this thread — the dock between transcript and slab.
  const queuedFollowups = useAppStore((state) => selectQueuedFollowups(state, conversationId));
  const handleChange = useCallback(
    (next: string) => {
      if (conversationId) {
        setComposerDraft(conversationId, next);
      }
    },
    [conversationId, setComposerDraft]
  );

  const handleAttachmentsChange = useCallback(
    (updater: (previous: ComposerAttachment[]) => ComposerAttachment[]) => {
      if (conversationId) {
        setComposerAttachments(conversationId, updater);
      }
    },
    [conversationId, setComposerAttachments]
  );

  const handleCitationsChange = useCallback(
    (updater: (previous: CitedQuoteEntry[]) => CitedQuoteEntry[]) => {
      if (conversationId) {
        setComposerCitations(conversationId, updater);
      }
    },
    [conversationId, setComposerCitations]
  );

  return (
    <>
      <GoalDock conversationId={conversationId} />
      <QueueDock
        entries={queuedFollowups}
        onCancel={(requestId) => void cancelQueuedFollowup(requestId)}
      />
      <Composer
        {...composerProps}
        conversationId={conversationId}
        draftRequestId={draftRequestId}
        draftStatus={draftStatus}
        isStreaming={draftStatus === 'streaming'}
        queuedCount={queuedFollowups.length}
        attachments={attachments}
        onAttachmentsChange={handleAttachmentsChange}
        citations={citations}
        onCitationsChange={handleCitationsChange}
        onChange={handleChange}
        value={value}
      />
    </>
  );
}
