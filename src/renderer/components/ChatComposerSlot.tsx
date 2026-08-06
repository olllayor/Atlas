import { useCallback } from 'react';

import { EMPTY_COMPOSER_ATTACHMENTS, useAppStore } from '../stores/useAppStore';
import { Composer, type ComposerAttachment, type ComposerProps } from './Composer';

/**
 * Everything the composer needs that is *not* the half-typed message itself.
 * The four draft-owning props are removed because this component supplies
 * them, and `conversationId` replaces them as the only thing the caller has
 * to say about which draft is on screen.
 */
type ChatComposerSlotProps = Omit<
  ComposerProps,
  'value' | 'attachments' | 'onChange' | 'onAttachmentsChange'
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
  const setComposerDraft = useAppStore((state) => state.setComposerDraft);
  const setComposerAttachments = useAppStore((state) => state.setComposerAttachments);

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

  return (
    <Composer
      {...composerProps}
      attachments={attachments}
      onAttachmentsChange={handleAttachmentsChange}
      onChange={handleChange}
      value={value}
    />
  );
}
