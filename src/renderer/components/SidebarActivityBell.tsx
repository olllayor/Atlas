import { ArrowUpRight, Bell, Check, Folder } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { WorkspaceProject } from '../../shared/contracts';
import { ATTENTION_LEVEL_ORDER, type AttentionLevel } from '../lib/attention';
import { cn } from '../lib/utils';
import { useAppStore } from '../stores/useAppStore';
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

/** Ambient deck order: running, then queued, then unread. */
const AMBIENT_LEVELS = ACTIVITY_LEVELS.filter((level) => level !== 'needsInput');

/**
 * The two decks of the Action Hub: rich action cards on top, compact ambient
 * rows below. Pure so the partition unit-tests without a store.
 */
export function splitActivityDecks(items: ReadonlyArray<SidebarConversationItem>) {
  const actions = items.filter((item) => item.attention === 'needsInput');
  const ambient = AMBIENT_LEVELS.flatMap((level) => items.filter((item) => item.attention === level));
  return { actions, ambient };
}

/** Card badge for an action-deck item: failure first, then approval, then input. */
export function getActionBadge(item: SidebarConversationItem): 'Failed' | 'Approval' | 'Needs Input' {
  if (item.isFailed) return 'Failed';
  if (item.pendingApproval) return 'Approval';
  return 'Needs Input';
}

/**
 * Line 3 of an action card: the tool intent snippet when the agent is blocked
 * on an approval, otherwise the assistant preview. Never the diff stats — a
 * `+128 −34` tells triage nothing about why the agent stopped.
 */
export function getActionIntent(item: SidebarConversationItem): string | null {
  const snippet = item.pendingApproval?.commandSnippet?.trim();
  if (snippet) return snippet;
  const subject = item.pendingApproval?.subject?.trim();
  if (subject && subject !== item.pendingApproval?.toolName) return subject;
  return item.secondaryLabel;
}

function ambientStatusLabel(item: SidebarConversationItem): string {
  if (item.attention === 'running') return 'Working';
  if (item.attention === 'queued') return 'Queued';
  return item.unreadCount > 1 ? `${item.unreadCount} unread` : 'Unread';
}

/**
 * The Codex "Activity" surface, upgraded to an action-first hub: a bell with
 * an amber badge counting only conversations that want a human, opening a
 * two-deck popover. The top deck carries approvals with tool intent previews
 * and 1-click approvals; the bottom deck compresses running/queued/unread
 * threads into minimal ambient rows. Needs-input first — the same order ⌥⌘A
 * walks.
 */
