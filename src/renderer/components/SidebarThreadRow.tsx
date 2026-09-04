import { memo, useCallback, useMemo } from 'react';

import type { WorkspaceProject } from '../../shared/contracts';
import { cn } from '../lib/utils';
import { resolveSnoozePresets } from '../lib/snooze';
import { useAppStore } from '../stores/useAppStore';
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
  /** Part of the multi-select range (bulk bar visible). */
  isSelected?: boolean;
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
  onRegenerateTitle?: (id: string) => void;
  onMarkUnread?: (id: string) => void;
  onMarkRead?: (id: string) => void;
  onOpenProjectSettings?: (projectId?: string) => void;
  onSetRovingId: (id: string) => void;
  onHoverCardOpenChange: (cardId: string, open: boolean) => void;
};

export const SidebarThreadRow = memo(function SidebarThreadRow({
  item,
  variant,
  project,
  isActive,
  isArchived,
  isSelected = false,
  isSettledShelf,
  isSnoozedShelf,
  isWoke = false,
  indented,
  showTimestamp,
  isRovingTarget,
  isRenaming,
  renameValue,
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
  onRegenerateTitle,
  onMarkUnread,
  onMarkRead,
  onOpenProjectSettings,
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

  const isPinned = Boolean(item.pinnedAt);
  const cardId = `conv:${item.id}`;
  const indentClass = indented ? 'pl-8' : 'px-2';
  // Per-row draft subscription: only this row re-renders on keystrokes, never
  // the whole list. Surfaces the T3 drafts signal as a marker plus preview.
  const draftText = useAppStore((state) => state.composerDraftsByConversation[item.id] ?? '');
  const trimmedDraft = draftText.trim();
  const hasUnsentDraft = trimmedDraft !== '';
  const draftPreview = hasUnsentDraft ? (trimmedDraft.split('\n')[0] ?? '').slice(0, 120) : null;
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

  const handleContextMenu = useCallback(
    async (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onHoverCardOpenChange(cardId, false);

      if (!window.atlasChat?.contextMenu?.showConversation) {
        return;
      }

      const isSnoozed = Boolean(
        item.snoozedUntil &&
          !Number.isNaN(Date.parse(item.snoozedUntil)) &&
          Date.parse(item.snoozedUntil) > Date.now()
      );

      const isUnread = Boolean(item.unreadCount && item.unreadCount > 0);

      const result = await window.atlasChat.contextMenu.showConversation({
        conversationId: item.id,
        conversationTitle: item.primaryLabel,
        isArchived,
        isPinned,
        isSettled: isSettledShelf,
        isSnoozed,
        isUnread,
        hasProject: Boolean(project),
        snoozePresets,
        canFork: Boolean(onFork),
        canRename: Boolean(onStartRename),
      });

      if (!result) return;

      if (result.action === 'restore') {
        onRestore(item.id);
      } else if (result.action === 'toggle-pin') {
        onSetPinned(item.id, !isPinned);
      } else if (result.action === 'wake') {
        onSnooze(item.id, null);
      } else if (result.action === 'snooze') {
        onSnooze(item.id, result.snoozedUntil);
      } else if (result.action === 'toggle-settled') {
        onToggleSettled(item.id, !isSettledShelf);
      } else if (result.action === 'rename') {
        onStartRename?.(item);
      } else if (result.action === 'regenerate-title') {
        onRegenerateTitle?.(item.id);
      } else if (result.action === 'mark-unread') {
        onMarkUnread?.(item.id);
      } else if (result.action === 'mark-read') {
        onMarkRead?.(item.id);
      } else if (result.action === 'project-settings') {
        onOpenProjectSettings?.(project?.id);
      } else if (result.action === 'archive') {
        onArchive(item.id);
      } else if (result.action === 'fork') {
        onFork?.(item.id);
      } else if (result.action === 'delete') {
        onDelete(item.id);
      }
    },
    [
      cardId,
      isArchived,
      isPinned,
      isSettledShelf,
      item.id,
      item.primaryLabel,
      item.snoozedUntil,
      item.unreadCount,
      project,
      onArchive,
      onDelete,
      onFork,
      onHoverCardOpenChange,
      onMarkRead,
      onMarkUnread,
      onOpenProjectSettings,
      onRegenerateTitle,
      onRestore,
      onSetPinned,
      onSnooze,
      onStartRename,
      onToggleSettled,
      snoozePresets,
    ]
  );

  return (
    <HoverCard
      open={isHoverCardOpen}
      openDelay={hoverCardOpenDelay}
      closeDelay={SIDEBAR_HOVER_CARD_CLOSE_DELAY_MS}
      onOpenChange={(open) => onHoverCardOpenChange(cardId, open)}
    >
      <HoverCardTrigger asChild onFocus={suppressHoverCardOnFocus}>
        <div
          onContextMenu={handleContextMenu}
          className={cn(
            'group/row relative flex items-center rounded-md transition-colors duration-150',
            variant === 'slim'
              ? '[content-visibility:auto] [contain-intrinsic-size:auto_36px]'
              : '[content-visibility:auto] [contain-intrinsic-size:auto_80px]',
            isActive
              ? 'bg-bg-active text-text-primary'
              : isSelected
                ? 'bg-bg-active/60 text-text-primary'
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
              if (isArchived) {
                onRestore(item.id);
                return;
              }
              onSelect(item.id);
            }}
            onDoubleClick={isArchived || !onStartRename ? undefined : () => onStartRename(item)}
            className={cn(
              'relative flex min-w-0 flex-1 items-center rounded-md px-2.5 text-left cursor-pointer select-none',
              variant === 'slim' ? 'h-9 py-0' : 'min-h-12 py-2',
              indentClass,
              isActive
                ? 'font-semibold text-text-primary'
                : 'font-medium text-text-secondary group-hover/row:text-text-primary'
            )}
          >
            <SidebarConversationRow
              variant={variant}
              isRunning={item.isRunning}
              isActive={isActive}
              isFailed={item.isFailed}
              isSelected={isSelected}
              attentionLevel={item.attention}
              unreadCount={item.unreadCount}
              primaryLabel={item.primaryLabel}
              secondaryLabel={item.secondaryLabel}
              timestampLabel={showTimestamp ? item.timestampLabel : null}
              timestampAccent={isSnoozedShelf}
              startedMs={item.isRunning ? item.timestampMs : null}
              jumpLabel={jumpLabel}
              showJumpHint={showJumpHint}
              projectTitle={project?.title ?? null}
              hideProjectName={indented && project !== null}
              branch={project?.branch ?? null}
              changeStats={item.changeStats}
              hasUnsentDraft={hasUnsentDraft}
              isSettled={settleAction.settled}
              onSettle={settleAction.run}
              isPinned={isPinned}
              onPin={() => onSetPinned(item.id, !isPinned)}
              isWoke={isWoke}
              settleActionLabel={settleAction.label}
              snoozePresets={snoozePresets}
              onSnoozePreset={(snoozedUntil) => onSnooze(item.id, snoozedUntil)}
              showSnooze={!isArchived}
            />
          </div>
        </div>
      </HoverCardTrigger>

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
        draftPreview={draftPreview}
      />
    </HoverCard>
  );
});
