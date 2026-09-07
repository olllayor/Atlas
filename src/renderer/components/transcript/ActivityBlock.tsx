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
 * 3. **A live run is bounded.** An open fold on a forty-call turn used to
 *    stretch to the height of the whole log, so the transcript grew by
 *    hundreds of pixels a second under a stick-to-bottom lock that had to
 *    re-pin on every frame — the app "froze" while doing nothing but
 *    layout. The live log gets its own scroll box (a screenful at most),
 *    follows its own bottom, and hands the reader the scrollback if they
 *    want it. Ported from t3code PR #9106, which bounds and virtualizes the
 *    same list. A pending approval switches the bound off: consent is not
 *    something to scroll for.
 */

import { ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { formatElapsed } from '../../../shared/toolCellGrammar';
import { useDisclosure, useTranscriptUiStore } from '../../stores/useTranscriptUiStore';
import { cn } from '../../lib/utils';
import { Disclosure } from './ToolCell';

/**
 * How close to its own bottom the log has to be for a new step to keep
 * scrolling it. Wide enough that one row landing mid-frame does not count as
 * the reader walking away, narrow enough that a deliberate scroll back does.
 */
const LIVE_LOG_FOLLOW_SLACK_PX = 24;

/** The soft edge on a scrollable log, in px, matching the transcript's ramp. */
const LIVE_LOG_FADE_PX = 20;

/**
 * Pins a bounded log to its newest row and reports which edges have more
 * behind them. Inert unless `active` — a settled turn's fold is plain flow.
 */
function useLiveLogViewport(active: boolean) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Starts following: a log that has just opened is showing its live end.
  const followRef = useRef(true);
  const [fade, setFade] = useState({ top: false, bottom: false });

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!active || !box) {
      followRef.current = true;
      setFade((previous) => (previous.top || previous.bottom ? { top: false, bottom: false } : previous));
      return;
    }

    const distanceFromEnd = () => box.scrollHeight - box.clientHeight - box.scrollTop;

    const updateFades = () => {
      const top = box.scrollTop > 1;
      const bottom = distanceFromEnd() > 1;
      setFade((previous) =>
        previous.top === top && previous.bottom === bottom ? previous : { top, bottom }
      );
    };

    const handleScroll = () => {
      // Every scroll re-reads intent, including the ones this hook causes:
      // a programmatic pin lands at the end and re-arms following anyway.
      followRef.current = distanceFromEnd() <= LIVE_LOG_FOLLOW_SLACK_PX;
      updateFades();
    };

    const handleResize = () => {
      if (followRef.current) {
        box.scrollTop = box.scrollHeight;
      }
      updateFades();
    };

    box.addEventListener('scroll', handleScroll, { passive: true });
    const observer = new ResizeObserver(handleResize);
    observer.observe(box);
    // The content wrapper, not the children: a step appended inside it grows
    // the wrapper, and the box's own size never changes once it is capped.
    const content = box.firstElementChild;
    if (content) observer.observe(content);
    handleResize();

    return () => {
      box.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [active]);

  return { boxRef, fade };
}

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
  // Rule 3: the bound is for the live log only. A settled fold the reader
  // opened is theirs to read at full height, and an approval must not be
  // below a scroll line.
  const bounded = open && isStreaming === true && !forceOpen;
  const { boxRef, fade } = useLiveLogViewport(bounded);

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
      ? `Working for ${formatElapsed(nowMs - liveStartMs)}`
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
        <div
          ref={boxRef}
          /*
            The transcript reads every upward gesture as "the reader left the
            live edge" (`useTranscriptScroll`). This box owns its own
            scrollback, so the flag tells that listener to leave the lock
            alone while the gesture lands in here — see
            `toolGroupConsumesUpwardNavigation`.
          */
          {...(bounded ? { 'data-tool-group-scroll': '' } : {})}
          className={cn(
            bounded &&
              // A screenful at most, and never more than half the window on a
              // short one. `scrollbar-auto-hide` keeps the rail out of the
              // reading measure until it is wanted.
              'scrollbar-auto-hide activity-log-scroll max-h-[min(18rem,50dvh)] overflow-y-auto overflow-x-clip'
          )}
          style={
            bounded
              ? {
                  // Chains to the transcript at the ends: leaving this box
                  // upward is a deliberate move into history, and the lock
                  // should release with it.
                  overscrollBehaviorY: 'auto',
                  ['--activity-fade-top' as string]: fade.top ? `${LIVE_LOG_FADE_PX}px` : '0px',
                  ['--activity-fade-bottom' as string]: fade.bottom
                    ? `${LIVE_LOG_FADE_PX}px`
                    : '0px',
                }
              : undefined
          }
        >
          <div className="mt-0.5">{children}</div>
        </div>
      </Disclosure>
    </div>
  );
}
