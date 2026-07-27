import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

import {
  type MentionDefinition,
  applyMention,
  filterMentions,
  getMentionToken,
  matchMentionQuery,
} from '../../shared/mentions';

type UseMentionAutocompleteOptions = {
  value: string;
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
};

/**
 * Drives `@mention` completion over a plain textarea.
 *
 * The composer stays a normal controlled textarea — the mention lives in the
 * text itself, so nothing else in the send path needs to understand a richer
 * document model.
 */
export function useMentionAutocomplete({
  value,
  onChange,
  textareaRef,
  disabled,
}: UseMentionAutocompleteOptions) {
  const [caret, setCaret] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  // Set when we programmatically rewrite the value, so the caret lands after
  // the inserted token instead of at the end of the textarea.
  const pendingCaretRef = useRef<number | null>(null);

  const query = useMemo(() => {
    if (disabled || dismissed || caret == null) return null;
    return matchMentionQuery(value, caret);
  }, [caret, disabled, dismissed, value]);

  const suggestions = useMemo(() => (query ? filterMentions(query.query) : []), [query]);
  const isOpen = Boolean(query) && suggestions.length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [query?.query, query?.start]);

  useEffect(() => {
    const pending = pendingCaretRef.current;
    if (pending == null) return;
    pendingCaretRef.current = null;

    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(pending, pending);
    setCaret(pending);
  }, [textareaRef, value]);

  const syncCaret = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    setCaret(textarea.selectionStart);
  }, [textareaRef]);

  const select = useCallback(
    (definition: MentionDefinition) => {
      if (!query) return;
      const next = applyMention(value, query, definition);
      pendingCaretRef.current = next.caret;
      setDismissed(false);
      onChange(next.text);
    },
    [onChange, query, value]
  );

  /**
   * Returns true when the key was consumed by the popup. The caller must then
   * preventDefault so the composer does not also submit or move the caret.
   */
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!isOpen) {
        // Re-arm after a dismissal once the user leaves the mention.
        if (dismissed && (event.key === 'Backspace' || event.key === ' ')) setDismissed(false);
        return false;
      }

      switch (event.key) {
        case 'ArrowDown':
          setActiveIndex((index) => (index + 1) % suggestions.length);
          return true;
        case 'ArrowUp':
          setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
          return true;
        case 'Enter':
        case 'Tab':
          select(suggestions[activeIndex]);
          return true;
        case 'Escape':
          setDismissed(true);
          return true;
        default:
          return false;
      }
    },
    [activeIndex, dismissed, isOpen, select, suggestions]
  );

  return {
    isOpen,
    suggestions,
    activeIndex,
    setActiveIndex,
    select,
    handleKeyDown,
    syncCaret,
    dismiss: () => setDismissed(true),
  };
}

export function MentionAutocompleteList({
  suggestions,
  activeIndex,
  onHover,
  onSelect,
}: {
  suggestions: MentionDefinition[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (definition: MentionDefinition) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Mentions"
      className="absolute bottom-full left-0 z-30 mb-2 w-[320px] max-w-full overflow-hidden border border-[var(--border-default)] bg-bg-overlay shadow-elevated"
    >
      {suggestions.map((definition, index) => (
        <button
          key={definition.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          // Keep focus in the textarea so the caret does not jump on click.
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(definition);
          }}
          onMouseEnter={() => onHover(index)}
          className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition ${
            index === activeIndex ? 'bg-[var(--bg-hover)]' : 'bg-transparent'
          }`}
        >
          <span className="font-mono text-[12.5px] text-text-primary">{getMentionToken(definition)}</span>
          <span className="text-[11.5px] leading-4 text-text-tertiary">{definition.description}</span>
        </button>
      ))}
    </div>
  );
}
