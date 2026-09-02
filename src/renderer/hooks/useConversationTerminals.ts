/**
 * Live list of a conversation's shells, for the right panel's tab strip.
 *
 * Subscribing is also what tells main a terminal panel is mounted, which is
 * what starts the once-a-second process probe behind the tab labels. Mount
 * this in one place per window: every extra subscription is another watcher
 * main has to keep the probe alive for.
 */

import { useEffect, useState } from 'react';

import type { TerminalSummary } from '../../shared/contracts';
import { NO_TERMINALS, applyTerminalMetadata } from '../components/workbench/terminalsModel';

export function useConversationTerminals(conversationId: string | undefined): TerminalSummary[] {
  const [terminals, setTerminals] = useState<TerminalSummary[]>(NO_TERMINALS);

  useEffect(() => {
    if (!conversationId) {
      setTerminals(NO_TERMINALS);
      return;
    }

    let disposed = false;
    // The list answers "what is already running" — shells outlive the panel,
    // so a fresh mount has to catch up before the first event arrives.
    void window.atlasChat.terminal
      .list(conversationId)
      .then((current) => {
        if (!disposed) setTerminals(current);
      })
      .catch(() => {
        if (!disposed) setTerminals(NO_TERMINALS);
      });

    const unsubscribe = window.atlasChat.terminal.subscribeMetadata((event) => {
      if (disposed) return;
      setTerminals((current) => applyTerminalMetadata(current, event, conversationId));
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [conversationId]);

  return terminals;
}
