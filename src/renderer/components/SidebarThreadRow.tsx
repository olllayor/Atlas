import { memo, useMemo } from 'react';
import { Archive, ArchiveRestore, ChevronRight, Clock, GitBranch, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';

import type { WorkspaceProject } from '../../shared/contracts';
import { cn } from '../lib/utils';
import { resolveSnoozePresets } from '../lib/snooze';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './ui/context-menu';
import { HoverCard, HoverCardTrigger } from './ui/hover-card';
import { SidebarConversationHoverCard } from './SidebarHoverCard';
import { SidebarConversationRow } from './SidebarConversationRow';
import { SIDEBAR_HOVER_CARD_CLOSE_DELAY_MS } from './sidebarHoverCardDelay';
import type { SidebarConversationItem, SidebarRowVariant } from './sidebarViewModel';

const suppressHoverCardOnFocus = (event: React.FocusEvent) => event.preventDefault();

export type SidebarThreadRowProps = {
  item: SidebarConversationItem;
  variant: SidebarRowVariant;
  project: WorkspaceProject | null;
  isActive: boolean;
  isArchived: boolean;
  /** Rendered inside the Settled shelf: the hover action un-settles. */
  isSettledShelf: boolean;
  /** Rendered inside the Snoozed shelf: the hover action wakes. */
  isSnoozedShelf: boolean;
  isWoke?: boolean;
  indented: boolean;
  showTimestamp: boolean;
  isRovingTarget: boolean;
  isRenaming: boolean;
  renameValue: string;
  isPendingDelete: boolean;
  jumpLabel: string | null;
  showJumpHint: boolean;
  modelLabel: string | null;
  isHoverCardOpen: boolean;
  hoverCardOpenDelay: number;
  onSelect: (id: string) => void;
  onRestore: (id: string) => void;
  onArchive: (id: string) => void;
  /** Parks as done (true) or returns to the active list (false). */
  onToggleSettled: (id: string, settled: boolean) => void;
  /** Snoozes until an ISO wake time, or wakes immediately with null. */
  onSnooze: (id: string, snoozedUntil: string | null) => void;
  onSetPinned: (id: string, pinned: boolean) => void;
  onFork?: (id: string) => void;
  onDelete: (id: string) => void;
  onStartRename?: (item: SidebarConversationItem) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onRenameChange: (value: string) => void;
  onSetPendingDeleteId: (id: string | null) => void;
  onSetRovingId: (id: string) => void;
  onHoverCardOpenChange: (cardId: string, open: boolean) => void;
};

export const SidebarThreadRow = memo(function SidebarThreadRow({
  item,
  variant,
  project,
  isActive,
  isArchived,
  isSettledShelf,
  isSnoozedShelf,
  isWoke = false,
  indented,
  showTimestamp,
  isRovingTarget,
  isRenaming,
  renameValue,
  isPendingDelete,
  jumpLabel,
  showJumpHint,
  modelLabel,
  isHoverCardOpen,
  hoverCardOpenDelay,
  onSelect,
  onRestore,
  onArchive,
  onToggleSettled,
  onSnooze,
  onSetPinned,
  onFork,
  onDelete,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRenameChange,
  onSetPendingDeleteId,
  onSetRovingId,
  onHoverCardOpenChange,
}: SidebarThreadRowProps) {
  if (isRenaming) {
    return (
      <input
        autoFocus
        value={renameValue}
        aria-label="Rename chat"
        onChange={(event) => onRenameChange(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={onCommitRename}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            onCommitRename();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancelRename();
          }
        }}
        className="h-8 w-full rounded-md bg-bg-hover px-2 text-md text-text-primary ring-1 ring-border-strong outline-none"
      />
    );
  }

  if (isPendingDelete) {
    return (
      <div
        data-delete-confirm
        className="flex h-8 w-full items-center gap-1 rounded-md bg-bg-hover px-2"
      >
        <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">Delete chat?</span>
        <button
          type="button"
          autoFocus
          onClick={() => {
            onSetPendingDeleteId(null);
            onDelete(item.id);
          }}
          className="h-6 shrink-0 rounded-md px-1.5 text-sm text-error transition-colors hover:bg-error-bg hover:text-error-text"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => onSetPendingDeleteId(null)}
          className="h-6 shrink-0 rounded-md px-1.5 text-sm text-text-tertiary transition-colors hover:bg-bg-active hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    );
  }

  const isPinned = Boolean(item.pinnedAt);
  const cardId = `conv:${item.id}`;
  const indentClass = indented ? 'pl-8' : 'px-2';
  // Snooze presets resolve per render so the wake times are fresh each time
  // the menu opens. Cheap date math, no reason to memoize across rows.
  const snoozePresets = useMemo(() => resolveSnoozePresets(new Date()), []);

  // The row's verbs depend on which shelf it renders in. Archived rows only
  // know restore; settled-shelf rows un-settle; snoozed-shelf rows wake; live
  // rows settle. Archive stays a separate verb in the menu — parking as done
  // and hiding from the sidebar are different promises.
  const settleAction = isArchived
    ? { settled: true as const, label: 'Restore', run: () => onRestore(item.id) }
    : isSettledShelf
      ? { settled: true as const, label: 'Restore', run: () => onToggleSettled(item.id, false) }
      : isSnoozedShelf
        ? { settled: true as const, label: 'Wake', run: () => onSnooze(item.id, null) }
        : { settled: false as const, label: 'Settle', run: () => onToggleSettled(item.id, true) };

  return (
    <HoverCard
      open={isHoverCardOpen}
      openDelay={hoverCardOpenDelay}
      closeDelay={SIDEBAR_HOVER_CARD_CLOSE_DELAY_MS}
      onOpenChange={(open) => onHoverCardOpenChange(cardId, open)}
    >
      <ContextMenu>
        <HoverCardTrigger asChild onFocus={suppressHoverCardOnFocus}>
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                'group/row relative flex items-center rounded-md transition-colors duration-150',
                variant === 'slim'
                  ? '[content-visibility:auto] [contain-intrinsic-size:auto_36px]'
                  : '[content-visibility:auto] [contain-intrinsic-size:auto_68px]',
                isActive
                  ? 'bg-bg-active text-text-primary'
                  : 'bg-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              )}
            >
              <div
                role="button"
                data-conversation-row
                aria-current={isActive ? 'page' : undefined}
                tabIndex={isRovingTarget ? 0 : -1}
                onFocus={() => onSetRovingId(item.id)}
                onClick={() => {
                  onSetPendingDeleteId(null);
                  if (isArchived) {
                    onRestore(item.id);
                    return;
                  }
                  onSelect(item.id);
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onSetPendingDeleteId(null);
                  if (isArchived) {
                    onRestore(item.id);
                    return;
                  }
                  onSelect(item.id);
                }}
                onDoubleClick={isArchived || !onStartRename ? undefined : () => onStartRename(item)}
                className={cn(
                  'relative flex min-w-0 flex-1 items-center rounded-md px-2.5 text-left cursor-pointer select-none',
                  variant === 'slim' ? 'h-9 py-0' : 'min-h-8 py-1.5',
                  indentClass,
                  isActive
                    ? 'font-medium text-text-primary'
                    : 'text-text-secondary group-hover/row:text-text-primary'
                )}
              >
                <SidebarConversationRow
                  variant={variant}
                  isRunning={item.isRunning}
                  isFailed={item.isFailed}
                  attentionLevel={item.attention}
                  unreadCount={item.unreadCount}
                  primaryLabel={item.primaryLabel}
                  secondaryLabel={item.secondaryLabel}
                  timestampLabel={showTimestamp ? item.timestampLabel : null}
                  jumpLabel={jumpLabel}
                  showJumpHint={showJumpHint}
                  projectTitle={project?.title ?? null}
                  branch={project?.branch ?? null}
                  isSettled={settleAction.settled}
                  onSettle={settleAction.run}
                  isPinned={isPinned}
                  onPin={() => onSetPinned(item.id, !isPinned)}
                  isWoke={isWoke}
                  settleActionLabel={settleAction.label}
                />
              </div>
            </div>
          </ContextMenuTrigger>
        </HoverCardTrigger>
        <ContextMenuContent className="w-44">
          {isArchived ? (
            <ContextMenuItem onSelect={() => onRestore(item.id)}>
              <ArchiveRestore aria-hidden />
              Restore
            </ContextMenuItem>
          ) : (
            <>
              <ContextMenuItem onSelect={() => onSetPinned(item.id, !isPinned)}>
                {isPinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                {isPinned ? 'Unpin' : 'Pin'}
              </ContextMenuItem>
              {item.snoozedUntil && !Number.isNaN(Date.parse(item.snoozedUntil)) && Date.parse(item.snoozedUntil) > Date.now() ? (
                <ContextMenuItem onSelect={() => onSnooze(item.id, null)}>
                  <Clock aria-hidden />
                  Wake now
                </ContextMenuItem>
              ) : (
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Clock aria-hidden />
                    Snooze
                    <ChevronRight aria-hidden className="ml-auto size-3.5" />
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-48">
                    {snoozePresets.map((preset) => (
                      <ContextMenuItem
                        key={preset.id}
                        onSelect={() => onSnooze(item.id, preset.snoozedUntil)}
                      >
                        <span className="min-w-0 flex-1 truncate">{preset.label}</span>
                        <span className="shrink-0 text-xs tabular-nums text-text-faint">
                          {preset.whenLabel}
                        </span>
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              )}
              <ContextMenuItem onSelect={() => onArchive(item.id)}>
                <Archive aria-hidden />
                Archive
              </ContextMenuItem>
              {onFork ? (
                <ContextMenuItem onSelect={() => onFork(item.id)}>
                  <GitBranch aria-hidden />
                  Fork
                </ContextMenuItem>
              ) : null}
              {onStartRename ? (
                <ContextMenuItem onSelect={() => onStartRename(item)}>
                  <Pencil aria-hidden />
                  Rename
                </ContextMenuItem>
              ) : null}
            </>
          )}
          <ContextMenuItem
            variant="destructive"
            onSelect={() => {
              setTimeout(() => onSetPendingDeleteId(item.id), 0);
            }}
          >
            <Trash2 aria-hidden />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <SidebarConversationHoverCard
        title={item.primaryLabel}
        timestampLabel={item.timestampLabel}
        project={project}
        isRunning={item.isRunning}
        isFailed={item.isFailed}
        workspaceMode={item.workspaceMode}
        modelId={item.modelId}
        changeStats={item.changeStats}
        attentionLevel={item.attention}
        modelLabel={modelLabel}
      />
    </HoverCard>
  );
});
