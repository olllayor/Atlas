import { MessageSquareQuote, X } from 'lucide-react';

import { getCitationChipLabel, type CitedQuoteEntry } from '../../shared/citations';

type CitationTrayProps = {
  /** Structured staged quotes; the textarea never holds serialized bytes. */
  entries: CitedQuoteEntry[];
  /** Removes one staged quote by its stable key. */
  onRemove: (key: string) => void;
};

/**
 * Staged quotes inside the composer box, above the textarea.
 *
 * The tray holds objects, so chips render quote text directly — no link-byte
 * parsing, no duplicate-byte key hacks, no first-occurrence removal bugs.
 * Links serialize only at send time.
 */
export function CitationTray({ entries, onRemove }: CitationTrayProps) {
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pb-2" aria-label="Cited quotes">
      {entries.map(({ key, citation }) => {
        const label = getCitationChipLabel(citation);
        return (
          <span
            key={key}
            title={citation.comment ?? citation.text}
            className="inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md border border-border-subtle bg-bg-surface px-1.5 text-2xs text-text-secondary"
          >
            <MessageSquareQuote aria-hidden className="size-3 shrink-0" />
            <span className="min-w-0 max-w-[16em] truncate">{label}</span>
            {citation.comment ? (
              <span className="shrink-0 rounded-sm bg-bg-muted px-1 text-[10px] text-text-muted">
                noted
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(key)}
              aria-label={`Remove cited quote: ${label}`}
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-text-faint transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              <X aria-hidden className="size-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
