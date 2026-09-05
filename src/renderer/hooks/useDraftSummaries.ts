import { useRef } from 'react';

import {
  EMPTY_DRAFT_SUMMARIES,
  projectDraftSummaries,
  type DraftSummaryMap,
} from '../stores/draftSummaries';
import { useAppStore } from '../stores/useAppStore';

/**
 * Subscribe to the turn-level state of every live draft without subscribing to
 * the tokens.
 *
 * `draftsByConversation` is replaced on every stream flush, so any component
 * reading it directly renders ~30 times a second for the length of a response.
 * The projection collapses that to the fields that actually drive chrome, and
 * the ref keeps the previous result so an unchanged projection is returned by
 * identity and the subscriber is never woken.
 *
 * Writing to a ref during render is deliberate: it is the same cache-in-a-ref
 * shape zustand's own `useShallow` uses, and it is what lets the selector
 * satisfy `useSyncExternalStore`'s requirement that an unchanged snapshot keep
 * its identity.
 */
export function useDraftSummaries(): DraftSummaryMap {
  const cache = useRef<DraftSummaryMap>(EMPTY_DRAFT_SUMMARIES);

  return useAppStore((state) => {
    cache.current = projectDraftSummaries(state.draftsByConversation, cache.current);
    return cache.current;
  });
}
