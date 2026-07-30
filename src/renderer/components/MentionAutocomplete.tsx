import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const listboxId = useId();
  // Set when we programmatically rewrite the value, so the caret lands after
  // the inserted token instead of at the end of the textarea.
  const pendingCaretRef = useRef<number | null>(null);

  // Matched independently of `dismissed` so a *new* `@` can re-arm the popup:
  // folding the dismissal into the match made one Escape (or blur) kill
  // completion for the rest of the session.
  const match = useMemo(() => {
    if (disabled || caret == null) return null;
    return matchMentionQuery(value, caret);
  }, [caret, disabled, value]);

  const query = dismissed ? null : match;
  const suggestions = useMemo(() => (query ? filterMentions(query.query) : []), [query]);
  const isOpen = Boolean(query) && suggestions.length > 0;

  const triggerStart = match?.start ?? null;
  useEffect(() => {
    // A different trigger index means the user typed a fresh `@`.
    setDismissed(false);
  }, [triggerStart]);

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

  const activeOptionId = isOpen ? `${listboxId}-option-${activeIndex}` : undefined;

  return {
    isOpen,
    suggestions,
    activeIndex,
    activeOptionId,
    listboxId,
    setActiveIndex,
    select,
    handleKeyDown,
    syncCaret,
    dismiss: useCallback(() => setDismissed(true), []),
    /** Focusing the composer always re-arms completion. */
    rearm: useCallback(() => setDismissed(false), []),
  };
}

type MentionAutocompleteListProps = {
  suggestions: MentionDefinition[];
  activeIndex: number;
  listboxId: string;
  /** Element the popup floats above — normally the textarea's wrapper. */
  anchorRef: RefObject<HTMLElement | null>;
  onHover: (index: number) => void;
  onSelect: (definition: MentionDefinition) => void;
};

export function MentionAutocompleteList({
  suggestions,
  activeIndex,
  listboxId,
  anchorRef,
  onHover,
  onSelect,
}: MentionAutocompleteListProps) {
  // Portalled and viewport-positioned: the app shell is `overflow-hidden`, so
  // an absolutely-positioned popup inside the composer gets clipped.
  const [anchorRect, setAnchorRect] = useState<{ left: number; bottom: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const element = anchorRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      setAnchorRect({
        bottom: Math.max(8, window.innerHeight - rect.top + 8),
        left: rect.left,
        width: rect.width,
      });
    };

    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [anchorRef, suggestions.length]);

  if (suggestions.length === 0 || !anchorRect || typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="listbox"
      id={listboxId}
      aria-label="Mentions"
      className="fixed z-50 max-h-[min(240px,40vh)] w-max min-w-[220px] overflow-y-auto overscroll-contain rounded-lg border border-border-default bg-bg-overlay shadow-elevated"
      style={{
        bottom: anchorRect.bottom,
        left: anchorRect.left,
        maxWidth: Math.max(anchorRect.width, 220),
      }}
    >
      {suggestions.map((definition, index) => (
        <button
          key={definition.id}
          id={`${listboxId}-option-${index}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          tabIndex={-1}
          // Keep focus in the textarea so the caret does not jump on click.
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(definition);
          }}
          onMouseEnter={() => onHover(index)}
          className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition ${
            index === activeIndex ? 'bg-bg-hover' : 'bg-transparent'
          }`}
        >
          <span className="font-mono text-xs text-text-primary">{getMentionToken(definition)}</span>
          <span className="text-2xs leading-4 text-text-tertiary">{definition.description}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}
