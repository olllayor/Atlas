/**
 * The tasks dock: the live plan, pinned to the composer's shoulder.
 *
 * `PlanCell` puts the checklist in the transcript, which is the right home for
 * the *record* and the wrong one for the *work*: the moment the model says
 * anything the plan scrolls away, and the one line you actually want on screen
 * — which step is running — is the line you have to scroll back for. This dock
 * is the other half of that flow, ported from t3code's `ComposerTasksBadge`:
 * one strip tucked behind the composer slab, showing the current step and how
 * far along the turn is, expanding to the whole list on click.
 *
 * It is deliberately scoped to the *live* turn. A settled plan is history, and
 * history belongs in the transcript; a dock that outlived its turn would be a
 * second, staler copy of something already on the page.
 *
 * Geometry note: this is a leaf that subscribes to the store itself rather
 * than taking the plan as a prop. `ChatComposerSlot` exists to keep the stream
 * flush from reaching `Composer` (see its header comment) — handing the parts
 * down through it would undo exactly that, so the flush stops here instead.
 */

import { ChevronDown, ListTodo } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { ChatMessagePart } from '../../../shared/contracts';
import {
  derivePlanTasksView,
  planPartsOf,
  type PlanStepStatus,
  type PlanTaskStep,
} from '../../../shared/planTool';
import { formatElapsed } from '../../../shared/toolCellGrammar';
import { useAppStore } from '../../stores/useAppStore';
import { useTranscriptUiStore } from '../../stores/useTranscriptUiStore';
import { usePlanProgressAnnouncement } from '../../hooks/usePlanProgressAnnouncement';
import { cn } from '../../lib/utils';

/** A stable empty array, so a conversation with no live plan never re-renders. */
const NO_PARTS: ChatMessagePart[] = [];

/**
 * Past ten steps the segments stop being a progress bar and become a barcode:
 * each one is under 4px wide, and no reader can tell four done from five.
 * The `n/total` count beside them says the same thing without the pretence.
 */
const MAX_SEGMENTS = 10;

/** Both columns of every row line up on these two tracks, header included. */
const ROW_GRID = 'grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-1.5';

const STATUS_GLYPH: Record<PlanStepStatus, string> = {
  completed: '✓',
  in_progress: '●',
  pending: '○',
};

const STATUS_GLYPH_COLOR: Record<PlanStepStatus, string> = {
  completed: 'text-success',
  in_progress: 'text-brand-strong',
  pending: 'text-text-faint/50',
};

const STATUS_TEXT_COLOR: Record<PlanStepStatus, string> = {
  completed: 'text-text-faint',
  in_progress: 'text-text-primary',
  pending: 'text-text-tertiary',
};

/**
 * The words behind the glyphs. Screen-reader only: ✓ / ● / ○ differ in shape
 * as well as hue, so the visible row is already legible without colour and
 * does not need the label spelled out beside it the way `PlanCell`'s wider
 * rows do.
 */
const STATUS_LABEL: Record<PlanStepStatus, string> = {
  completed: 'Completed',
  in_progress: 'Running',
  pending: 'Pending',
};

