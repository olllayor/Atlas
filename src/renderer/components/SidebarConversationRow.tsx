import { Check, Clock, Folder, Pin } from 'lucide-react';

import { cn } from '../lib/utils';
import type { AttentionLevel } from '../lib/attention';
import { RowIconButton } from './RowIconButton';
import type { SidebarRowVariant } from './sidebarViewModel';

type SidebarConversationRowProps = {
  variant?: SidebarRowVariant;
  isRunning: boolean;
  isFailed?: boolean;
  attentionLevel?: AttentionLevel;
  unreadCount?: number;
  primaryLabel: string;
  secondaryLabel?: string | null;
  timestampLabel: string | null;
  jumpLabel?: string | null;
  showJumpHint?: boolean;
  projectTitle?: string | null;
  branch?: string | null;
  isSettled?: boolean;
  onSettle?: () => void;
  isPinned?: boolean;
  onPin?: () => void;
};

/**
 * Conversation row content, modeled after T3 Code's thread card:
 * - Card variant: three lines (project, title/preview, branch).
 * - Slim variant: one line at 36px (h-9) with title, timestamp and hover restore.
 */
export function SidebarConversationRow({
  variant = 'card',
  isRunning,
  isFailed = false,
  attentionLevel = 'idle',
  unreadCount = 0,
  primaryLabel,
  secondaryLabel = null,
  timestampLabel,
  jumpLabel,
  showJumpHint = false,
  projectTitle = null,
  branch = null,
  isSettled = false,
  onSettle,
  isPinned = false,
  onPin,
}: SidebarConversationRowProps) {
  const stateWord =
    attentionLevel === 'needsInput' && !isFailed
      ? { label: 'Approve', tone: 'warning' as const }
      : isFailed
        ? { label: 'Failed', tone: 'error' as const }
        : null;

  const isUnread = !stateWord && !isRunning && attentionLevel === 'unread' && unreadCount > 0;

  const pinIndicator =
    isPinned && onPin ? (
      <RowIconButton
        icon={<Pin className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />}
        label="Unpin chat"
        onClick={onPin}
        className="size-5 rounded text-text-tertiary hover:text-text-primary"
      />
    ) : null;

  if (variant === 'slim') {
    return (
      <div className="flex h-9 min-w-0 flex-1 items-center gap-2 text-left">
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-xs text-text-secondary transition-colors group-hover/row:text-text-primary',
            isRunning && 'motion-shimmer text-text-primary'
          )}
          title={primaryLabel}
        >
          {primaryLabel}
        </span>

        {pinIndicator}

        <span className="group/sidebar-status-slot relative ml-auto flex h-5 min-w-8 shrink-0 items-center justify-end text-xs">
          <span
            className={cn(
              'pointer-events-none flex items-center gap-1 tabular-nums text-text-secondary transition-opacity motion-reduce:transition-none',
              'group-hover/row:absolute group-hover/row:right-0 group-hover/row:opacity-0',
              'group-has-[:focus-visible]/sidebar-status-slot:absolute group-has-[:focus-visible]/sidebar-status-slot:right-0 group-has-[:focus-visible]/sidebar-status-slot:opacity-0'
            )}
          >
            {timestampLabel ? (
              <span className="text-3xs tabular-nums text-text-tertiary">
                {timestampLabel}
              </span>
            ) : null}
          </span>

          {onSettle ? (
            <span
              className={cn(
                'pointer-events-none absolute inset-y-0 right-0 flex items-center opacity-0 transition-opacity motion-reduce:transition-none',
                'has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100',
                'group-hover/row:pointer-events-auto group-hover/row:static group-hover/row:opacity-100'
              )}
            >
              <RowIconButton
                icon={<Check className="size-3 shrink-0" strokeWidth={2} aria-hidden />}
                label={isSettled ? 'Restore chat' : 'Settle chat'}
                text={isSettled ? 'Restore' : 'Settle'}
                onClick={onSettle}
                className="h-auto gap-0.5 rounded px-1.5 py-0.5 text-3xs text-text-tertiary hover:bg-bg-active hover:text-text-primary transition-colors"
              />
            </span>
          ) : null}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left py-0.5">
      {/* Line 1: Project Header + Pin + Status / Hover Actions Slot */}
      <div className="flex h-5 items-center justify-between gap-1 text-xs">
        {/* A chat filed under no project has no folder to name. The slot
            still holds its width so the status badge stays put down the
            column, but it says nothing rather than naming a project the chat
            does not belong to. */}
        {projectTitle ? (
          <span className="flex min-w-0 items-center gap-1.5 font-medium text-text-primary">
            <Folder className="size-3.5 shrink-0 text-text-tertiary" strokeWidth={1.75} aria-hidden />
            <span className="truncate">{projectTitle}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}

        {/* Pin indicator: inline on line 1, only when already pinned */}
        {pinIndicator}

        {/* Trailing slot: status at rest, actions on hover or focus-visible */}
        <span className="group/sidebar-status-slot relative ml-auto flex h-5 min-w-8 shrink-0 items-center justify-end text-xs">
          {/* Status child: in flow at rest, out of flow on hover or focus-visible */}
          <span
            className={cn(
              'pointer-events-none flex items-center gap-1 tabular-nums text-text-secondary transition-opacity motion-reduce:transition-none',
              'group-hover/row:absolute group-hover/row:right-0 group-hover/row:opacity-0',
              'group-has-[:focus-visible]/sidebar-status-slot:absolute group-has-[:focus-visible]/sidebar-status-slot:right-0 group-has-[:focus-visible]/sidebar-status-slot:opacity-0'
            )}
          >
            {stateWord ? (
              <span
                className={cn(
                  'inline-flex h-4 items-center rounded-sm px-1.5 text-3xs font-medium leading-none',
                  stateWord.tone === 'warning'
                    ? 'bg-warning-bg text-warning-text'
                    : 'bg-error-bg text-error-text'
                )}
              >
                {stateWord.label}
              </span>
            ) : timestampLabel ? (
              <span
                className={cn(
                  'flex items-center gap-1 text-3xs tabular-nums',
                  isUnread ? 'font-medium text-text-primary' : 'text-text-tertiary'
                )}
              >
                <Clock className="size-3 shrink-0 text-text-faint" strokeWidth={1.75} aria-hidden />
                <span>{timestampLabel}</span>
              </span>
            ) : null}

            {jumpLabel && showJumpHint ? (
              <span className="inline-flex h-4 items-center rounded-sm bg-bg-hover px-1 font-mono text-3xs leading-none text-text-tertiary">
                {jumpLabel}
              </span>
            ) : null}
          </span>

          {/* Actions child: out of flow at rest, in flow on hover or focus-visible */}
          {onSettle ? (
            <span
              className={cn(
                'pointer-events-none absolute inset-y-0 right-0 flex items-center opacity-0 transition-opacity motion-reduce:transition-none',
                'has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100',
                'group-hover/row:pointer-events-auto group-hover/row:static group-hover/row:opacity-100'
              )}
            >
              <RowIconButton
                icon={<Check className="size-3 shrink-0" strokeWidth={2} aria-hidden />}
                label={isSettled ? 'Restore chat' : 'Settle chat'}
                text={isSettled ? 'Restore' : 'Settle'}
                onClick={onSettle}
                className="h-auto gap-0.5 rounded px-1.5 py-0.5 text-3xs text-text-tertiary hover:bg-bg-active hover:text-text-primary transition-colors"
              />
            </span>
          ) : null}
        </span>
      </div>

      {/* Line 2: Prompt / Message preview */}
      <div className="min-w-0 text-left">
        <span
          className={cn(
            'block truncate text-sm leading-tight text-text-secondary group-hover/row:text-text-primary transition-colors',
            isRunning && 'motion-shimmer text-text-primary'
          )}
        >
          {primaryLabel}
        </span>
        {secondaryLabel ? (
          <span className="block truncate text-xs text-text-faint leading-none mt-0.5">
            {secondaryLabel}
          </span>
        ) : null}
      </div>

      {/* Line 3: the branch, when the chat has one. A project that is not a
          repository has no branch, and naming a likely one ("dev") turns the
          row's most stable identifier into a guess. The line goes away
          instead, so a row that shows a branch is a row that has one. */}
      {branch ? (
        <div className="flex items-center pt-0.5 font-mono text-3xs text-text-tertiary">
          <span className="min-w-0 truncate">{branch}</span>
        </div>
      ) : null}
    </div>
  );
}


