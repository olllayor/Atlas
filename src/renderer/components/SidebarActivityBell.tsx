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
 * The Codex "Activity" surface, shrunk to what a sidebar header can hold: a
 * bell with a badge count of everything that wants a human, opening a popover
 * that groups those threads by attention tier. Needs-input first — the same
 * order ⌘⌥A walks.
 */
export function SidebarActivityBell({
  items,
  onSelect,
  onMarkAllRead,
}: {
  items: ReadonlyArray<SidebarConversationItem>;
  onSelect: (conversationId: string) => void;
  onMarkAllRead: () => void;
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

  // Badge counts conversations, not events — five finished turns in one
  // thread are one place to go, not five reasons to panic.
  const badgeCount = groups.reduce(
    (total, group) => total + (group.level === 'unread' ? 1 : group.items.length),
    0
  );

  if (groups.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Activity — ${badgeCount} ${badgeCount === 1 ? 'thread needs attention' : 'threads need attention'}`}
              className="relative flex h-9 w-9 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              <Bell className="size-4" strokeWidth={1.75} aria-hidden />
              {badgeCount > 0 ? (
                <span
                  aria-hidden
                  className="absolute top-1.5 right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 font-mono text-[9px] leading-none text-accent-text"
                >
                  {badgeCount > 9 ? '9+' : badgeCount}
                </span>
              ) : null}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Activity</TooltipContent>
      </Tooltip>

      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-72 p-1.5"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-center justify-between px-2 pt-1 pb-1.5">
          <span className="text-2xs font-medium tracking-wide text-text-faint uppercase">Activity</span>
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
        </div>

        <div className="max-h-80 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.level} className="mb-1 last:mb-0">
              <div className="flex items-center gap-2 px-2 py-1">
                <StatusDot tone={group.meta.tone} size="sm" />
                <span className="text-2xs font-medium text-text-muted">{group.meta.label}</span>
                <span className="text-2xs tabular-nums text-text-faint">{group.items.length}</span>
              </div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelect(item.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                    'hover:bg-bg-hover'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">
                    {item.primaryLabel}
                  </span>
                  <span className="shrink-0 text-2xs tabular-nums text-text-faint">
                    {item.timestampLabel ?? ''}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
