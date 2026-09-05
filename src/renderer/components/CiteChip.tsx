import { MessageSquareQuote } from 'lucide-react';

import { getCitationChipLabel, type AssistantCitation } from '../../shared/citations';
import { cn } from '../lib/utils';

type CiteChipProps = {
  citation: AssistantCitation;
  /** Click-through to the quoted source; absent, the chip is inert text. */
  onNavigate?: (citation: AssistantCitation) => void;
  className?: string;
};

/**
 * A cited quote inside a transcript message. Same shell as the composer's
 * tray chips so quotes read as one object in both places. Renders as a button
 * only when a navigation target exists.
 */
export function CiteChip({ citation, onNavigate, className }: CiteChipProps) {
  const label = getCitationChipLabel(citation);
  const title = citation.comment ?? citation.text;

  const inner = (
    <>
      <MessageSquareQuote aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 max-w-[16em] truncate">{label}</span>
    </>
  );

  if (!onNavigate) {
    return (
      <span
        title={title}
        className={cn(
          'inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md border border-border-subtle bg-bg-surface px-1.5 text-2xs text-text-secondary',
          className,
        )}
      >
        {inner}
      </span>
    );
  }

  return (
    <button
      type="button"
      title={`View cited text: ${title}`}
      aria-label={`View cited text: ${label}`}
      onClick={() => onNavigate(citation)}
      className={cn(
        'inline-flex h-6 min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-md border border-border-subtle bg-bg-surface px-1.5 text-2xs text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary',
        className,
      )}
    >
      {inner}
    </button>
  );
}
