/**
 * Reasoning as an activity row.
 *
 * The Codex app renders thinking as a single dim summary row — `Thought
 * for 8s` — with no bullet, no gutter, no card
 * (`docs/codex-parity/reference-visual-spec.md` §5). While the model is
 * thinking the row reads `Thinking` with the existing text shimmer.
 * Clicking expands the reasoning text inline below, indented, dim.
 *
 * The reasoning message part carries no timestamps, so elapsed time is
 * still measured in the client — but it is measured into the transcript UI
 * store rather than component state. That is the difference between "the
 * clock resets every time the row scrolls out of view" and a duration that
 * survives the virtualizer unmounting the row mid-stream.
 *
 * Historical rows (which never streamed in this session) have no timing
 * entry and read as the bare `Thought`, which is honest: we do not know
 * how long it took.
 */

import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import { formatElapsed } from '../../../shared/toolCellGrammar';
import {
  stableId,
  useDisclosure,
  useTranscriptUiStore,
} from '../../stores/useTranscriptUiStore';
import { RAW_BLOCK, useRawTranscript } from '../../lib/rawTranscript';
import { cn } from '../../lib/utils';
import { Disclosure } from './ToolCell';
import { MessageResponse } from '../ai-elements/message';

export function ReasoningCell({
  text,
  isStreaming = false,
  partId,
}: {
  text?: string | null;
  isStreaming?: boolean;
  /**
   * The reasoning part's id. Optional because the transcript does not
   * currently thread it through; without it the cell falls back to hashing
   * the text's leading chunk, which is stable because reasoning text only
   * ever appends.
   */
  partId?: string;
}) {
  const trimmed = text?.trim();

  const cellId = useMemo(
    () => partId ?? stableId('reasoning', (trimmed ?? '').slice(0, 96)),
    [partId, trimmed]
  );

  const startTiming = useTranscriptUiStore((state) => state.startTiming);
  const endTiming = useTranscriptUiStore((state) => state.endTiming);
  const timing = useTranscriptUiStore((state) => state.timings[cellId]);

  // The hashed fallback id only settles once ~96 characters have streamed
  // in, so the first delta or two can produce a throwaway id. Handing the
  // previous one to `startTiming` carries its start time across.
  const previousCellId = useRef<string | null>(null);

  useEffect(() => {
    if (isStreaming) startTiming(cellId, previousCellId.current ?? undefined);
    else endTiming(cellId);
    previousCellId.current = cellId;
  }, [cellId, isStreaming, startTiming, endTiming]);

  // Collapsed by default, streaming or not — the reference app shows only
  // the shimmering `Thinking` label while the model works. `useDisclosure`
  // records explicit toggles, so a manual open survives the transition to
  // done.
  const [isOpen, toggleOpen] = useDisclosure(cellId, false);
  const raw = useRawTranscript();

  // Finished with nothing to show → no row. Still streaming with nothing
  // yet → the bare shimmer label, which is exactly the reference's resting
  // state for a thinking model.
  if (!trimmed && !isStreaming) return null;

  const durationMs = timing?.durationMs ?? null;
  const label = isStreaming
    ? 'Thinking'
    : durationMs != null && durationMs >= 1000
      ? `Thought for ${formatElapsed(durationMs)}`
      : 'Thought';

  if (!trimmed) {
    return (
      <div className="my-1.5 flex min-h-[1.5rem] items-center text-sm font-normal text-text-tertiary">
        <span className="motion-shimmer">{label}</span>
      </div>
    );
  }

  if (raw) {
    // Label and text in one block, always open. Reasoning is prose, and the
    // markdown pipeline is exactly what raw mode is asked to skip.
    return (
      <div className="my-1.5">
        <pre className={cn('app-code-text m-0 leading-[1.55] text-text-tertiary', RAW_BLOCK)}>
          {`${label}\n${trimmed}`}
        </pre>
      </div>
    );
  }

  return (
    <div className="group/cell my-1.5">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        aria-label={`${label}. ${isOpen ? 'Hide' : 'Show'} reasoning`}
        className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-left text-sm font-normal leading-relaxed text-text-tertiary transition-colors hover:text-text-secondary"
      >
        <span title={label} className={cn('min-w-0 truncate', isStreaming && 'motion-shimmer')}>
          {label}
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            'h-3.5 w-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-fast group-hover/cell:opacity-100 group-focus-within/cell:opacity-100 motion-reduce:transition-none',
            isOpen && 'rotate-90 opacity-100'
          )}
        />
      </button>

      <Disclosure open={isOpen}>
        <div className="mt-1 pl-4">
          <MessageResponse className="text-sm leading-relaxed text-text-tertiary">
            {trimmed}
          </MessageResponse>
        </div>
      </Disclosure>
    </div>
  );
}
