import { StatusDot } from '@/components/ui/status-dot';

import { cn } from '../lib/utils';
import type { AttentionLevel } from '../lib/attention';

type SidebarConversationRowProps = {
  isRunning: boolean;
  isFailed?: boolean;
  attentionLevel?: AttentionLevel;
  unreadCount?: number;
  primaryLabel: string;
  /**
   * The line under the title — last assistant output, or a live status
   * ("Thinking…", an error). The Codex reference's rows carry one; a title
   * alone makes ten threads about the same project indistinguishable. Null
   * keeps the row single-line.
   */
  secondaryLabel?: string | null;
  timestampLabel: string | null;
  jumpLabel?: string | null;
  showJumpHint?: boolean;
};

/**
 * Conversation row content, per the Codex reference: truncated title, the
 * preview line under it when there is one, and a right-aligned relative time
 * in a fixed slot.
 *
 * The slot never changes width and its two occupants (time, jump-hint chip)
 * cross-fade in place, so hovering or holding a modifier moves nothing.
 * It is omitted entirely when the row has neither: 56px of reserved gutter on
 * a row that will never fill it is 56px stolen from the title.
 * The parent owns hover/active backgrounds, row height and the context menu.
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
}: SidebarConversationRowProps) {
  const hasTrailingSlot = timestampLabel != null || jumpLabel != null;

  /*
    One 12px slot, one mark: the four states never render together. Precedence
    is "what happens if you keep ignoring this row" — a pending approval or
    error outranks a failure badge, which outranks ambient motion.
  */
  const leadingMark =
    attentionLevel === 'needsInput' ? (
      <StatusDot tone="attention" label="Needs your input" className="mr-2" />
    ) : isFailed ? (
      <StatusDot tone="failed" label="Last turn failed" className="mr-2" />
    ) : isRunning ? (
      <StatusDot tone="running" label="Generating" className="mr-2" />
    ) : attentionLevel === 'unread' ? (
      <StatusDot
        tone="unread"
        label={`${unreadCount} unread ${unreadCount === 1 ? 'turn' : 'turns'}`}
        className="mr-2"
      />
    ) : null;

  return (
    <>
      {leadingMark}

      {secondaryLabel ? (
        // Two-line form: title, then the preview in the muted step below it.
        // The trailing slot stays centred by the parent's `items-center`.
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
          <span className="truncate text-md" title={primaryLabel}>
            {primaryLabel}
          </span>
          <span className="truncate text-xs leading-4 text-text-faint" title={secondaryLabel}>
            {secondaryLabel}
          </span>
        </span>
      ) : (
        /* The raw title, un-clipped, so the native tooltip is worth reading. */
        <span className="min-w-0 flex-1 truncate text-left text-md" title={primaryLabel}>
          {primaryLabel}
        </span>
      )}

      {hasTrailingSlot ? (
        // The row's hover actions land in this slot, so it fades out as they
        // fade in — the two occupy the same 56px and never fight over it.
        <span className="relative ml-2 flex h-5 w-14 shrink-0 items-center justify-end overflow-hidden transition-opacity group-hover/row:opacity-0">
          {timestampLabel ? (
            <span
              className={cn(
                'absolute inset-0 flex items-center justify-end whitespace-nowrap text-sm font-normal tabular-nums text-text-faint transition-opacity duration-150',
                showJumpHint && jumpLabel ? 'opacity-0' : 'opacity-100'
              )}
            >
              {timestampLabel}
            </span>
          ) : null}

          {jumpLabel ? (
            <span
              aria-hidden={!showJumpHint}
              className={cn(
                'pointer-events-none absolute right-0 inline-flex h-5 items-center rounded-sm bg-bg-hover px-1.5 font-mono text-3xs leading-none text-text-tertiary transition-opacity duration-150',
                showJumpHint ? 'opacity-100' : 'opacity-0'
              )}
            >
              {jumpLabel}
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );
}
