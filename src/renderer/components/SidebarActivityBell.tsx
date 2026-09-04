import { Bell } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ATTENTION_LEVEL_ORDER, type AttentionLevel } from '../lib/attention';
import { cn } from '../lib/utils';
import type { SidebarConversationItem } from './sidebarViewModel';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { StatusDot } from './ui/status-dot';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

const LEVEL_META: Record<
  Exclude<AttentionLevel, 'idle'>,
  { label: string; tone: 'attention' | 'running' | 'failed' | 'unread' }
> = {
  needsInput: { label: 'Needs input', tone: 'attention' },
  running: { label: 'Running', tone: 'running' },
  queued: { label: 'Queued', tone: 'unread' },
  unread: { label: 'Unread', tone: 'unread' },
};

/** Tier keys in popover order — needs-input first, idle excluded. */
const ACTIVITY_LEVELS = ATTENTION_LEVEL_ORDER.filter(
  (level): level is Exclude<AttentionLevel, 'idle'> => level !== 'idle'
);

/**
 * The Codex "Activity" surface: a bell with a badge count of conversations
 * that want a human, opening a popover grouping threads by attention tier.
 * Needs-input first — the same order ⌥⌘A walks.
 */
export function SidebarActivityBell({
  items,
  onSelect,
  onMarkAllRead,
  side = 'bottom',
  align = 'start',
}: {
  items: ReadonlyArray<SidebarConversationItem>;
  onSelect: (conversationId: string) => void;
  onMarkAllRead: () => void;
  side?: 'bottom' | 'right';
  align?: 'start' | 'center' | 'end';
}) {
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    const byLevel = new Map<AttentionLevel, SidebarConversationItem[]>();
    for (const item of items) {
      if (item.attention === 'idle') continue;
      const bucket = byLevel.get(item.attention) ?? [];
      bucket.push(item);
      byLevel.set(item.attention, bucket);
    }

    return ACTIVITY_LEVELS.filter((level) => byLevel.has(level)).map((level) => ({
      level,
      meta: LEVEL_META[level],
      items: byLevel.get(level)!,
    }));
  }, [items]);

  // The badge counts only the tiers that demand a human *now*: needs-input.
  // Running/queued/unread are surfaced by a tier-colored dot on the bell
  // (matching the popover legend) so the badge stays a clear "act on this" signal
  // instead of a generic "stuff is happening" lump.
  const needsInputCount = groups.find((g) => g.level === 'needsInput')?.items.length ?? 0;
  const topGroup = groups[0]; // ACTIVITY_LEVELS order: needsInput > running > queued > unread
  const badgeCount = needsInputCount;
  const hasUnread = groups.some((group) => group.level === 'unread');
  const totalActive = groups.reduce((sum, group) => sum + group.items.length, 0);
  const tooltipText = topGroup
    ? badgeCount > 0
      ? `Activity — ${badgeCount} thread${badgeCount === 1 ? '' : 's'} need${badgeCount === 1 ? 's' : ''} you (⌥⌘A)`
      : `Activity — ${topGroup.meta.label.toLowerCase()} (⌥⌘A)`
    : 'Activity — all caught up (⌥⌘A)';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={
                topGroup
                  ? `Activity — ${topGroup.meta.label.toLowerCase()}${
                      topGroup.items.length > 1 ? ` (${topGroup.items.length})` : ''
                    }${needsInputCount > 0 ? `, ${needsInputCount} need input` : ''}`
                  : 'Activity — All caught up'
              }
              className={cn(
                'relative flex h-9 w-9 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary',
                open && 'bg-bg-hover text-text-primary',
                // Tint the icon when *anything* is happening, regardless of tier.
                topGroup && 'text-text-secondary'
              )}
            >
              <Bell className="size-4" strokeWidth={1.75} aria-hidden />
              {/* Tier dot: the highest-priority non-idle attention, matching the
                  popover legend. Sits bottom-right so the badge (when present)
                  stays readable in the top-right corner. */}
              {topGroup ? (
                <StatusDot
                  tone={topGroup.meta.tone}
                  size="sm"
                  className="absolute bottom-1.5 right-1.5"
                  aria-hidden
                />
              ) : null}
              {badgeCount > 0 ? (
                <span
                  aria-hidden
                  title={`${badgeCount} need input`}
                  className={cn(
                    'absolute top-1 right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-0.5 font-mono text-[9px] font-medium leading-none tabular-nums text-bg-base shadow-xs'
                  )}
                >
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              ) : null}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side={side}>{tooltipText}</TooltipContent>
      </Tooltip>

      <PopoverContent
        align={align}
        side={side}
        sideOffset={6}
        className="w-80 p-1.5"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-center justify-between px-2 pt-1 pb-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-2xs font-semibold tracking-wide text-text-faint uppercase">Activity</span>
            {totalActive > 0 ? (
              <span className="rounded-full bg-bg-muted px-1.5 py-0.2 font-mono text-[10px] text-text-muted">
                {totalActive}
              </span>
            ) : null}
          </div>
        </div>
        <div className="mx-2 h-px bg-border-subtle" />

        <div className="max-h-80 overflow-y-auto p-1">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
              <Bell className="size-5 text-text-faint mb-1.5" strokeWidth={1.5} />
              <span className="text-xs font-medium text-text-secondary">All caught up</span>
              <span className="text-2xs text-text-muted mt-0.5">No active or unread conversations</span>
              <span className="mt-2 font-mono text-[10px] text-text-faint">⌥⌘A to jump to next</span>
            </div>
          ) : (
            groups.map((group, groupIndex) => (
              <div key={group.level} className="mb-1 last:mb-0">
                <div className="flex items-center gap-2 px-2 py-1">
                  <StatusDot tone={group.meta.tone} size="sm" />
                  <span className="text-[11px] font-semibold text-text-secondary">{group.meta.label}</span>
                  <span className="font-mono text-[10px] tabular-nums text-text-faint">{group.items.length}</span>
                  <span className="flex-1" />
                  {groupIndex === 0 ? (
                    <span className="font-mono text-[10px] text-text-faint" aria-hidden>
                      ⌥⌘A
                    </span>
                  ) : null}
                </div>
                <div className="mx-2 h-px bg-border-subtle" />
                <div className="pt-1">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelect(item.id);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                        'hover:bg-bg-hover'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-1.5">
                          <span className="truncate text-xs font-medium text-text-secondary">
                            {item.primaryLabel}
                          </span>
                          {item.timestampLabel ? (
                            <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-faint">
                              {item.timestampLabel}
                            </span>
                          ) : null}
                        </div>
                        {item.secondaryLabel ? (
                          <p className="truncate text-2xs italic text-text-faint mt-0.5">
                            {item.secondaryLabel}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {groups.length > 0 ? (
          <>
            <div className="mx-2 h-px bg-border-subtle" />
            <div className="flex items-center justify-between px-2 pt-1.5 pb-1">
              <span className="font-mono text-[10px] text-text-faint">⌥⌘A to jump to next</span>
              {hasUnread ? (
                <button
                  type="button"
                  onClick={() => {
                    onMarkAllRead();
                    setOpen(false);
                  }}
                  className="rounded-sm px-1.5 py-0.5 text-2xs text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
                >
                  Mark all read
                </button>
              ) : (
                <span className="px-1.5 py-0.5 text-2xs text-text-faint">
                  {badgeCount > 0 ? `${badgeCount} need input` : topGroup?.meta.label.toLowerCase()}
                </span>
              )}
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
