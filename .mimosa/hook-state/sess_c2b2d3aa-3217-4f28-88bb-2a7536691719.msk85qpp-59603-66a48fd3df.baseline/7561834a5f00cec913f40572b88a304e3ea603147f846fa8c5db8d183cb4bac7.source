/**
 * The bottom-docked terminal.
 *
 * Codex's desktop app fixes its terminal to the bottom of the window, full
 * width under the conversation, with the right-hand panel left for diffs and
 * tools (openai/codex#15836, #23944). Atlas follows that: the shell is a
 * property of the workspace, not of one tool tab, and a terminal you have to
 * give up the diff view to read is a terminal you stop using.
 *
 * The dock owns the chrome — title, cwd, actions — and `TerminalPanel` owns the
 * shell. It stays mounted while collapsed is *false* only: an unmounted xterm
 * loses its scrollback, but the PTY behind it keeps running either way.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Eraser, Maximize2, Minimize2, Search, SquareTerminal } from 'lucide-react';

import { cn } from '../../lib/utils';
import { TerminalPanel, type TerminalPanelHandle } from './TerminalPanel';

/**
 * The cwd reads as a path, not a sentence: the folder you are in carries the
 * meaning, and the parents are there for disambiguation only.
 */
function splitPath(path: string) {
  const trimmed = path.replace(/\/+$/, '');
  const index = trimmed.lastIndexOf('/');
  if (index <= 0) {
    return { parent: '', name: trimmed || '/' };
  }
  return { parent: trimmed.slice(0, index + 1), name: trimmed.slice(index + 1) };
}

export function TerminalDock({
  conversationId,
  workspacePath,
  onClose,
  expanded,
  onToggleExpanded,
  shortcutLabel,
  className,
  style,
}: {
  conversationId?: string;
  /** Project root the shell was started in; falls back to the home directory. */
  workspacePath?: string | null;
  onClose: () => void;
  /** Whether the dock is filling the available height. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /** e.g. `⌘J` — shown on the close button so the shortcut is discoverable. */
  shortcutLabel?: string | null;
  className?: string;
  /** Carries the dragged height from the layout. */
  style?: React.CSSProperties;
}) {
  const panelRef = useRef<TerminalPanelHandle | null>(null);
  // The prop is the *intended* cwd; the PTY reports the one it actually got
  // (it falls back to the home directory when no project is attached).
  const [actualCwd, setActualCwd] = useState<string | null>(null);
  const cwd = actualCwd ?? workspacePath ?? null;
  const display = cwd ? splitPath(cwd) : null;

  const onCwd = useCallback((next: string) => setActualCwd(next), []);

  // Opening the dock is an act of wanting to type in it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [conversationId]);

  return (
    <section
      aria-label="Terminal"
      style={style}
      className={cn('flex min-h-0 flex-col overflow-hidden bg-bg-base', className)}
    >
      {/*
        A short header rather than a tab bar: there is one shell per
        conversation, and a tab strip with a single tab is chrome that says
        nothing. Hairline on top only — the seam doubles as the drag handle's
        resting line.
      */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border-subtle px-3">
        <SquareTerminal className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
        <span className="shrink-0 text-xs font-medium text-text-secondary">Terminal</span>

        {display ? (
          // 12px — Codex's `--font-size-small`, the size its chrome uses for
          // secondary labels (research-raw.md §2.1). 11px was below the
          // reference's own `max(11px, …)` floor and read as a caption.
          <span
            className="min-w-0 truncate font-mono text-xs text-text-faint"
            title={cwd ?? undefined}
          >
            {display.parent}
            <span className="text-text-tertiary">{display.name}</span>
          </span>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <DockButton
            label="Find in terminal"
            hint="⌘F"
            onClick={() => panelRef.current?.openSearch()}
          >
            <Search className="size-3.5" aria-hidden />
          </DockButton>

          <DockButton label="Clear terminal" hint="⌘K" onClick={() => panelRef.current?.clear()}>
            <Eraser className="size-3.5" aria-hidden />
          </DockButton>

          {/* The zoom exists on the keyboard either way; the buttons are what
              tell you it exists at all. Reset stays keyboard-only rather than
              taking a third slot — the tooltips carry it. */}
          <DockButton
            label="Smaller text"
            hint="⌘−, ⌘0 resets"
            onClick={() => panelRef.current?.zoom('out')}
          >
            <span aria-hidden className="block w-3.5 text-center text-2xs leading-none">
              A
            </span>
          </DockButton>

          <DockButton label="Larger text" hint="⌘+, ⌘0 resets" onClick={() => panelRef.current?.zoom('in')}>
            <span aria-hidden className="block w-3.5 text-center text-sm leading-none">
              A
            </span>
          </DockButton>

          {onToggleExpanded ? (
            <DockButton
              label={expanded ? 'Restore terminal height' : 'Expand terminal'}
              onClick={onToggleExpanded}
            >
              {expanded ? (
                <Minimize2 className="size-3.5" aria-hidden />
              ) : (
                <Maximize2 className="size-3.5" aria-hidden />
              )}
            </DockButton>
          ) : null}

          <DockButton label="Hide terminal" hint={shortcutLabel ?? undefined} onClick={onClose}>
            <ChevronDown className="size-4" aria-hidden />
          </DockButton>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {conversationId ? (
          <TerminalPanel
            key={conversationId}
            ref={panelRef}
            conversationId={conversationId}
            onCwd={onCwd}
          />
        ) : (
          <p className="px-3 py-2 text-sm text-text-faint">
            Open a conversation to get a shell rooted in its project folder.
          </p>
        )}
      </div>
    </section>
  );
}

function DockButton({
  label,
  hint,
  onClick,
  children,
}: {
  label: string;
  /** Appended to the tooltip, so the keyboard route is discoverable. */
  hint?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
    >
      {children}
    </button>
  );
}
