/**
 * The `@` picker for installed plugins and their skills.
 *
 * Two stages in one popup: `@git` lists plugins, and a space after a complete
 * plugin name switches the list to that plugin's skills. Modelled on
 * `MentionAutocomplete` rather than merged into it because the two answer
 * different questions — that one completes a fixed set of built-in capabilities,
 * this one completes whatever happens to be installed — and because the plugin
 * list has a second stage the fixed one has no use for.
 *
 * Unavailable plugins are listed with their reason rather than hidden. A
 * disabled plugin missing from the picker reads as "not installed", and sends
 * the user to the browser looking for something already there.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

import type { PluginSummary } from '../../shared/contracts';
import type { PluginMentionEntry, PluginMentionSuggestion } from '../../shared/pluginMentions';
import {
  applyPluginMention,
  matchPluginMentionQuery,
  suggestPluginMentions
} from '../../shared/pluginMentions';
import { cn } from '../lib/utils';

/**
 * The installed set, as the picker needs it.
 *
 * Disabled and revoked bundles are included and marked. `PluginsView` already
 * separates them, so the reason is available without a second call.
 */
export function toPluginMentionCatalog(plugins: PluginSummary[]): PluginMentionEntry[] {
  return plugins.map((plugin) => ({
    name: plugin.name,
    description: plugin.description,
    skills: plugin.skills.map((skill) => skill.name),
    available: plugin.enabled && !plugin.blockedReason,
    unavailableReason: plugin.blockedReason
      ? plugin.blockedReason
      : plugin.enabled
        ? undefined
        : 'Switched off. Enable it in Plugins.'
  }));
}

type UsePluginMentionAutocompleteOptions = {
  value: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  catalog: PluginMentionEntry[];
  disabled?: boolean;
};

export function usePluginMentionAutocomplete({
  value,
  onChange,
  textareaRef,
  catalog,
  disabled
}: UsePluginMentionAutocompleteOptions) {
  const [caret, setCaret] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const listboxId = useId();
  const pendingCaretRef = useRef<number | null>(null);

  // Matched independently of `dismissed`, like the sibling hook: folding the
  // dismissal into the match makes one Escape kill completion for good.
  const match = useMemo(() => {
    if (disabled || caret == null) return null;
    return matchPluginMentionQuery(value, caret, catalog);
  }, [caret, catalog, disabled, value]);

  const query = dismissed ? null : match;
  const suggestions = useMemo(
    () => (query ? suggestPluginMentions(query, catalog) : []),
    [catalog, query]
  );
  const isOpen = Boolean(query) && suggestions.length > 0;

  const triggerStart = match?.start ?? null;
  useEffect(() => {
    setDismissed(false);
  }, [triggerStart]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query?.pluginQuery, query?.skillQuery, query?.start]);

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
    (suggestion: PluginMentionSuggestion) => {
      if (!query) return;
      const next = applyPluginMention(value, query, suggestion);
      pendingCaretRef.current = next.caret;
      setDismissed(false);
      onChange(next.text);
    },
    [onChange, query, value]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!isOpen) {
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
    activeOptionId: isOpen ? `${listboxId}-option-${activeIndex}` : undefined,
    listboxId,
    setActiveIndex,
    select,
    handleKeyDown,
    syncCaret,
    dismiss: useCallback(() => setDismissed(true), []),
    rearm: useCallback(() => setDismissed(false), [])
  };
}

type PluginMentionAutocompleteListProps = {
  suggestions: PluginMentionSuggestion[];
  activeIndex: number;
  listboxId: string;
  onHover: (index: number) => void;
  onSelect: (suggestion: PluginMentionSuggestion) => void;
};

export function PluginMentionAutocompleteList({
  suggestions,
  activeIndex,
  listboxId,
  onHover,
  onSelect
}: PluginMentionAutocompleteListProps) {
  return (
    <ul
      id={listboxId}
      role="listbox"
      aria-label="Plugins"
      className="absolute bottom-full left-0 z-30 mb-2 max-h-64 w-full max-w-md overflow-y-auto rounded-lg border border-border-default bg-bg-panel py-1 shadow-lg"
    >
      {suggestions.map((suggestion, index) => {
        const unavailable = suggestion.entry.unavailableReason;

        return (
          <li
            key={suggestion.kind === 'plugin' ? suggestion.entry.name : `${suggestion.entry.name}:${suggestion.skill}`}
            id={`${listboxId}-option-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => {
              // The composer keeps focus: a blur here would close the popup
              // before the click resolves.
              event.preventDefault();
              onSelect(suggestion);
            }}
            className={cn(
              'cursor-pointer px-3 py-1.5',
              index === activeIndex ? 'bg-bg-active' : 'hover:bg-bg-hover'
            )}
          >
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-text-primary">
                {suggestion.kind === 'plugin'
                  ? `@${suggestion.entry.name}`
                  : suggestion.skill}
              </span>
              {suggestion.kind === 'skill' ? (
                <span className="text-3xs text-text-faint">skill</span>
              ) : null}
              {unavailable ? (
                <span className="ml-auto shrink-0 text-3xs text-warning-text">unavailable</span>
              ) : null}
            </div>
            <p className="truncate text-2xs text-text-tertiary">
              {/* The reason replaces the description rather than joining it: a
                  row the user cannot act on should say why, not describe what
                  they are missing. */}
              {unavailable ?? suggestion.entry.description}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
