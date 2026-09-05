/**
 * The renderer's picture of one conversation's shells.
 *
 * Main pushes `snapshot` / `upsert` / `remove` for every window, so the fold
 * below has to ignore events for other conversations and keep spawn order
 * stable — the tab strip reads this list, and a terminal that jumped position
 * because its label changed would be a tab moving under the pointer.
 */

import type { TerminalMetadataEvent, TerminalSummary } from '../../../shared/contracts';

export const NO_TERMINALS: TerminalSummary[] = [];

export function applyTerminalMetadata(
  current: readonly TerminalSummary[],
  event: TerminalMetadataEvent,
  conversationId: string
): TerminalSummary[] {
  if (event.type === 'snapshot') {
    return event.conversationId === conversationId ? [...event.terminals] : [...current];
  }

  if (event.type === 'remove') {
    if (event.conversationId !== conversationId) return [...current];
    const next = current.filter((terminal) => terminal.terminalId !== event.terminalId);
    return next.length === current.length ? [...current] : next;
  }

  if (event.terminal.conversationId !== conversationId) return [...current];

  const index = current.findIndex(
    (terminal) => terminal.terminalId === event.terminal.terminalId
  );
  if (index < 0) return [...current, event.terminal];

  const next = [...current];
  next[index] = event.terminal;
  return next;
}

/** The tab's name: whatever the shell is running, else its ordinal. */
export function terminalLabel(
  terminals: readonly TerminalSummary[],
  terminalId: string,
  fallback: string
): string {
  const label = terminals.find((terminal) => terminal.terminalId === terminalId)?.label?.trim();
  return label || fallback;
}
