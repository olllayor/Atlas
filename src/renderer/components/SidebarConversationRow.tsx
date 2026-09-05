import { useEffect, useState } from 'react';
import { AlarmClock, Check, Clock, Folder, Pin } from 'lucide-react';

import type { ConversationChangeStats } from '../../shared/contracts';
import { cn } from '../lib/utils';
import type { AttentionLevel } from '../lib/attention';
import type { SnoozePreset } from '../lib/snooze';
import { RowIconButton } from './RowIconButton';
import type { SidebarRowVariant } from './sidebarViewModel';
import { formatConversationChangeStats, formatElapsedSince } from './sidebarViewModel';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

type SidebarConversationRowProps = {
  variant?: SidebarRowVariant;
  isRunning: boolean;
  isActive?: boolean;
  isSelected?: boolean;
  isFailed?: boolean;
  attentionLevel?: AttentionLevel;
  unreadCount?: number;
  primaryLabel: string;
  secondaryLabel?: string | null;
  timestampLabel: string | null;
  /** Epoch ms the current run started at; drives the live Working timer. */
  startedMs?: number | null;
  jumpLabel?: string | null;
  showJumpHint?: boolean;
  projectTitle?: string | null;
  /** Nested rows hide the project name: the section header already says it. */
  hideProjectName?: boolean;
  branch?: string | null;
  changeStats?: ConversationChangeStats | null;
  /** Non-empty unsent composer text exists for this chat. */
  hasUnsentDraft?: boolean;
  isSettled?: boolean;
  onSettle?: () => void;
  isPinned?: boolean;
  onPin?: () => void;
  isWoke?: boolean;
  settleActionLabel?: string;
  snoozePresets?: ReadonlyArray<SnoozePreset>;
  onSnoozePreset?: (snoozedUntil: string) => void;
  showSnooze?: boolean;
  showTimestamp?: boolean;
  /** Wake label ("4h") renders in the accent tone on the Snoozed shelf. */
  timestampAccent?: boolean;
};

/**
 * Conversation row content, modeled after the T3 reference card:
 * - Line 1: project + status-or-time slot (hover swaps status for actions).
 * - Line 2: title only, truncated. No preview line: the row names the chat,
 *   the hover card explains it.
 * - Line 3: branch plus diff stats, icons pinned right.
 */
