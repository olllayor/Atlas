import { ChatWindow, type ChatWindowProps } from './ChatWindow';
import { useAppStore } from '../stores/useAppStore';

type ChatWindowSlotProps = Omit<ChatWindowProps, 'detail' | 'draft'> & {
  conversationId: string | null;
};

/**
 * Owns the transcript's subscription to the two pieces of state that move while
 * a response streams, and exists only to own it.
 *
 * `conversationDetails` and `draftsByConversation` are both replaced on every
 * 33ms stream flush. Read in `App`, that woke the sidebar, the workbench, the
 * titlebar and the dock ~30 times a second for the length of every answer, none
 * of which render tokens. Read here, the flush reaches the transcript and stops.
 *
 * Same shape as `ChatComposerSlot`, which does this for the composer draft, and
 * deliberately not wrapped in `memo` for the same reason: the caller passes
 * fresh closures on its own renders, so a memo would compare unequal every time.
 * The win is that `App` no longer renders on a token at all.
 */
export function ChatWindowSlot({ conversationId, ...chatWindowProps }: ChatWindowSlotProps) {
  const detail = useAppStore((state) =>
    conversationId ? state.conversationDetails[conversationId] ?? null : null
  );
  const draft = useAppStore((state) =>
    conversationId ? state.draftsByConversation[conversationId] ?? null : null
  );

  return <ChatWindow {...chatWindowProps} detail={detail} draft={draft} />;
}
