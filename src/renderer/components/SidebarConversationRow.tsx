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
 * **Where state is shown.** Nothing renders to the left of the title. The
 * reference thread list carries no marks at all (`reference-visual-spec.md` §3:
 * no avatars, no unread badges) and shows work in flight by shimmering the
 * label itself. Atlas has one thing that list does not — a thread can be
 * blocked on an approval — so state lives in the trailing slot instead, where
 * the timestamp already is:
 *
 * - blocked or failed: a word replaces the time
 * - running: the preview line shimmers, and the time counts up on its own
 * - unread: the time itself darkens to full ink
 *
 * The leading dot this replaced moved the title 20px sideways whenever a
 * thread changed state, which is what made a busy column read as noise.
 *
 * The trailing slot never changes width and its occupants (time, state word,
 * jump-hint chip) cross-fade in place, so hovering or holding a modifier moves
 * nothing. It is omitted entirely when the row has none of them: 56px of
 * reserved gutter on a row that will never fill it is 56px stolen from the
 * title. The parent owns hover/active backgrounds, row height and the context
 * menu.
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
  /*
    One slot, one state word, and the two never render together. Precedence is
    "what happens if you keep ignoring this row" — a thread waiting on you
    outranks one that already gave up.
  */
  const stateWord =
    attentionLevel === 'needsInput' && !isFailed
      ? { label: 'Approve', title: 'Waiting for your approval', tone: 'warning' as const }
      : isFailed
        ? { label: 'Failed', title: 'Last turn failed', tone: 'error' as const }
        : null;

  const isUnread = !stateWord && !isRunning && attentionLevel === 'unread' && unreadCount > 0;
  const hasTrailingSlot = timestampLabel != null || jumpLabel != null || stateWord != null;

  return (
    <>
      {secondaryLabel ? (
        // Two-line form: title, then the preview in the muted step below it.
        // The trailing slot stays centred by the parent's `items-center`.
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
          <span className="truncate text-md" title={primaryLabel}>
            {primaryLabel}
          </span>
          <span
            className={cn(
              'truncate text-xs leading-4 text-text-faint',
              // The reference's running indicator: the label moves, nothing
              // else does. Reduced motion leaves it painted and static.
              isRunning && 'motion-shimmer text-text-secondary'
            )}
            title={secondaryLabel}
          >
            {secondaryLabel}
          </span>
        </span>
      ) : (
        /* The raw title, un-clipped, so the native tooltip is worth reading.
           With no preview line the title is the only thing left to shimmer. */
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-left text-md',
            isRunning && 'motion-shimmer'
          )}
          title={primaryLabel}
        >
          {primaryLabel}
        </span>
      )}

      {hasTrailingSlot ? (
        // The row's hover actions land in this slot, so it fades out as they
        // fade in — the two occupy the same 56px and never fight over it.
        <span className="relative ml-2 flex h-5 w-14 shrink-0 items-center justify-end overflow-hidden transition-opacity group-hover/row:opacity-0">
          {stateWord ? (
            <span
              title={stateWord.title}
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
                'absolute inset-0 flex items-center justify-end whitespace-nowrap text-sm tabular-nums transition-opacity duration-150',
                // Unread output is worth noticing but not worth acting on, so
                // it borrows weight from the timestamp rather than adding a
                // mark of its own.
                isUnread ? 'font-medium text-text-primary' : 'font-normal text-text-faint',
                showJumpHint && jumpLabel ? 'opacity-0' : 'opacity-100'
              )}
              title={isUnread ? `${unreadCount} unread ${unreadCount === 1 ? 'turn' : 'turns'}` : undefined}
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
