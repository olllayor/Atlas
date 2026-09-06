/**
 * The turn's work, folded into one row: `Worked for 1m 47s ›`.
 *
 * Codex renders an assistant turn as a labelled rule carrying the elapsed
 * time, with the reasoning, the tool calls and the running commentary between
 * them collapsed underneath it, and only the final reply left in the
 * transcript proper (`docs/codex-parity/design-audit.md` §7,
 * `research-raw.md` §10.9). Atlas used to render the same material as a flat
 * run of rows, which meant a turn that searched the web four times pushed its
 * answer below four `Searched the web` lines.
 *
 * Two rules keep the fold honest:
 * 1. **It opens while the model is working.** Hiding live progress behind a
 *    disclosure is how you get a UI that looks frozen. It collapses itself
 *    when the answer lands — unless the reader has toggled it, which always
 *    wins (`useDisclosure` only records explicit choices).
 * 2. **It cannot hide a question.** A tool waiting on approval forces the
 *    block open: an approval prompt inside a collapsed row is a turn that
 *    never finishes.
 */

import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

import { formatElapsed } from '../../../shared/toolCellGrammar';
import { useDisclosure, useTranscriptUiStore } from '../../stores/useTranscriptUiStore';
import { cn } from '../../lib/utils';
import { Disclosure } from './ToolCell';

export function ActivityBlock({
  id,
  isStreaming = false,
  /**
   * The turn's measured latency, used for turns this session never watched
   * stream (history loaded from the database).
   */
  fallbackDurationMs,
  /**
   * Epoch ms the live turn was dispatched, used while streaming when the
   * window-local timing started late (or never ran) — e.g. the turn was
   * acknowledged but its first token has not arrived, or this window
   * mounted mid-stream. The draft's send time is the truthful start;
   * mount time would undercount both cases.
   */
  fallbackStartMs,
  /** Keeps the block open regardless of the default — see rule 2 above. */
  forceOpen = false,
  /**
   * Open while there is nothing below the fold to read — the model is still
   * working, or the turn ended without a reply. It folds itself the moment the
   * answer starts arriving.
   */
  defaultOpen = false,
  children,
}: {
  id: string;
  isStreaming?: boolean;
  fallbackDurationMs?: number | null;
  fallbackStartMs?: number | null;
  forceOpen?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const startTiming = useTranscriptUiStore((state) => state.startTiming);
  const endTiming = useTranscriptUiStore((state) => state.endTiming);
  const timing = useTranscriptUiStore((state) => state.timings[id]);

  useEffect(() => {
    if (isStreaming) startTiming(id);
    else endTiming(id);
  }, [id, isStreaming, startTiming, endTiming]);

  const [isOpen, toggleOpen] = useDisclosure(id, defaultOpen);
  const open = forceOpen || isOpen;

  // Live tick for the streaming label. Mounts only while the turn is in
  // flight; once it settles the effect — and the ticking — goes away.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (!isStreaming) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isStreaming]);

  // The measured window is the truthful one — it covers tool time, which the
  // provider's own latency number does not always include.
  const durationMs = timing?.durationMs ?? fallbackDurationMs ?? null;
  const liveStartMs = fallbackStartMs ?? timing?.startedAt ?? null;
  const label =
    isStreaming && liveStartMs != null && nowMs != null
      ? `Working ${formatElapsed(nowMs - liveStartMs)}`
      : isStreaming
        ? 'Working'
        : durationMs != null && durationMs >= 1000
          ? `Worked for ${formatElapsed(durationMs)}`
          : 'Worked';

  return (
    <div className="group/activity my-1.5">
      <button
        type="button"
        onClick={toggleOpen}
        // Forced open (a pending approval) makes the toggle a silent no-op —
        // the state would flip in the store while the screen stays put, and
        // `aria-expanded` would keep reporting true. Disabled tells mouse,
        // keyboard and AT the same truth.
        disabled={forceOpen}
        aria-expanded={open}
        aria-label={`${label}. ${open ? 'Hide' : 'Show'} the steps`}
        className={cn(
          'flex w-full min-w-0 items-center gap-1.5 rounded-sm text-left text-sm font-normal text-text-tertiary transition-colors hover:text-text-secondary',
          forceOpen ? 'cursor-default' : 'cursor-pointer'
        )}
      >
        <span className={cn('shrink-0', isStreaming && 'focus-sweep py-0.5 text-text-secondary')}>{label}</span>
        <ChevronRight
          aria-hidden
          className={cn(
            'h-3.5 w-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-fast group-hover/activity:opacity-100 group-focus-within/activity:opacity-100 motion-reduce:transition-none',
            open && 'rotate-90 opacity-100'
          )}
        />
        {/* The labelled rule from the reference: the header reads as a
            section divider rather than as a line of the answer. */}
        <span aria-hidden className="h-px min-w-4 flex-1 bg-border-subtle" />
      </button>

      <Disclosure open={open}>
        {/* No rail, no indent: the reference keeps the expanded steps on the
            same measure as the reply, separated by the header rule alone. */}
        <div className="mt-0.5">{children}</div>
      </Disclosure>
    </div>
  );
}
