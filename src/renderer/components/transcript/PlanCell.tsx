/**
 * The plan checklist.
 *
 * Codex's TUI appends an "Updated Plan" cell per call; its app surfaces keep
 * one widget and update it in place, which is the model followed here. Every
 * `update_plan` call in a message feeds this one cell, so a turn that revises
 * its plan four times still shows one checklist rather than four snapshots.
 *
 * Visually it is an activity row like `ToolCell`'s: dim, borderless, a chevron
 * that only appears on hover or focus, and an indented reveal underneath.
 */

import { Check, ChevronRight, Circle, CircleDot, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';

import type { ChatToolPart } from '../../../shared/contracts';
import { derivePlanView, planViewToPlainText, type PlanStepStatus } from '../../../shared/planTool';
import { useDisclosure, useTranscriptUiStore } from '../../stores/useTranscriptUiStore';
import { usePlanProgressAnnouncement } from '../../hooks/usePlanProgressAnnouncement';
import { RAW_BLOCK, useRawTranscript } from '../../lib/rawTranscript';
import { cn } from '../../lib/utils';
import { Disclosure } from './ToolCell';

/** Expanded details indent by ~16px under their summary row, as elsewhere. */
const DETAIL_INDENT = 'pl-4';

const STEP_GLYPH: Record<PlanStepStatus, LucideIcon> = {
  completed: Check,
  in_progress: CircleDot,
  pending: Circle,
};

const STEP_TEXT: Record<PlanStepStatus, string> = {
  completed: 'line-through text-text-faint',
  in_progress: 'text-text-primary',
  pending: 'text-text-tertiary',
};

/**
 * Text status beside each expanded step, ported from t3code PR #10128.
 *
 * Steps relied on glyph + colour alone (check / dot / circle); the words make
 * pending vs running vs completed readable without colour.
 */
const STEP_STATUS_LABEL: Record<PlanStepStatus, string> = {
  pending: 'Pending',
  in_progress: 'Running',
  completed: 'Completed',
};

export function PlanCell({ parts, isStreaming = false }: { parts: ChatToolPart[]; isStreaming?: boolean }) {
  const view = useMemo(() => derivePlanView(parts), [parts]);
  // The disclosure store keys on the first call's id so the reader's choice
  // survives both the virtualizer unmounting the row and the next
  // `update_plan` call rewriting the plan underneath it.
  //
  // Closed by default, streaming or not: by the time this row is on screen the
  // dock has handed the plan back, and a checklist that springs open on its own
  // is not what a reader scrolling through finished turns asked for.
  const [isOpen, toggleOpen] = useDisclosure(`plan-${parts[0]?.id ?? 'none'}`, false);
  const announcement = usePlanProgressAnnouncement(view?.completed ?? null, view?.total ?? null);
  const raw = useRawTranscript();
  /*
    While the tasks dock is showing this plan it *is* the plan, pinned where it
    can be read; this row would be the same checklist a screen higher up. The
    announcement above still runs, so progress is spoken once either way, and
    the cell comes back the moment the dock releases its claim — which is what
    keeps a settled turn's plan in the transcript where the record belongs.
  */
  const ownedByDock = useTranscriptUiStore((state) =>
    view ? state.dockPlans[view.anchorId] === true : false
  );

  if (!view || ownedByDock) {
    return null;
  }

  const label = view.updating ? 'Updating plan' : `Updated plan · ${view.completed}/${view.total} complete`;

  if (raw) {
    // Status lives in an icon and a strikethrough here; neither pastes. The
    // `[x]`/`[~]`/`[ ]` form carries the same three states as characters.
    return (
      <div className="my-1.5">
        <pre className={cn('app-code-text m-0 leading-[1.55] text-text-tertiary', RAW_BLOCK)}>
          {planViewToPlainText(view)}
        </pre>
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </div>
    );
  }

  return (
    <div className="my-1.5 group/plan">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        aria-label={`${label}. ${isOpen ? 'Hide' : 'Show'} steps`}
        className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-left text-sm font-normal leading-relaxed text-text-tertiary transition-colors hover:text-text-secondary"
      >
        {/* `tabular-nums`: the completed/total fraction changes every step,
            and proportional digits re-truncate the label each time. */}
        <span title={label} className={cn('min-w-0 truncate tabular-nums', view.updating && 'motion-shimmer')}>
          {label}
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            'h-3.5 w-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-fast group-hover/plan:opacity-100 group-focus-within/plan:opacity-100 motion-reduce:transition-none',
            isOpen && 'rotate-90 opacity-100'
          )}
        />
      </button>

      <Disclosure open={isOpen}>
        <div className={cn(DETAIL_INDENT, 'mt-1 space-y-0.5')}>
          {view.explanation ? (
            <p className="text-sm text-text-faint">{view.explanation}</p>
          ) : null}

          <div role="list" aria-label="Plan steps">
            {view.steps.map((step, index) => {
              const Glyph = STEP_GLYPH[step.status];
              return (
                <div
                  key={`${index}-${step.step}`}
                  role="listitem"
                  className="flex items-start gap-1.5 text-sm leading-relaxed"
                >
                  <Glyph aria-hidden className="mt-[5px] h-3 w-3 shrink-0 text-text-faint" />
                  <span
                    className={cn(
                      'min-w-0 flex-1',
                      STEP_TEXT[step.status],
                      // The shimmer says "work is happening now", so it is only
                      // honest while this turn is actually running.
                      step.status === 'in_progress' && view.updating && isStreaming && 'motion-shimmer'
                    )}
                  >
                    {step.step}
                  </span>
                  <span className="mt-[4px] shrink-0 pl-3 text-[10px] leading-relaxed text-text-faint tabular-nums">
                    {STEP_STATUS_LABEL[step.status]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Disclosure>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}
