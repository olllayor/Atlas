import { createContext, useContext } from 'react';

import type { AssistantCitation } from '../../shared/citations';

export type CiteNavigator = (citation: AssistantCitation) => void;

/**
 * Click-through from transcript chips to the quoted source. Provided by the
 * transcript owner (ChatWindow), which alone knows the loaded messages and
 * the virtualizer. Null outside a transcript, where chips render inert.
 */
export const CiteNavigationContext = createContext<CiteNavigator | null>(null);

export function useCiteNavigation(): CiteNavigator | null {
  return useContext(CiteNavigationContext);
}
