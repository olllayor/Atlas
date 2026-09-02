/**
 * A shell as a right-panel surface.
 *
 * Deliberately thinner than `TerminalDock`: the tab already carries the name
 * and the close button, so the surface is the shell and nothing else. The
 * chrome the dock keeps — expand, cwd header — belongs to a panel that spans
 * the window, not to a 400px column.
 *
 * The PTY outlives this view. Unmounting it (switching tabs, hiding the panel)
 * leaves the shell running; closing the tab is what kills it.
 */

import { useCallback, useEffect, useRef } from 'react';

import { buildTerminalContextBlock } from '../../lib/terminalContext';
import { TerminalPanel, type TerminalPanelHandle } from './TerminalPanel';

export type TerminalSurfaceProps = {
  conversationId: string;
  terminalId: string;
  /** ⌘E with a selection: pipe it to the composer as context. */
  onAddSelectionToPrompt?: (text: string) => void;
};

export function TerminalSurface({
  conversationId,
  terminalId,
  onAddSelectionToPrompt,
}: TerminalSurfaceProps) {
  const panelRef = useRef<TerminalPanelHandle | null>(null);

  const addSelectionToPrompt = useCallback(() => {
    const selection = panelRef.current?.getSelectionText();
    if (!selection || !onAddSelectionToPrompt) return;
    onAddSelectionToPrompt(buildTerminalContextBlock({ shell: 'terminal', selection }));
    panelRef.current?.focus();
  }, [onAddSelectionToPrompt]);

  // Opening a terminal is an act of wanting to type in it. Mount only: keyed
  // on the terminal, so switching back to an open tab does not steal focus
  // from wherever the user has since put it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="h-full min-h-0 px-2 pb-2">
      <TerminalPanel
        ref={panelRef}
        conversationId={conversationId}
        terminalId={terminalId}
        onRequestSelectionPrompt={onAddSelectionToPrompt ? addSelectionToPrompt : undefined}
      />
    </div>
  );
}
