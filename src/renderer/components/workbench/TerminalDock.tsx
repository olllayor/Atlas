/**
 * The bottom-docked terminal.
 *
 * Codex's desktop app fixes its terminal to the bottom of the window, full
 * width under the conversation, with the right-hand panel left for diffs and
 * tools (openai/codex#15836, #23944). Atlas follows that: the shell is a
 * property of the workspace, not of one tool tab, and a terminal you have to
 * give up the diff view to read is a terminal you stop using.
 *
 * The dock owns the chrome — title, cwd, close — and `TerminalPanel` owns the
 * shell. It stays mounted while collapsed is *false* only: an unmounted xterm
 * loses its scrollback, but the PTY behind it keeps running either way.
 */

import { ChevronDown } from 'lucide-react';

import { cn } from '../../lib/utils';
import { TerminalPanel } from './TerminalPanel';

export function TerminalDock({
  conversationId,
  workspacePath,
  onClose,
  className,
  style,
}: {
  conversationId?: string;
  /** Project root the shell was started in; falls back to the home directory. */
  workspacePath?: string | null;
  onClose: () => void;
  className?: string;
  /** Carries the dragged height from the layout. */
  style?: React.CSSProperties;
}) {
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
        <span className="text-sm text-text-primary">Terminal</span>
        {workspacePath ? (
          <span className="min-w-0 truncate text-2xs text-text-faint" title={workspacePath}>
            {workspacePath}
          </span>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          aria-label="Hide terminal"
          title="Hide terminal"
          className="ml-auto rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <ChevronDown className="size-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        {conversationId ? (
          <TerminalPanel key={conversationId} conversationId={conversationId} />
        ) : (
          <p className="px-3 py-2 text-sm text-text-faint">
            Open a conversation to get a shell rooted in its project folder.
          </p>
        )}
      </div>
    </section>
  );
}
