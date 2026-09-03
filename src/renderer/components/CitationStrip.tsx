import { useMemo } from 'react';
import { Quote, X } from 'lucide-react';

import { collectAssistantCitations, getCitationChipLabel } from '../../shared/citations';

type CitationStripProps = {
  /** Raw composer draft; citation links are parsed out of it. */
  value: string;
  /** Removes one serialized link from the draft. */
  onRemove: (source: string) => void;
};

/**
 * Interim citation chips above the composer textarea.
 *
 * The Lexical rewrite (phase 2) renders these inline; until then the draft is
 * a plain string and raw `atlas-citation://` links would stare at the user.
 * The strip parses links out of the draft and shows one chip each, with
 * removal deleting the link bytes. Click-through to source arrives in phase 4.
 */
export function CitationStrip({ value, onRemove }: CitationStripProps) {
  const citations = useMemo(() => collectAssistantCitations(value), [value]);
  if (citations.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pb-2" aria-label="Cited quotes">
      {citations.map(({ citation, source }) => (
        <span
          key={source}
          title={citation.text}
          className="inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md border border-border-subtle bg-bg-surface px-1.5 text-2xs text-text-secondary"
        >
          <Quote aria-hidden className="size-3 shrink-0" />
          <span className="min-w-0 max-w-[16em] truncate">{getCitationChipLabel(citation)}</span>
          <button
            type="button"
            onClick={() => onRemove(source)}
            aria-label={`Remove cited quote: ${getCitationChipLabel(citation)}`}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-text-faint transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            <X aria-hidden className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