export function SidebarActivityBell({
  items,
  projectById,
  selectedConversationId,
  onSelect,
  onMarkAllRead,
  onApprove,
  side = 'bottom',
  align = 'start',
}: {
  items: ReadonlyArray<SidebarConversationItem>;
  projectById?: ReadonlyMap<string, Pick<WorkspaceProject, 'id' | 'title'>>;
  selectedConversationId?: string | null;
  onSelect: (conversationId: string) => void;
  onMarkAllRead: () => void;
  onApprove?: (item: SidebarConversationItem) => Promise<void> | void;
  side?: 'bottom' | 'right';
  align?: 'start' | 'center' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [submittingApprovalId, setSubmittingApprovalId] = useState<string | null>(null);

  const { actions, ambient } = useMemo(() => splitActivityDecks(items), [items]);

  useEffect(() => {
    if (open) setSelectedIndex(0);
  }, [open ]);

  const clampedIndex = actions.length === 0 ? -1 : Math.min(selectedIndex, actions.length - 1);
  const selectedAction = clampedIndex >= 0 ? actions[clampedIndex] : undefined;

  // The badge counts only the tier that demands a human *now*: needs-input.
  // Running/queued/unread surface through the tier-colored dot on the bell
  // (matching the popover legend) so the badge stays a clear "act on this"
  // signal instead of a generic "stuff is happening" lump.
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

  const badgeCount = actions.length;
  const topGroup = groups[0]; // ACTIVITY_LEVELS order: needsInput > running > queued > unread
  const hasUnread = ambient.some((item) => item.attention === 'unread');
  const hasRunning = ambient.some((item) => item.attention === 'running');
  const totalActive = actions.length + ambient.length;
  const tooltipText = topGroup
    ? badgeCount > 0
      ? `Activity — ${badgeCount} thread${badgeCount === 1 ? '' : 's'} need${badgeCount === 1 ? 's' : ''} you (⌥⌘A)`
      : `Activity — ${topGroup.meta.label.toLowerCase()} (⌥⌘A)`
    : 'Activity — all caught up (⌥⌘A)';

  const approveItem = async (item: SidebarConversationItem) => {
    const approval = item.pendingApproval;
    if (!approval || submittingApprovalId) return;
    setSubmittingApprovalId(approval.approvalId);
    try {
      if (onApprove) {
        await onApprove(item);
      } else {
        await useAppStore
          .getState()
          .respondToolApproval({ requestId: approval.requestId, approvalId: approval.approvalId, decision: 'accept' });
      }
    } catch {
      // The transcript keeps the approval card, so a failed quick-approve
      // loses nothing — the user retries from the thread.
    } finally {
      setSubmittingApprovalId(null);
    }
  };

  const jumpTo = (conversationId: string) => {
    onSelect(conversationId);
    setOpen(false);
  };

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
                    }${badgeCount > 0 ? `, ${badgeCount} need input` : ''}`
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
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && actions.length > 0) {
            event.preventDefault();
            setSelectedIndex((index) => (index + 1) % actions.length);
          } else if (event.key === 'ArrowUp' && actions.length > 0) {
            event.preventDefault();
            setSelectedIndex((index) => (index - 1 + actions.length) % actions.length);
          } else if (event.key === 'Enter' && selectedAction) {
            event.preventDefault();
            jumpTo(selectedAction.id);
          } else if (
            (event.key === 'a' || event.key === 'A') &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            selectedAction?.pendingApproval
          ) {
            event.preventDefault();
            void approveItem(selectedAction);
          }
        }}
      >
        <div className="flex items-center justify-between px-2 pt-1 pb-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-2xs font-semibold tracking-wide text-text-faint uppercase">Activity Hub</span>
            {badgeCount > 0 ? (
              <span className="rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.2 font-mono text-[10px] font-medium text-warning">
                {badgeCount} Need Input
              </span>
            ) : totalActive > 0 ? (
              <span className="rounded-full bg-bg-muted px-1.5 py-0.2 font-mono text-[10px] text-text-muted">
                {totalActive}
              </span>
            ) : null}
          </div>
          <span className="font-mono text-[10px] text-text-faint" aria-hidden>
            ⌥⌘A next
          </span>
        </div>
        <div className="mx-2 h-px bg-border-subtle" />

        <div className="max-h-80 overflow-y-auto p-1">
          {totalActive === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
              <Bell className="size-5 text-text-faint mb-1.5" strokeWidth={1.5} />
              <span className="text-xs font-medium text-text-secondary">All caught up</span>
              <span className="text-2xs text-text-muted mt-0.5">No pending approvals or active background tasks</span>
              <span className="mt-2 font-mono text-[10px] text-text-faint">⌥⌘A to jump to next</span>
            </div>
          ) : (
            <>
              {actions.length > 0 ? (
                <div className="mb-1">
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-[11px] font-semibold text-warning">Action Required</span>
                    <span className="font-mono text-[10px] tabular-nums text-text-faint">{actions.length}</span>
                  </div>
                  <div className="flex flex-col gap-1" role="listbox" aria-label="Conversations needing input">
                    {actions.map((item, index) => {
                      const badge = getActionBadge(item);
                      const intent = getActionIntent(item);
                      const project = item.projectId ? projectById?.get(item.projectId) : undefined;
                      const isSelected = index === clampedIndex;
                      const isSubmitting = item.pendingApproval
                        ? submittingApprovalId === item.pendingApproval.approvalId
                        : false;
                      return (
                        <div
                          key={item.id}
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => jumpTo(item.id)}
                          onMouseEnter={() => setSelectedIndex(index)}
                          className={cn(
                            'group flex cursor-pointer flex-col gap-1 rounded-md border px-2 py-1.5 transition-colors',
                            isSelected
                              ? 'border-warning/30 bg-bg-hover'
                              : 'border-border-subtle bg-bg-base/50 hover:border-warning/30 hover:bg-bg-hover',
                            badge === 'Failed' && !isSelected && 'hover:border-error/40'
                          )}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="flex min-w-0 items-center gap-1 text-[11px] text-text-tertiary">
                              <Folder className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
                              <span className="truncate font-medium">{project?.title ?? 'Recents'}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              <span
                                className={cn(
                                  'rounded px-1 py-0.2 text-[10px] font-semibold',
                                  badge === 'Failed'
                                    ? 'bg-error/10 text-error'
                                    : 'border border-warning/30 bg-warning/10 text-warning'
                                )}
                              >
                                {badge}
                              </span>
                              {item.timestampLabel ? (
                                <span className="font-mono text-[10px] tabular-nums text-text-faint">
                                  {item.timestampLabel}
                                </span>
                              ) : null}
                            </span>
                          </div>
                          <div className="truncate text-xs font-medium text-text-primary" title={item.primaryLabel}>
                            {item.primaryLabel}
                          </div>
                          {intent ? (
                            <div className="flex items-center justify-between gap-1.5 border-t border-border-subtle pt-1">
                              <span
                                className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-muted"
                                title={intent}
                              >
                                ↳ {intent}
                              </span>
                              <span
                                className={cn(
                                  'flex shrink-0 items-center gap-1 transition-all',
                                  isSelected
                                    ? 'opacity-100'
                                    : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
                                )}
                              >
                                {item.pendingApproval ? (
                                  <button
                                    type="button"
                                    disabled={isSubmitting}
                                    title="Approve without leaving this view (A)"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void approveItem(item);
                                    }}
                                    className="flex items-center gap-0.5 rounded bg-warning px-1.5 py-0.5 text-[10px] font-semibold text-bg-base transition-opacity hover:brightness-110 disabled:opacity-50"
                                  >
                                    <Check className="size-3" strokeWidth={3} aria-hidden />
                                    {isSubmitting ? '…' : 'Approve'}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  title="Open thread"
                                  aria-label={`Open ${item.primaryLabel}`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    jumpTo(item.id);
                                  }}
                                  className="flex rounded p-1 text-text-tertiary transition-colors hover:bg-bg-active hover:text-text-primary"
                                >
                                  <ArrowUpRight className="size-3" strokeWidth={2} aria-hidden />
                                </button>
                              </span>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {ambient.length > 0 ? (
                <div className="mb-1 last:mb-0">
                  <div className="px-2 py-1">
                    <span className="text-[11px] font-semibold text-text-tertiary">Active &amp; Recent</span>
                  </div>
                  <div>
                    {ambient.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        aria-current={item.id === selectedConversationId ? true : undefined}
                        onClick={() => jumpTo(item.id)}
                        className="flex w-full items-center justify-between gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-bg-hover"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <StatusDot tone={LEVEL_META[item.attention as Exclude<AttentionLevel, 'idle'>].tone} size="sm" aria-hidden />
                          <span className="truncate text-xs text-text-secondary" title={item.primaryLabel}>
                            {item.primaryLabel}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span
                            className={cn(
                              'text-[11px]',
                              item.attention === 'running' ? 'font-mono text-text-secondary' : 'text-text-muted'
                            )}
                          >
                            {ambientStatusLabel(item)}
                          </span>
                          {item.timestampLabel ? (
                            <span className="font-mono text-[10px] tabular-nums text-text-faint">
                              {item.timestampLabel}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        {totalActive > 0 ? (
          <>
            <div className="mx-2 h-px bg-border-subtle" />
            <div className="flex items-center justify-between px-2 pt-1.5 pb-1">
              <span className="flex items-center gap-1.5 font-mono text-[10px] text-text-faint" aria-hidden>
                <span>↑↓ Navigate</span>
                <span>↵ Jump</span>
                {actions.some((item) => item.pendingApproval) ? <span>A Approve</span> : null}
              </span>
              {hasUnread || hasRunning ? (
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