export function SidebarConversationRow({
  variant = 'card',
  isRunning,
  isActive = false,
  isSelected = false,
  isFailed = false,
  attentionLevel = 'idle',
  unreadCount = 0,
  primaryLabel,
  secondaryLabel = null,
  timestampLabel,
  startedMs = null,
  jumpLabel,
  showJumpHint = false,
  projectTitle = null,
  hideProjectName = false,
  branch = null,
  changeStats = null,
  hasUnsentDraft = false,
  isSettled = false,
  onSettle,
  isPinned = false,
  onPin,
  isWoke = false,
  settleActionLabel,
  snoozePresets,
  onSnoozePreset,
  showSnooze = false,
  showTimestamp = true,
  timestampAccent = false,
}: SidebarConversationRowProps) {
  const needsInput = attentionLevel === 'needsInput' && !isFailed;
  const isUnread = !needsInput && !isFailed && !isRunning && attentionLevel === 'unread' && unreadCount > 0;

  const settleButtonText = settleActionLabel ?? (isSettled ? 'Restore' : 'Settle');
  const settleButtonLabel = `${settleButtonText} chat`;

  const pinIndicator =
    isPinned && onPin ? (
      <RowIconButton
        icon={<Pin className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />}
        label="Unpin chat"
        onClick={onPin}
        className="size-5 rounded text-text-tertiary hover:text-text-primary"
      />
    ) : null;

  const showSnoozeMenu =
    showSnooze && snoozePresets && snoozePresets.length > 0 && onSnoozePreset;
  const showHoverActions = Boolean(onSettle) || Boolean(showSnoozeMenu);

  const statusClass =
    needsInput || isWoke
      ? 'text-warning-text'
      : isFailed
        ? 'text-error-text'
        : isRunning
          ? 'text-brand-strong'
          : isUnread
            ? 'text-success'
            : 'text-text-tertiary';

  void secondaryLabel;

  if (variant === 'slim') {
    return (
      <div className="relative flex h-9 min-w-0 flex-1 items-center gap-2 text-left">
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-xs font-medium text-text-secondary transition-colors group-hover/row:text-text-primary',
            isRunning && 'text-text-primary'
          )}
          title={primaryLabel}
        >
          {primaryLabel}
        </span>

        <span className="group/sidebar-status-slot relative ml-auto flex h-5 min-w-8 shrink-0 items-center justify-end text-xs">
          <span
            className={cn(
              'pointer-events-none flex items-center gap-1 tabular-nums text-text-secondary transition-opacity duration-150 motion-reduce:transition-none',
              'group-hover/row:absolute group-hover/row:right-0 group-hover/row:opacity-0 group-hover/row:delay-75',
              'group-has-[:focus-visible]/sidebar-status-slot:absolute group-has-[:focus-visible]/sidebar-status-slot:right-0 group-has-[:focus-visible]/sidebar-status-slot:opacity-0 group-has-[:focus-visible]/sidebar-status-slot:delay-0'
            )}
          >
            {needsInput ? (
              <span className={cn('text-3xs font-medium', statusClass)} role="status">
                Approval
              </span>
            ) : isFailed ? (
              <span className={cn('text-3xs font-medium', statusClass)} role="status">
                Failed
              </span>
            ) : isRunning ? (
              <span className={cn('inline-flex items-center gap-1 text-3xs font-medium', statusClass)}>
                <span className="size-1.5 shrink-0 rounded-full bg-brand-strong motion-glyph-pulse" aria-hidden />
                <span role="status">Working</span>
                {startedMs != null ? (
                  <span aria-hidden>
                    <WorkingTimer startedMs={startedMs} />
                  </span>
                ) : null}
              </span>
            ) : attentionLevel === 'queued' ? (
              <span className="text-3xs text-text-tertiary">Queued</span>
            ) : isWoke ? (
              <span className={cn('text-3xs font-medium', statusClass)} role="status">
                Woke
              </span>
            ) : isUnread ? (
              <span className={cn('text-3xs font-medium', statusClass)} role="status">
                Done
              </span>
            ) : timestampLabel && showTimestamp ? (
              <span
                className={cn(
                  'text-3xs tabular-nums',
                  timestampAccent ? 'font-medium text-brand-strong' : 'text-text-tertiary'
                )}
              >
                {timestampLabel}
              </span>
            ) : null}
          </span>

          {onSettle ? (
            <span
              className={cn(
                'pointer-events-none absolute inset-y-0 right-0 flex items-center opacity-0 transition-opacity duration-150 motion-reduce:transition-none',
                'has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100 has-[:focus-visible]:delay-0',
                'group-hover/row:pointer-events-auto group-hover/row:static group-hover/row:opacity-100 group-hover/row:delay-75'
              )}
            >
              <RowIconButton
                icon={
                  settleButtonText === 'Wake' ? (
                    <AlarmClock className="size-3 shrink-0 text-warning" strokeWidth={2} aria-hidden />
                  ) : (
                    <Check className="size-3 shrink-0" strokeWidth={2} aria-hidden />
                  )
                }
                label={settleButtonLabel}
                text={settleButtonText}
                onClick={onSettle}
                className="h-auto gap-0.5 rounded px-1.5 py-0.5 text-3xs text-text-tertiary hover:bg-bg-active hover:text-text-primary transition-colors"
              />
            </span>
          ) : null}
        </span>

        {jumpLabel && showJumpHint ? (
          <span className="pointer-events-none absolute right-1.5 top-1/2 z-10 inline-flex h-5 -translate-y-1/2 animate-in items-center rounded-full bg-bg-overlay px-1.5 font-mono text-3xs font-medium text-text-primary shadow-elevated fade-in-0 duration-150">
            {jumpLabel}
          </span>
        ) : null}
      </div>
    );
  }

  const diff = formatConversationChangeStats(changeStats);
  const recede =
    !isActive && !isSelected && !isRunning && !isFailed && !needsInput && !isWoke && !isUnread;

  return (
    <div className="relative flex min-w-0 flex-1 flex-col gap-1.5 text-left py-0.5">
      {/* Line 1: project + status. Status yields to hover actions. */}
      <div className="flex h-6 items-center gap-1.5 text-sm">
        {projectTitle && !hideProjectName ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <Folder className="size-3.5 shrink-0 text-text-tertiary" strokeWidth={1.75} aria-hidden />
            <span
              className={cn(
                'truncate',
                recede ? 'font-medium text-text-tertiary' : 'font-semibold text-text-secondary'
              )}
            >
              {projectTitle}
            </span>
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}

        {pinIndicator}

        <span className="group/sidebar-status-slot relative ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end">
          <span
            className={cn(
              'pointer-events-none flex items-center gap-1 tabular-nums transition-opacity duration-150 motion-reduce:transition-none',
              showHoverActions &&
                'group-hover/row:absolute group-hover/row:right-0 group-hover/row:opacity-0',
              'group-has-[:focus-visible]/sidebar-status-slot:absolute group-has-[:focus-visible]/sidebar-status-slot:right-0 group-has-[:focus-visible]/sidebar-status-slot:opacity-0'
            )}
          >
            {needsInput ? (
              <span className={cn('inline-flex items-center gap-1 text-xs font-medium', statusClass)}>
                <span role="status">Approval</span>
              </span>
            ) : isFailed ? (
              <span className={cn('inline-flex items-center gap-1 text-xs font-medium', statusClass)}>
                <span role="status">Failed</span>
              </span>
            ) : isRunning ? (
              <span className={cn('inline-flex items-center gap-1 text-xs font-medium', statusClass)}>
                <span className="size-1.5 shrink-0 rounded-full bg-brand-strong motion-glyph-pulse" aria-hidden />
                <span role="status">Working</span>
                {startedMs != null ? (
                  <span aria-hidden>
                    <WorkingTimer startedMs={startedMs} />
                  </span>
                ) : null}
              </span>
            ) : attentionLevel === 'queued' ? (
              <span className="inline-flex items-center text-xs text-text-tertiary">
                Queued
              </span>
            ) : isWoke ? (
              <span className={cn('inline-flex items-center gap-1 text-xs font-medium', statusClass)}>
                <span role="status">Woke</span>
              </span>
            ) : isUnread ? (
              <span className={cn('inline-flex items-center gap-1 text-xs font-medium', statusClass)}>
                <span role="status">Done</span>
              </span>
            ) : timestampLabel && showTimestamp ? (
              <span className="text-xs tabular-nums text-text-tertiary">{timestampLabel}</span>
            ) : null}

            {jumpLabel && showJumpHint ? (
              <span className="hidden">{jumpLabel}</span>
            ) : null}
          </span>

          {showHoverActions ? (
            <span
              className={cn(
                'pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 motion-reduce:transition-none',
                'has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:static has-[:focus-visible]:opacity-100',
                'group-hover/row:pointer-events-auto group-hover/row:static group-hover/row:opacity-100'
              )}
            >
              {showSnoozeMenu && onSnoozePreset ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Snooze chat"
                      title="Snooze chat"
                      onClick={(event) => event.stopPropagation()}
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-faint transition-colors hover:bg-bg-active hover:text-text-primary"
                    >
                      <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    {snoozePresets!.map((preset) => (
                      <DropdownMenuItem
                        key={preset.id}
                        onSelect={() => onSnoozePreset(preset.snoozedUntil)}
                      >
                        <span className="min-w-0 flex-1 truncate">{preset.label}</span>
                        <span className="shrink-0 text-xs tabular-nums text-text-faint">
                          {preset.whenLabel}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {onSettle ? (
                <RowIconButton
                  icon={<Check className="size-3.5" strokeWidth={2} aria-hidden />}
                  label={settleButtonLabel}
                  text={settleButtonText}
                  onClick={onSettle}
                  className="h-6 gap-1 rounded-md px-1.5 text-xs text-text-tertiary hover:bg-bg-active hover:text-text-primary transition-colors"
                />
              ) : null}
            </span>
          ) : null}
        </span>
      </div>

      {/* Line 2: title only, truncated. */}
      <div className="min-w-0 text-left">
        <span
          className={cn(
            'block truncate text-base leading-snug transition-colors group-hover/row:text-text-primary',
            recede ? 'font-medium text-text-secondary' : 'font-semibold text-text-primary'
          )}
          title={primaryLabel}
        >
          {primaryLabel}
        </span>
      </div>

      {/* Line 3: branch plus diff. Branch is the stable identifier. */}
      <div className="flex min-w-0 items-center gap-1.5 text-text-tertiary">
        {hasUnsentDraft ? (
          <span
            title="Unsent draft"
            aria-label="Unsent draft"
            role="img"
            className="size-1.5 shrink-0 rounded-full bg-warning-text"
          />
        ) : null}
        {branch ? (
          <span className="min-w-0 flex-1 truncate font-mono text-2xs font-medium">{branch}</span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {diff ? (
          <span
            className="flex shrink-0 items-center gap-1 font-mono text-2xs"
            title={diff.detail}
          >
            {diff.added ? <span className="font-medium text-success">{diff.added}</span> : null}
            {diff.removed ? <span className="font-medium text-error-text">{diff.removed}</span> : null}
          </span>
        ) : null}
      </div>

      {/* Jump hint overlays the right edge: never shifts layout. */}
      {jumpLabel && showJumpHint ? (
        <span className="pointer-events-none absolute right-1.5 top-1/2 z-10 inline-flex h-5 -translate-y-1/2 animate-in items-center rounded-full bg-bg-overlay px-1.5 font-mono text-3xs font-medium text-text-primary shadow-elevated fade-in-0 duration-150">
          {jumpLabel}
        </span>
      ) : null}
    </div>
  );
}

/** Live Working duration: self-ticking so only this span re-renders. */
function WorkingTimer({ startedMs }: { startedMs: number }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((tick) => tick + 1), 1_000);
    return () => window.clearInterval(id);
  }, [startedMs]);

  return (
    <span className="font-mono tabular-nums">{formatElapsedSince(startedMs, Date.now())}</span>
  );
}
