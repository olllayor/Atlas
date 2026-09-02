import { Check, Clock, Folder, Pin, PinOff } from 'lucide-react';

import { cn } from '../lib/utils';
import type { AttentionLevel } from '../lib/attention';
import { RowIconButton } from './RowIconButton';

type SidebarConversationRowProps = {
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
 * 1. Project title, then the status badge (Failed, Approve) or the timestamp,
 *    with Pin and Settle inline.
 * 2. The chat's title, truncated to one line and shimmering while a turn runs.
 * 3. The branch.
 *
 * Lines 1 and 3 name facts, so both disappear when the fact does: a chat in
 * Recents has no project, and a project that is not a repository has no
 * branch. Only line 2 always renders.
 */
export function SidebarConversationRow({
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

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left py-0.5">
      {/* Line 1: Project Header + Status / Inline Actions */}
      <div className="flex items-center justify-between gap-1 text-xs">
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

        <div className="flex items-center gap-1 shrink-0">
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
                'flex items-center gap-1 text-3xs tabular-nums transition-opacity',
                isUnread ? 'font-medium text-text-primary' : 'text-text-tertiary'
              )}
            >
              <Clock className="size-3 shrink-0 text-text-faint" strokeWidth={1.75} aria-hidden />
              <span>{timestampLabel}</span>
            </span>
          ) : null}

          {/* Action buttons (Pin & Settle) inline in the row */}
          <div className="flex items-center gap-0.5">
            {onPin ? (
              <RowIconButton
                icon={
                  isPinned ? (
                    <PinOff className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
                  ) : (
                    <Pin className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
                  )
                }
                label={isPinned ? 'Unpin chat' : 'Pin chat'}
                onClick={onPin}
                className={cn(
                  'size-5 rounded transition-opacity',
                  isPinned
                    ? 'text-text-primary opacity-100'
                    : 'text-text-tertiary opacity-0 group-hover/row:opacity-100'
                )}
              />
            ) : null}

            {onSettle ? (
              <RowIconButton
                icon={<Check className="size-3 shrink-0" strokeWidth={2} aria-hidden />}
                label={isSettled ? 'Restore chat' : 'Settle chat'}
                text={isSettled ? 'Restore' : 'Settle'}
                onClick={onSettle}
                className="h-auto gap-0.5 rounded px-1 py-0.5 text-3xs text-text-tertiary transition-colors"
              />
            ) : null}
          </div>

          {jumpLabel && showJumpHint ? (
            <span className="inline-flex h-4 items-center rounded-sm bg-bg-hover px-1 font-mono text-3xs leading-none text-text-tertiary">
              {jumpLabel}
            </span>
          ) : null}
        </div>
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


