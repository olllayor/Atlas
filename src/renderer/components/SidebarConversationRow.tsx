import { BrushSpinner } from '@/components/ui/brush-spinner';

import { cn } from '../lib/utils';

type SidebarConversationRowProps = {
  isRunning: boolean;
  isFailed?: boolean;
  primaryLabel: string;
  timestampLabel: string | null;
  jumpLabel?: string | null;
  showJumpHint?: boolean;
};

/**
 * Single-line conversation row content, per the Codex reference: truncated
 * title + a right-aligned relative time in a fixed slot.
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
  primaryLabel,
  timestampLabel,
  jumpLabel,
  showJumpHint = false,
}: SidebarConversationRowProps) {
  const hasTrailingSlot = timestampLabel != null || jumpLabel != null;

  return (
    <>
      {isRunning ? (
        <BrushSpinner size={12} strokeWidth={1.5} speed={1.5} className="mr-2 shrink-0" />
      ) : null}

      {/*
        A failed turn keeps a dot rather than a word: the row is one line, and
        the reason is one click away in the transcript. Same 12px slot as the
        spinner it replaces, so rows never shift as a task ends.
      */}
      {!isRunning && isFailed ? (
        <span
          role="img"
          aria-label="Last turn failed"
          title="Last turn failed"
          className="mr-2 size-1.5 shrink-0 rounded-full bg-error"
        />
      ) : null}

      {/* The raw title, un-clipped, so the native tooltip is worth reading. */}
      <span className="min-w-0 flex-1 truncate text-left text-md" title={primaryLabel}>
        {primaryLabel}
      </span>

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
