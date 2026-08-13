import { ArrowLeftIcon } from '@radix-ui/react-icons';

/**
 * The bits of chrome every left rail shares — the chat sidebar, the Settings
 * rail and the Sites rail. They had drifted into three dialects of the same
 * two controls (an 11px uppercase legend here, a 13px sentence-case label
 * there; a back row flush to the rail edge in one place and inside the gutter
 * in another), which is the kind of difference you only notice as "this screen
 * feels like a different app".
 */

/**
 * Section label above a run of rows ("Projects", "Chats", "Sites").
 *
 * Sentence case, row-sized, semibold, `--text-primary` — measured off the 2×
 * sidebar frame (`docs/codex-parity/shots/reference/…-14.png`), where the
 * headings are the *brightest* text in the list and the row titles below them
 * are the regular-weight ones. Weight, not dimness, is what separates a
 * heading from its rows.
 */
export function RailSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="min-w-0 flex-1 truncate text-md font-semibold text-text-primary">{children}</span>
  );
}

/**
 * "Back to app" / "Back to chat" — the row that returns a full-screen view to
 * the shell it was opened from. Always the first thing in the rail, inside the
 * rail's own gutter.
 */
export function RailBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-md font-normal text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary"
    >
      <ArrowLeftIcon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}
