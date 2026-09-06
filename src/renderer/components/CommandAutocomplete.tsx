import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

import type { CommandDefinition } from '../../shared/commands';
import { commandToken, filterCommands, matchCommandQuery } from '../../shared/commands';
import type { SlashMenuSkill } from '../../shared/slashMenuSkills';
import {
  dedupeSlashMenuCommands,
  filterSlashMenuSkills,
  formatSkillDisplayName,
  getSlashMenuSkills,
  skillInsertText,
} from '../../shared/slashMenuSkills';
import type { WorkspaceMode } from '../../shared/workspaceModes';
import { notifyError } from '../lib/notify';
import { filterSlashCommands, BUILTIN_SLASH_COMMANDS } from '../lib/slashCommands';

export type SlashMenuSuggestion =
  | { kind: 'command'; definition: CommandDefinition }
  | { kind: 'skill'; skill: SlashMenuSkill };

type UseCommandAutocompleteOptions = {
  value: string;
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  /** Receives built-in command names (`compact`, `review`…) — consumed, never sent. */
  onBuiltinCommand?: (name: string) => void;
  /** Project root for standalone skill discovery; null lists global + plugin skills. */
  projectRoot?: string | null;
  /** Filters mode-specific skills the same way the turn itself is filtered. */
  workspaceMode?: WorkspaceMode;
  /** Off keeps the `/` menu command-only. Defaults to on (opt-out). */
  showSkillsInSlashMenu?: boolean;
};

/**
 * Drives `/command` completion over the same plain textarea `@mentions` use.
 *
 * Picking a command replaces the invocation with its expanded template, so the
 * user reads and edits what will be sent rather than trusting a token to mean
 * the right thing later. The body is fetched at that moment: a bundle can ship
 * hundreds of templates, and none of them are worth holding in the renderer
 * until one is chosen.
 */