export function TasksDock({ conversationId }: { conversationId: string | null }) {
  /*
    Live turns only, and the draft is the live turn: a settled one has already
    been folded into `conversationDetails` and drawn by `PlanCell`.
  */
  const parts = useAppStore((state) => {
    if (!conversationId) return NO_PARTS;
    const draft = state.draftsByConversation[conversationId];
    if (!draft) return NO_PARTS;
    return draft.status === 'streaming' || draft.status === 'queued' ? draft.parts : NO_PARTS;
  });

  const view = useMemo(() => derivePlanTasksView(planPartsOf(parts)), [parts]);
  const [expanded, setExpanded] = useState(false);
  // The dock is the live surface, so while it holds the plan it is also the
  // one that speaks: `PlanCell` is not mounted to do it.
  const announcement = usePlanProgressAnnouncement(
    view?.completed ?? null,
    view?.total ?? null,
    'Tasks'
  );

  const current = view?.current ?? null;
  const hasTasks = current !== null;

  // A turn that ends takes its drawer with it, so the next one opens collapsed
  // rather than springing open on a plan the reader never asked to see.
  useEffect(() => {
    if (!hasTasks) setExpanded(false);
  }, [hasTasks]);

  /*
    Claim the plan for as long as it is on screen here, so the transcript's
    `PlanCell` stands down instead of drawing the same checklist a second time.
    The claim is scoped to this component's lifetime — a subagent takeover
    renders no dock at all, nothing is claimed, and every cell draws as before.
  */
  const ownedAnchorId = hasTasks ? view?.anchorId ?? null : null;
  useEffect(() => {
    if (!ownedAnchorId) return;
    const { claimDockPlan, releaseDockPlan } = useTranscriptUiStore.getState();
    claimDockPlan(ownedAnchorId);
    return () => releaseDockPlan(ownedAnchorId);
  }, [ownedAnchorId]);

  if (!view || !current) {
    return null;
  }

  const summary = `${view.completed} of ${view.total} complete. Current task: ${current.step}`;

  return (
    /*
      The dock is inset by the slab's corner radius and slides
      `--tasks-dock-overlap` under it; the mask erases its own background over
      that band so the two surfaces meet without a seam or a doubled hairline.
      The slab is a later, positioned sibling, so it paints over what is left.
    */
    <div
      data-tasks-dock=""
      className={cn(
        'mx-auto w-[calc(100%-2*var(--tasks-dock-inset))] -mb-tasks-dock-overlap',
        'rounded-t-xl border border-border-subtle bg-bg-composer',
        'px-1 pt-1 pb-[calc(var(--tasks-dock-overlap)+0.25rem)]',
        'text-xs leading-4',
        '[mask-image:linear-gradient(to_top,transparent_0_var(--tasks-dock-overlap),black_var(--tasks-dock-overlap))]'
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        // The composer keeps focus: this is a peek at the turn, not a place to
        // land, and losing the caret mid-sentence to read it would be a tax.
        onPointerDown={(event) => event.preventDefault()}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse tasks' : 'Tasks'}: ${summary}`}
        className={cn(
          ROW_GRID,
          'w-full cursor-pointer rounded-md px-1 py-1 text-left transition-colors duration-fast',
          'hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-strong',
          'motion-reduce:transition-none'
        )}
      >
        <ListTodo aria-hidden className="mx-auto size-3.5 text-text-faint" strokeWidth={1.75} />

        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-text-muted">Tasks</span>
          <span className="min-w-0 flex-1 truncate font-medium text-text-secondary">
            {current.step}
          </span>
        </span>

        <span className="flex items-center gap-1.5">
          <span className="tabular-nums text-text-faint">
            {view.completed}/{view.total}
          </span>
          <TaskSegments steps={view.steps} />
          <ChevronDown
            aria-hidden
            className={cn(
              'size-3.5 text-text-faint transition-transform duration-fast motion-reduce:transition-none',
              !expanded && 'rotate-180'
            )}
          />
        </span>
      </button>

      {/*
        The same grid-rows reveal the rest of the app uses (`QueueDock`,
        `ToolCell`): the composer is pushed down smoothly rather than jumping.
        `inert` while collapsed keeps the clipped rows out of the tab order.
      */}
      <div
        inert={!expanded}
        className={cn(
          'grid transition-[grid-template-rows] duration-[160ms] ease-out motion-reduce:transition-none',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <ul
            aria-label={`Task list. ${summary}`}
            className="scrollbar-auto-hide max-h-[min(16rem,32dvh)] overflow-y-auto overscroll-contain pt-0.5"
          >
            {view.steps.map((step) => (
              <TaskRow key={step.key} step={step} />
            ))}
          </ul>
        </div>
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

function TaskRow({ step }: { step: PlanTaskStep }) {
  return (
    <li className={cn(ROW_GRID, 'min-h-5 px-1')}>
      <span
        aria-hidden
        className={cn('text-center font-mono text-[10px] leading-none', STATUS_GLYPH_COLOR[step.status])}
      >
        {STATUS_GLYPH[step.status]}
      </span>

      <span className={cn('min-w-0 truncate', STATUS_TEXT_COLOR[step.status])} title={step.step}>
        <span className="sr-only">{STATUS_LABEL[step.status]}: </span>
        {step.step}
      </span>

      {/*
        Fixed width so the column is a rule rather than a ragged edge — the
        durations arrive one at a time and would otherwise shuffle sideways
        every time a step finished.
      */}
      <span className="w-9 text-right text-2xs tabular-nums text-text-faint">
        {step.durationMs != null
          ? formatElapsed(step.durationMs)
          : step.status === 'in_progress'
            ? 'now'
            : null}
      </span>
    </li>
  );
}

/**
 * The progress rule: one segment per step, coloured by its status.
 *
 * A single-step plan has no progress to draw — the segment would be the whole
 * bar in both states — and the count beside it already says `0/1`.
 */
function TaskSegments({ steps }: { steps: PlanTaskStep[] }) {
  if (steps.length <= 1 || steps.length > MAX_SEGMENTS) {
    return null;
  }

  return (
    <span aria-hidden className="flex w-16 shrink-0 items-center gap-0.5">
      {steps.map((step) => (
        <span
          key={step.key}
          className={cn(
            'h-[3px] min-w-0 flex-1 rounded-full',
            step.status === 'completed'
              ? 'bg-success'
              : step.status === 'in_progress'
                ? 'bg-brand-strong'
                : 'bg-text-faint/25'
          )}
        />
      ))}
    </span>
  );
}
