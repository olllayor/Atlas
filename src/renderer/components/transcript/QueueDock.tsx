/**
 * The queued-messages dock, sitting between the transcript and the composer.
 *
 * A message sent while the conversation's turn is still running does not
 * start a second stream — it waits its turn. This dock is where the waiting
 * is visible: one quiet strip, oldest first, each row cancellable. Hidden
 * entirely when nothing is queued; collapsed to a count header when the user
 * is not working with it.
 */

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import type { QueuedFollowupEntry } from '../../stores/useAppStore';
import { cn } from '../../lib/utils';

export function QueueDock({
  entries,
  onCancel,
  disabled,
}: {
  entries: QueuedFollowupEntry[];
  onCancel: (requestId: string) => void;
  /** True while an IPC cancellation is in flight for any visible entry. */
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) {
    return null;
  }

  const count = entries.length;

  return (
    <div
      role="region"
      aria-label={`${count} queued ${count === 1 ? 'message' : 'messages'}`}
      className="border-t border-border-subtle bg-bg-base/60 backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-1.5 text-left text-xs text-text-faint transition-colors hover:text-text-secondary motion-reduce:transition-none"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform duration-fast motion-reduce:transition-none',
            expanded && 'rotate-180'
          )}
        />
        <span>
          {count} queued — will send after the current reply
        </span>
      </button>

      {/*
        Same grid-rows disclosure grammar as every other reveal in the
        transcript: content never pops in and shoves the composer around.
        `inert` while collapsed — the clipped rows would otherwise stay in
        the tab order as invisible Cancel buttons.
      */}
      <div
        inert={!expanded}
        className={cn(
          'grid transition-[grid-template-rows] duration-[160ms] ease-out motion-reduce:transition-none',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <ul className="space-y-0.5 px-4 pb-2">
            {entries.map((entry, index) => (
              <li key={entry.requestId} className="group/dock-row flex items-center gap-2 text-sm">
                <span className="shrink-0 tabular-nums text-text-faint" aria-hidden>
                  {index + 1}.
                </span>
                <span className="min-w-0 flex-1 truncate text-text-secondary" title={entry.preview}>
                  {entry.preview}
                </span>
                <button
                  type="button"
                  onClick={() => onCancel(entry.requestId)}
                  disabled={disabled}
                  aria-label={`Cancel queued message: ${entry.preview}`}
                  className="shrink-0 cursor-pointer rounded-sm px-1.5 py-0.5 text-xs text-text-faint opacity-0 transition-[opacity,color] duration-fast group-hover/dock-row:opacity-100 hover:text-error focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