export function useCommandAutocomplete({
  value,
  onChange,
  textareaRef,
  disabled,
  onBuiltinCommand,
  projectRoot = null,
  workspaceMode,
  showSkillsInSlashMenu = true,
}: UseCommandAutocompleteOptions) {
  const [pluginCommands, setPluginCommands] = useState<CommandDefinition[]>([]);
  const [skills, setSkills] = useState<SlashMenuSkill[]>([]);
  const [caret, setCaret] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const listboxId = useId();
  const pendingCaretRef = useRef<number | null>(null);

  // Loaded once. A plugin installed mid-session appears after the next reload,
  // which is the same freshness the plugins page itself offers.
  useEffect(() => {
    let cancelled = false;

    void window.atlasChat.plugins
      .commands()
      .then((next) => {
        if (!cancelled) {
          setPluginCommands(next);
        }
      })
      .catch(() => {
        // A composer that cannot list commands is still a working composer.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Skills depend on the workspace (project skills need the project root, and
  // mode-specific bundles are filtered), so they reload when it changes —
  // unlike commands, which are workspace-independent.
  useEffect(() => {
    let cancelled = false;

    if (typeof window.atlasChat.plugins.skills !== 'function') {
      return () => {
        cancelled = true;
      };
    }

    void window.atlasChat.plugins
      .skills({ projectRoot, mode: workspaceMode, hasProject: projectRoot != null })
      .then((next) => {
        if (!cancelled) {
          setSkills(next);
        }
      })
      .catch(() => {
        // Same rule as commands: no skill list, still a working composer.
      });

    return () => {
      cancelled = true;
    };
  }, [projectRoot, workspaceMode]);

  // Built-ins ride the same popup as plugin templates: one grammar, one
  // gesture. They are marked by their `builtin:` qualified name and executed
  // rather than expanded (see `select`).
  const builtinDefinitions = useMemo<CommandDefinition[]>(
    () =>
      BUILTIN_SLASH_COMMANDS.map((command) => ({
        qualifiedName: `builtin:${command.name}`,
        pluginName: 'Atlas',
        name: command.name,
        description: command.description,
        argumentHint: ''
      })),
    []
  );
  const commands = useMemo(
    () => [...builtinDefinitions, ...pluginCommands],
    [builtinDefinitions, pluginCommands]
  );

  const match = useMemo(() => {
    if (disabled || caret == null || commands.length === 0) return null;
    return matchCommandQuery(value, caret);
  }, [caret, commands.length, disabled, value]);

  const query = dismissed ? null : match;
  const suggestions = useMemo<SlashMenuSuggestion[]>(() => {
    if (!query) return [];
    const needle = query.query.toLowerCase();
    const builtinMatches = filterSlashCommands(needle);
    // The skill alias wins over a same-named template command — but only when
    // the skill is actually visible. A hidden skill must not suppress the
    // command it would otherwise shadow.
    const visibleSkills = getSlashMenuSkills(skills, showSkillsInSlashMenu);
    const pluginMatches = filterCommands(
      dedupeSlashMenuCommands(pluginCommands, visibleSkills),
      query.query
    );
    const skillMatches = filterSlashMenuSkills(visibleSkills, needle);
    // Built-ins first: they are the fixed vocabulary, plugin templates follow,
    // skills last under their distinct `/skill:` label.
    return [
      ...builtinDefinitions
        .filter((definition) =>
          builtinMatches.some((command) => commandToken(definition) === `/${command.name}`)
        )
        .map((definition) => ({ kind: 'command' as const, definition })),
      ...pluginMatches.map((definition) => ({ kind: 'command' as const, definition })),
      ...skillMatches.map((skill) => ({ kind: 'skill' as const, skill })),
    ];
  }, [builtinDefinitions, pluginCommands, query, showSkillsInSlashMenu, skills]);
  const isOpen = Boolean(query) && suggestions.length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [query?.query]);

  // A cleared composer re-arms: the next `/` is a fresh attempt, not a
  // continuation of the one that was escaped.
  useEffect(() => {
    if (!value.startsWith('/')) {
      setDismissed(false);
    }
  }, [value]);

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
    (suggestion: SlashMenuSuggestion) => {
      const range = query;
      if (!range) return;

      // Dismissed up front so the popup does not hang over the composer while
      // the body is read.
      setDismissed(true);

      if (suggestion.kind === 'skill') {
        // A skill pick leaves the invocation token the send path already
        // understands (`@plugin skill` or `$name`), replacing the whole
        // `/query` — the caret lands after the trailing space so typing
        // continues the message, not the query.
        const token = skillInsertText(suggestion.skill);
        pendingCaretRef.current = token.length;
        onChange(token);
        return;
      }

      const definition = suggestion.definition;
      if (onBuiltinCommand && definition.qualifiedName.startsWith('builtin:')) {
        onBuiltinCommand(definition.name);
        return;
      }

      void window.atlasChat.plugins
        .commandBody(definition.qualifiedName, range.args)
        .then((body) => {
          pendingCaretRef.current = body.length;
          onChange(body);
        })
        .catch((error) => {
          notifyError(`Could not load /${definition.name}`, error);
          setDismissed(false);
        });
    },
    [onChange, onBuiltinCommand, query]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!isOpen) return false;

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
    [activeIndex, isOpen, select, suggestions]
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
    dismiss: useCallback(() => setDismissed(true), [])
  };
}

type CommandAutocompleteListProps = {
  suggestions: SlashMenuSuggestion[];
  activeIndex: number;
  listboxId: string;
  anchorRef: RefObject<HTMLElement | null>;
  onHover: (index: number) => void;
  onSelect: (suggestion: SlashMenuSuggestion) => void;
};

function skillSourceLabel(skill: SlashMenuSkill): string {
  if (skill.source === 'project') return 'Project';
  if (skill.source === 'global') return 'Global';
  return skill.pluginName;
}

export function CommandAutocompleteList({
  suggestions,
  activeIndex,
  listboxId,
  anchorRef,
  onHover,
  onSelect
}: CommandAutocompleteListProps) {
  // Portalled and viewport-positioned for the same reason the mention list is:
  // the app shell is `overflow-hidden` and would clip it.
  const [anchorRect, setAnchorRect] = useState<{ left: number; bottom: number; width: number } | null>(
    null
  );

  useLayoutEffect(() => {
    const update = () => {
      const element = anchorRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      setAnchorRect({
        bottom: Math.max(8, window.innerHeight - rect.top + 8),
        left: rect.left,
        width: rect.width
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
      aria-label="Commands"
      className="fixed z-50 max-h-[min(240px,40vh)] w-max min-w-[260px] overflow-y-auto overscroll-contain rounded-lg border border-border-default bg-bg-overlay shadow-elevated"
      style={{
        bottom: anchorRect.bottom,
        left: anchorRect.left,
        maxWidth: Math.max(anchorRect.width, 260)
      }}
    >
      {suggestions.map((suggestion, index) => {
        const key =
          suggestion.kind === 'command'
            ? suggestion.definition.qualifiedName
            : `skill:${suggestion.skill.qualifiedName}`;
        const optionId = `${listboxId}-option-${index}`;
        const active = index === activeIndex;
        if (suggestion.kind === 'skill') {
          const skill = suggestion.skill;
          return (
            <button
              key={key}
              id={optionId}
              type="button"
              role="option"
              aria-selected={active}
              tabIndex={-1}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(suggestion);
              }}
              onMouseEnter={() => onHover(index)}
              className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition ${
                active ? 'bg-bg-hover' : 'bg-transparent'
              }`}
            >
              <span className="flex w-full items-baseline gap-2">
                <span className="font-mono text-xs text-text-primary">
                  <span className="text-text-faint">/skill:</span>
                  {formatSkillDisplayName(skill.name)}
                </span>
                {/* Source decides trust the same way the bundle name does for
                    templates: a Project skill reads project files. */}
                <span className="ml-auto shrink-0 text-2xs text-text-faint">
                  {skillSourceLabel(skill)}
                </span>
              </span>
              {skill.description ? (
                <span className="text-2xs leading-4 text-text-tertiary">{skill.description}</span>
              ) : null}
            </button>
          );
        }
        const definition = suggestion.definition;
        return (
          <button
            key={key}
            id={optionId}
            type="button"
            role="option"
            aria-selected={active}
            tabIndex={-1}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(suggestion);
            }}
            onMouseEnter={() => onHover(index)}
            className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition ${
              active ? 'bg-bg-hover' : 'bg-transparent'
            }`}
          >
            <span className="flex w-full items-baseline gap-2">
              <span className="font-mono text-xs text-text-primary">{commandToken(definition)}</span>
              {definition.argumentHint ? (
                <span className="font-mono text-2xs text-text-faint">{definition.argumentHint}</span>
              ) : null}
              {/* Which bundle a template comes from is the part that decides
                  whether to trust what it puts in the box. */}
              <span className="ml-auto shrink-0 text-2xs text-text-faint">{definition.pluginName}</span>
            </span>
            {definition.description ? (
              <span className="text-2xs leading-4 text-text-tertiary">{definition.description}</span>
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
