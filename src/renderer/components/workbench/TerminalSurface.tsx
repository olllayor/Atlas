/**
 * A terminal tab: one shell, or several beside each other.
 *
 * Deliberately thinner than `TerminalDock`: the tab already carries the name
 * and the close button, so the only chrome here is what splitting needs. The
 * dock's expand and cwd header belong to a panel that spans the window, not to
 * a 400px column.
 *
 * A PTY outlives its view. Switching to another surface unmounts these panes
 * and leaves every shell running; closing a pane is what kills one, and
 * closing the last pane closes the tab.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Columns2, Rows2, X } from 'lucide-react';

import type { TerminalSummary } from '../../../shared/contracts';
import { terminalLabelFromId } from '../../../shared/terminalIds';
import { buildTerminalContextBlock } from '../../lib/terminalContext';
import { cn } from '../../lib/utils';
import {
  terminalGroupKey,
  useTerminalPanes,
  useTerminalSplitStore,
} from '../../stores/useTerminalSplitStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { TerminalPanel, type TerminalPanelHandle } from './TerminalPanel';
import { canSplit, type SplitDirection } from './terminalSplitModel';
import { terminalLabel } from './terminalsModel';

export type TerminalSurfaceProps = {
  conversationId: string;
  /** The tab's own terminal, and the key its panes are grouped under. */
  rootTerminalId: string;
  terminals: readonly TerminalSummary[];
  /** An id no other shell in this conversation is using. */
  allocateTerminalId: () => string;
  /** The last pane closed, so the tab goes with it. */
  onCloseSurface: () => void;
  /** ⌘E with a selection: pipe it to the composer as context. */
  onAddSelectionToPrompt?: (text: string) => void;
};

export function TerminalSurface({
  conversationId,
  rootTerminalId,
  terminals,
  allocateTerminalId,
  onCloseSurface,
  onAddSelectionToPrompt,
}: TerminalSurfaceProps) {
  const groupKey = terminalGroupKey(conversationId, rootTerminalId);
  const group = useTerminalPanes(groupKey, rootTerminalId);
  const splitGroup = useTerminalSplitStore((state) => state.split);
  const activatePane = useTerminalSplitStore((state) => state.activate);
  const closePane = useTerminalSplitStore((state) => state.closePane);

  const split = (direction: SplitDirection) => {
    if (!canSplit(group)) return;
    splitGroup(groupKey, rootTerminalId, allocateTerminalId(), direction);
  };

  const close = (terminalId: string) => {
    void window.atlasChat.terminal.kill({ conversationId, terminalId }).catch(() => {});
    // The tab is the group: emptying it has to take the tab with it, or the
    // strip keeps an entry that opens onto nothing.
    if (group.terminalIds.length === 1) {
      onCloseSurface();
      return;
    }
    closePane(groupKey, rootTerminalId, terminalId);
  };

  const multiple = group.terminalIds.length > 1;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center justify-end gap-0.5 px-2">
        <SplitButton
          label="Split right"
          disabled={!canSplit(group)}
          onClick={() => split('row')}
        >
          <Columns2 className="size-3.5" aria-hidden />
        </SplitButton>
        <SplitButton
          label="Split down"
          disabled={!canSplit(group)}
          onClick={() => split('column')}
        >
          <Rows2 className="size-3.5" aria-hidden />
        </SplitButton>
      </div>

      <div
        className={cn('flex min-h-0 flex-1 gap-px px-2 pb-2', group.direction === 'column' && 'flex-col')}
      >
        {group.terminalIds.map((terminalId) => (
          <TerminalPane
            key={terminalId}
            conversationId={conversationId}
            terminalId={terminalId}
            label={terminalLabel(terminals, terminalId, terminalLabelFromId(terminalId))}
            active={terminalId === group.activeTerminalId}
            showHeader={multiple}
            onActivate={() => activatePane(groupKey, rootTerminalId, terminalId)}
            onClose={() => close(terminalId)}
            onAddSelectionToPrompt={onAddSelectionToPrompt}
          />
        ))}
      </div>
    </div>
  );
}

function TerminalPane({
  conversationId,
  terminalId,
  label,
  active,
  showHeader,
  onActivate,
  onClose,
  onAddSelectionToPrompt,
}: {
  conversationId: string;
  terminalId: string;
  label: string;
  active: boolean;
  showHeader: boolean;
  onActivate: () => void;
  onClose: () => void;
  onAddSelectionToPrompt?: (text: string) => void;
}) {
  const panelRef = useRef<TerminalPanelHandle | null>(null);

  const addSelectionToPrompt = useCallback(() => {
    const selection = panelRef.current?.getSelectionText();
    if (!selection || !onAddSelectionToPrompt) return;
    onAddSelectionToPrompt(buildTerminalContextBlock({ shell: 'terminal', selection }));
    panelRef.current?.focus();
  }, [onAddSelectionToPrompt]);

  // Opening a terminal is an act of wanting to type in it, and so is splitting
  // one. Mount only, and only for the pane that is active: coming back to a
  // tab must not steal focus from wherever the user has since put it.
  const activeOnMountRef = useRef(active);
  useEffect(() => {
    if (!activeOnMountRef.current) return;
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      // Focus follows the cursor into a pane, which is what decides the tab's
      // name — a capture listener so it fires for the xterm textarea inside.
      onFocusCapture={onActivate}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col rounded-md',
        showHeader && (active ? 'bg-bg-surface' : 'bg-bg-base')
      )}
    >
      {showHeader ? (
        <div className="flex h-6 shrink-0 items-center gap-1 pr-1 pl-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-xs',
              active ? 'text-text-secondary' : 'text-text-faint'
            )}
            title={label}
          >
            {label}
          </span>
          <button
            type="button"
            aria-label={`Close ${label}`}
            onClick={onClose}
            className="flex size-4 shrink-0 items-center justify-center rounded text-text-faint transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <X className="size-3" aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <TerminalPanel
          ref={panelRef}
          conversationId={conversationId}
          terminalId={terminalId}
          onRequestSelectionPrompt={onAddSelectionToPrompt ? addSelectionToPrompt : undefined}
        />
      </div>
    </div>
  );
}

function SplitButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="flex size-6 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:pointer-events-none disabled:opacity-30"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
