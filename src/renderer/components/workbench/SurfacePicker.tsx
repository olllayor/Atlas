/**
 * What the right panel shows when it holds no surfaces.
 *
 * The empty state *is* the menu. A panel that opens onto four labels the user
 * has to click to discover teaches nothing; this one names every surface, says
 * what it does, and gives it a letter. Surfaces this conversation cannot open
 * stay on screen, dimmed, with the reason in place of the description — the
 * absence of a pull request is information, and hiding the card would read as
 * a missing feature.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '../../lib/utils';
import type { RightPanelKind } from './rightPanelModel';
import { SURFACE_DEFINITIONS, type SurfaceContext } from './surfaceRegistry';
import {
  SHORTCUT_BLOCKING_LAYERS,
  surfaceShortcutActionForKey,
  surfaceShortcutTargetsTypingContext,
} from './surfaceShortcuts';

export type SurfacePickerProps = {
  context: SurfaceContext;
  onOpen: (kind: RightPanelKind) => void;
};

export function SurfacePicker({ context, onOpen }: SurfacePickerProps) {
  // -1 is "no highlight". It appears on hover or arrow use, never at rest:
  // a card pre-selected on mount reads as a default the user did not choose.
  const [highlight, setHighlight] = useState(-1);

  const actions = SURFACE_DEFINITIONS.filter((definition) => definition.launcher).map((definition) => {
    const availability = definition.availability(context);
    return {
      kind: definition.kind,
      label: definition.label,
      icon: definition.icon,
      shortcut: definition.shortcut,
      available: availability.available,
      body: availability.available ? definition.description : availability.hint,
      // Live running/waiting count only; idle presents as settled (no badge).
      badge: definition.kind === 'agents' ? context.liveAgentCount : 0,
    };
  });

  const openable = actions.filter((action) => action.available);
  const highlightIndex = openable.length === 0 ? -1 : Math.min(highlight, openable.length - 1);

  // Letters work while the picker is *visible*, not only while it is focused:
  // focus moves on any stray click. Capture phase so an app-level handler
  // cannot swallow the key first; typing contexts and open overlays are
  // checked before anything is claimed.
  const openableRef = useRef(openable);
  openableRef.current = openable;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const action = surfaceShortcutActionForKey(openableRef.current, event);
      if (!action) return;
      if (document.querySelector(SHORTCUT_BLOCKING_LAYERS)) return;
      if (event.target instanceof Element && surfaceShortcutTargetsTypingContext(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onOpenRef.current(action.kind);
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (openable.length === 0) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      setHighlight((highlightIndex + 1) % openable.length);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setHighlight(
        highlightIndex === -1 ? openable.length - 1 : (highlightIndex - 1 + openable.length) % openable.length
      );
      return;
    }
    if (event.key === 'Enter') {
      // A focused card owns its own activation; only the container's own
      // focus opens from the highlight.
      if (event.target instanceof HTMLElement && event.target.closest('button')) return;
      const action = openable[highlightIndex];
      if (!action) return;
      event.preventDefault();
      onOpen(action.kind);
    }
  };

  // Stable identity, so React runs this on mount rather than re-focusing the
  // container on every render.
  const focusOnMount = useCallback((node: HTMLDivElement | null) => {
    node?.focus();
  }, []);

  return (
    <div
      ref={focusOnMount}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Open a surface"
      className="flex h-full flex-col items-center justify-center overflow-y-auto px-5 outline-none scrollbar-auto-hide"
    >
      <div className="w-full max-w-md">
        <div className="pb-4 text-center">
          <h3 className="text-base text-text-primary">Open a surface</h3>
          <p className="pt-0.5 text-sm text-text-faint">Choose what to show in the right panel.</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => {
            const Icon = action.icon;
            const index = openable.indexOf(action);
            const highlighted = highlightIndex !== -1 && index === highlightIndex;

            const content = (
              <>
                <span className="flex w-full items-center gap-2">
                  <span className="relative inline-flex shrink-0">
                    <Icon className="size-4" aria-hidden />
                    {action.badge > 0 ? (
                      <span
                        aria-hidden
                        className="absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-bg-elevated px-1 text-[9px] tabular-nums text-text-secondary"
                      >
                        {action.badge}
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-sm text-text-primary">{action.label}</span>
                  <span className="ml-auto shrink-0 rounded border border-border-default px-1 font-mono text-[10px] text-text-faint">
                    {action.shortcut}
                  </span>
                </span>
                <span className="pt-1 text-left text-xs leading-relaxed text-text-faint">
                  {action.body}
                </span>
              </>
            );

            return action.available ? (
              <button
                key={action.kind}
                type="button"
                onClick={() => onOpen(action.kind)}
                onMouseEnter={() => setHighlight(index)}
                onMouseLeave={() => setHighlight((current) => (current === index ? -1 : current))}
                className={cn(
                  'flex flex-col items-start rounded-lg border border-border-subtle p-3 text-left transition-colors',
                  highlighted ? 'bg-bg-hover' : 'hover:bg-bg-hover'
                )}
              >
                {content}
              </button>
            ) : (
              <div
                key={action.kind}
                aria-disabled
                className="flex flex-col items-start rounded-lg border border-border-subtle p-3 opacity-40"
              >
                {content}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
