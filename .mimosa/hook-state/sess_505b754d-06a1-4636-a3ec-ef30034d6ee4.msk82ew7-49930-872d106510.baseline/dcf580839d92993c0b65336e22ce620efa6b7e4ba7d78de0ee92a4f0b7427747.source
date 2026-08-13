/**
 * Find-in-scrollback for the terminal dock.
 *
 * A floating pill rather than a row in the header: the dock is short, and a
 * search field that permanently costs a line of shell is a search field that
 * gets closed. It overlays the top-right of the grid, where the newest output
 * is least likely to be.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';

export function TerminalSearchBar({
  onSearch,
  onClose,
}: {
  /** Returns whether the query matched, so the field can say when it did not. */
  onSearch: (query: string, direction: 'next' | 'previous') => boolean;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [missed, setMissed] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = (direction: 'next' | 'previous') => {
    if (!query) {
      setMissed(false);
      return;
    }
    setMissed(!onSearch(query, direction));
  };

  return (
    <div
      role="search"
      className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-lg border border-border-default bg-bg-overlay p-1 shadow-lg"
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setMissed(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            run(event.shiftKey ? 'previous' : 'next');
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder="Find"
        aria-label="Find in terminal"
        spellCheck={false}
        className={`h-6 w-44 rounded-md bg-transparent px-2 text-xs text-text-primary outline-none placeholder:text-text-faint ${
          missed ? 'text-error' : ''
        }`}
      />

      <button
        type="button"
        onClick={() => run('previous')}
        aria-label="Previous match"
        title="Previous match (⇧⏎)"
        className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
      >
        <ArrowUp className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => run('next')}
        aria-label="Next match"
        title="Next match (⏎)"
        className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
      >
        <ArrowDown className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close search"
        title="Close search (Esc)"
        className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
