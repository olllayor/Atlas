/**
 * Codex app activity rows.
 *
 * The shipped ChatGPT/Codex **app** does not use the CLI TUI's
 * `• verb subject` + `│`/`└` gutter grammar. Each activity phase is one
 * dim, borderless summary row — `Ran npm test`, `Explored 3 files`,
 * `Searched the web for X` — with no bullet, no gutter bars, no card.
 * Hover brightens the row and reveals a trailing `›`; clicking expands
 * the details inline below, indented and still borderless.
 * See `docs/codex-parity/reference-visual-spec.md` §5.
 */

import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { ChatToolPart } from '../../../shared/contracts';
import {
  type DiffFile,
  type ToolCell as ToolCellModel,
  type ToolCellStatus,
  buildToolCells,
  formatElapsed,
} from '../../../shared/toolCellGrammar';
import { useDisclosure } from '../../stores/useTranscriptUiStore';
import { cn } from '../../lib/utils';
import { DiffBlock, MINUS } from './DiffBlock';
import { TerminalBlock } from './TerminalBlock';

/** Expanded details indent by ~16px under their summary row. */
const DETAIL_INDENT = 'pl-4';

const STATUS_TEXT: Record<ToolCellStatus, string> = {
  pending: 'queued',
  running: 'running',
  success: 'completed',
  failed: 'failed',
  'awaiting-approval': 'awaiting approval',
};

/**
 * A collapsed cell must still say whether its call failed. The audit's two
 * options were a leading status dot or a tinted label; the label tint is
 * the quieter one and costs no horizontal space, so `ActivityGlyph` is
 * gone rather than left as a second, unused status vocabulary.
 */
const STATUS_TINT: Partial<Record<ToolCellStatus, string>> = {
  failed: 'text-error',
  'awaiting-approval': 'text-warning',
};

// ---------------------------------------------------------------------------
// Disclosure animation
// ---------------------------------------------------------------------------

/**
 * 160ms `grid-template-rows: 0fr → 1fr` reveal.
 *
 * Shared by every disclosure in the transcript (tool cells, reasoning, the
 * changed-files bar) so content never simply pops and shoves the rest of
 * the transcript. `motion-reduce` drops the transition entirely rather than
 * shortening it.
 *
 * Children stay mounted for the length of the collapse so the closing
 * animation has something to animate, then unmount — keeping a long diff
 * mounted behind a closed row would defeat the point of collapsing it.
 */
export function Disclosure({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [keepMounted, setKeepMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setKeepMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setKeepMounted(false), 200);
    return () => window.clearTimeout(timer);
  }, [open]);

  // `open ||` rather than waiting for the effect: mounting the children one
  // commit late would leave the row at 0fr with nothing in it, finish the
  // transition against an empty box, and then pop the content in at full
  // height — exactly the jump the animation exists to avoid.
  const render = open || keepMounted;

  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows] duration-[160ms] ease-out motion-reduce:transition-none',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        className
      )}
    >
      <div className="min-h-0 overflow-hidden">{render ? children : null}</div>
    </div>
  );
}

export type ToolCellApprovalHandlers = {
  onApprove: (part: ChatToolPart, scope: 'once' | 'session') => void;
  onDeny: (part: ChatToolPart) => void;
  onCancel: (part: ChatToolPart) => void;
  submittingApprovalId: string | null;
};

type ToolCellListProps = {
  parts: ChatToolPart[];
  approvals?: ToolCellApprovalHandlers;
};

/**
 * Render an ordered run of tool parts as activity rows.
 *
 * Grouping happens in `buildToolCells` — consecutive read-only calls
 * collapse into a single `Explored N files` row, so N file reads produce
 * one line rather than N.
 */
export function ToolCellList({ parts, approvals }: ToolCellListProps) {
  const cells = useMemo(() => buildToolCells(parts), [parts]);
  const announcement = useTerminalTransitions(cells);

  if (!cells.length) return null;

  return (
    <div className="flex flex-col gap-1.5" role="list" aria-label="Agent actions">
      {cells.map((cell) => (
        <ToolCell key={cell.id} cell={cell} approvals={approvals} />
      ))}

      {/*
        One status region for the whole run. Wrapping the list itself in
        `aria-live` (the previous shape) re-announced every row on every
        re-render — including rows scrolled back into view — which made the
        transcript unusable with a screen reader. Only terminal transitions
        that actually happened in front of the reader are announced.
      */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

/** Announce only success/failure transitions observed while mounted. */
function useTerminalTransitions(cells: ToolCellModel[]): string {
  const [announcement, setAnnouncement] = useState('');
  const seen = useRef(new Map<string, ToolCellStatus>());

  useEffect(() => {
    const messages: string[] = [];

    for (const cell of cells) {
      const previous = seen.current.get(cell.id);
      const isTerminal = cell.status === 'success' || cell.status === 'failed';
      // `previous === undefined` means the cell mounted already finished —
      // a historical row scrolling into view, not something that just
      // happened. Those must stay silent.
      if (previous !== undefined && previous !== cell.status && isTerminal) {
        messages.push(`${cell.label}, ${STATUS_TEXT[cell.status]}`);
      }
      seen.current.set(cell.id, cell.status);
    }

    if (messages.length) setAnnouncement(messages.join('. '));
  }, [cells]);

  return announcement;
}

function isExpandable(cell: ToolCellModel): boolean {
  const detail = cell.detail;
  switch (detail.type) {
    case 'none':
      return false;
    case 'text':
      // An empty result still expands to an explicit `(no output)` marker —
      // "produced nothing" and "lost the output" must stay distinguishable.
      return detail.empty || detail.lines.length > 0;
    case 'explore':
      return detail.entries.length > 0;
    default:
      // diff, error, approval all carry content worth revealing.
      return true;
  }
}

function ToolCell({ cell, approvals }: { cell: ToolCellModel; approvals?: ToolCellApprovalHandlers }) {
  const expandable = isExpandable(cell);

  // Errors, denials and approval prompts open themselves; everything else
  // starts collapsed. The state lives in the transcript UI store keyed by
  // cell id, because the virtualizer unmounts rows the reader scrolls past
  // and a local `useState` would silently re-collapse them.
  const defaultOpen = cell.status === 'failed' || cell.status === 'awaiting-approval';
  const [isOpen, toggleOpen] = useDisclosure(cell.id, defaultOpen);

  const running = cell.status === 'running' || cell.status === 'pending';
  const elapsed =
    !running && cell.durationMs != null && cell.durationMs >= 1000
      ? formatElapsed(cell.durationMs)
      : null;

  const accessibleName = `${cell.label}, ${STATUS_TEXT[cell.status]}`;
  const tint = STATUS_TINT[cell.status];

  const rowContent = (
    <>
      <span
        // Truncated labels are unreadable without the full text on hover.
        title={cell.label}
        className={cn('min-w-0 truncate', running && 'motion-shimmer', tint)}
      >
        {cell.label}
      </span>
      {elapsed && <span className="shrink-0 tabular-nums text-text-faint">· {elapsed}</span>}
      {expandable && (
        <ChevronRight
          aria-hidden
          className={cn(
            // Hidden at rest like the reference app — hover or keyboard
            // focus reveals it, and an expanded row keeps it as the
            // collapse affordance.
            'h-3.5 w-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-fast group-hover/cell:opacity-100 group-focus-within/cell:opacity-100 motion-reduce:transition-none',
            isOpen && 'rotate-90 opacity-100'
          )}
        />
      )}
    </>
  );

  // Weight 400, tertiary text, no glyph, no border. Hover promotes the
  // row to secondary and brings the chevron to full opacity.
  const rowClassName =
    'flex w-full min-w-0 items-center gap-1.5 text-left text-sm font-normal leading-relaxed text-text-tertiary';

  return (
    <div role="listitem" className="group/cell">
      {expandable ? (
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={isOpen}
          aria-label={`${accessibleName}. ${isOpen ? 'Hide' : 'Show'} details`}
          className={cn(
            rowClassName,
            'cursor-pointer rounded-sm transition-colors hover:text-text-secondary'
          )}
        >
          {rowContent}
        </button>
      ) : (
        // No `cursor-pointer` here: a row with nothing to reveal must not
        // advertise itself as clickable.
        <div className={rowClassName} aria-label={accessibleName}>
          {rowContent}
        </div>
      )}

      <Disclosure open={isOpen}>
        <CellDetail cell={cell} approvals={approvals} />
      </Disclosure>
    </div>
  );
}

function DiffSummary({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="app-code-compact shrink-0">
      <span className="text-diff-add-fg">+{added}</span>{' '}
      <span className="text-diff-del-fg">
        {MINUS}
        {removed}
      </span>
    </span>
  );
}

function CellDetail({
  cell,
  approvals,
}: {
  cell: ToolCellModel;
  approvals?: ToolCellApprovalHandlers;
}) {
  const detail = cell.detail;

  if (detail.type === 'none') return null;

  if (detail.type === 'explore') {
    // The file list stays hidden until the row is opened — the collapsed
    // summary (`Explored 3 files`) is the whole resting-state content.
    return (
      <div className={cn(DETAIL_INDENT, 'mt-1 space-y-0.5')}>
        {detail.entries.map((entry, index) => (
          <div key={index} className="flex gap-1.5 text-sm">
            <span
              className="min-w-0 flex-1 truncate"
              title={`${entry.label} ${entry.values.join(', ')}${entry.scope ? ` in ${entry.scope}` : ''}`}
            >
              <span className="text-text-tertiary">{entry.label}</span>{' '}
              <span className="text-text-secondary">
                {entry.values.map((value, valueIndex) => (
                  <span key={value}>
                    {valueIndex > 0 && <span className="text-text-faint">, </span>}
                    {value}
                  </span>
                ))}
              </span>
              {entry.scope && (
                <>
                  <span className="text-text-faint"> in </span>
                  <span className="text-text-secondary">{entry.scope}</span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (detail.type === 'approval') {
    return (
      <div className={cn(DETAIL_INDENT, 'mt-1.5')}>
        <ApprovalPrompt cell={cell} detail={detail} approvals={approvals} />
      </div>
    );
  }

  if (detail.type === 'error') {
    return (
      <div className={cn(DETAIL_INDENT, 'mt-1')}>
        <pre className="app-code-text scrollbar-auto-hide m-0 min-w-0 overflow-x-auto whitespace-pre leading-[1.55] text-error">
          {detail.text}
        </pre>
      </div>
    );
  }

  if (detail.type === 'text') {
    if (detail.empty) {
      return (
        <div className={cn(DETAIL_INDENT, 'mt-1')}>
          {/*
            An explicit marker, not an absent block: "the command produced
            nothing" and "we lost the output" must not look identical.
          */}
          <span className="app-code-compact text-text-faint">(no output)</span>
        </div>
      );
    }
    return (
      <div className={cn(DETAIL_INDENT, 'mt-1')}>
        <CommandContinuation cell={cell} />
        <TerminalBlock
          lines={detail.lines}
          allLines={detail.allLines}
          head={detail.head}
          tail={detail.tail}
          omitted={detail.omitted}
        />
      </div>
    );
  }

  if (detail.type === 'diff') {
    return (
      <div className={cn(DETAIL_INDENT, 'mt-1.5 space-y-2')}>
        {detail.files.map((file) => (
          <DiffFileBlock key={file.path} file={file} showHeader={detail.files.length > 1} />
        ))}
      </div>
    );
  }

  return null;
}

/** The `│`-gutter overflow of a multi-line command, expandable in place. */
function CommandContinuation({ cell }: { cell: ToolCellModel }) {
  const [expanded, setExpanded] = useState(false);

  if (cell.continuation.length === 0) return null;

  const lines = expanded ? cell.continuationAll : cell.continuation;

  return (
    <div className="mb-1">
      <pre className="app-code-text scrollbar-auto-hide m-0 min-w-0 overflow-x-auto whitespace-pre leading-[1.55] text-text-tertiary">
        {lines.join('\n')}
      </pre>
      {cell.continuationOmitted > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="app-code-compact cursor-pointer rounded-sm text-text-faint underline decoration-dotted underline-offset-2 transition-colors hover:text-text-secondary"
        >
          {expanded ? 'Show less' : `… +${cell.continuationOmitted} lines`}
        </button>
      )}
    </div>
  );
}

function DiffFileBlock({ file, showHeader }: { file: DiffFile; showHeader: boolean }) {
  const title = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;

  return (
    <div>
      {/*
        A per-file sub-header only appears in multi-file patches — for a
        single file it would just repeat the row label.
      */}
      {showHeader && (
        <div className="mb-0.5 flex gap-1.5 text-sm">
          <span className="min-w-0 truncate text-text-secondary" title={title}>
            {title}
          </span>
          <DiffSummary added={file.added} removed={file.removed} />
        </div>
      )}
      <DiffBlock file={file} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

/**
 * Approval ids this session has already auto-focused.
 *
 * Virtualization remounts a cell every time it scrolls back into view, so
 * an unconditional `focus()` on mount rips the caret out of the composer
 * whenever the reader scrolls past an old approval. A prompt earns focus
 * exactly once, when it first appears.
 */
const focusedApprovals = new Set<string>();

/** True when the caret is somewhere the user is actively typing. */
function isTypingElsewhere(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  return (
    active.tagName === 'TEXTAREA' ||
    active.tagName === 'INPUT' ||
    active.isContentEditable === true
  );
}

function ApprovalPrompt({
  cell,
  detail,
  approvals,
}: {
  cell: ToolCellModel;
  detail: Extract<ToolCellModel['detail'], { type: 'approval' }>;
  approvals?: ToolCellApprovalHandlers;
}) {
  const part = cell.parts[0];
  const approvalId = part?.approval?.id ?? null;
  const submitting = approvals?.submittingApprovalId != null;
  const isThisSubmitting = approvals?.submittingApprovalId === approvalId;
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Move focus to the safe default so the decision is reachable without a
  // mouse — but only for a genuinely new prompt, and never out from under
  // someone mid-sentence in the composer.
  useEffect(() => {
    if (!approvalId) return;
    if (focusedApprovals.has(approvalId)) return;
    focusedApprovals.add(approvalId);
    if (isTypingElsewhere()) return;
    primaryRef.current?.focus();
  }, [approvalId]);

  const isEdit = cell.kind === 'edit';
  const title = isEdit
    ? 'Would you like to make the following edits?'
    : 'Would you like to run the following command?';

  const options: Array<{ key: string; hint: string; label: string; run: () => void; primary?: boolean }> = [
    {
      key: 'y',
      hint: 'y',
      label: 'Yes, proceed',
      primary: true,
      run: () => part && approvals?.onApprove(part, 'once'),
    },
    {
      key: 'a',
      hint: 'a',
      label: isEdit
        ? "Yes, and don't ask again for these files"
        : "Yes, and don't ask again for this tool this session",
      run: () => part && approvals?.onApprove(part, 'session'),
    },
    {
      key: 'Escape',
      hint: 'esc',
      label: 'No, and tell the model what to do differently',
      run: () => part && approvals?.onDeny(part),
    },
  ];

  return (
    <div
      role="group"
      aria-label="Approval request"
      onKeyDown={(event) => {
        if (submitting) return;
        // Only the keys actually advertised below are bound. The previous
        // version showed `1.`/`2.`/`3.` prefixes that did nothing.
        const match = options.find(
          (option) => option.key.toLowerCase() === event.key.toLowerCase()
        );
        if (!match) return;
        event.preventDefault();
        event.stopPropagation();
        match.run();
      }}
    >
      <p className="text-base text-text-primary">{title}</p>

      {detail.reason && (
        <p className="mt-1 text-sm text-text-tertiary">
          <span className="text-text-faint">Reason: </span>
          {detail.reason}
        </p>
      )}

      {/*
        Always show the exact thing being approved — as a dim mono line,
        no slab. Approving a summary is not informed consent.
      */}
      {detail.command && (
        <pre className="app-code-text scrollbar-auto-hide m-0 mt-1.5 overflow-x-auto whitespace-pre leading-[1.55] text-text-tertiary">
          <span className="select-none text-text-faint">$ </span>
          {detail.command}
        </pre>
      )}

      <div className="mt-2 flex flex-col gap-1">
        {options.map((option) => (
          <button
            key={option.key}
            ref={option.primary ? primaryRef : undefined}
            type="button"
            disabled={submitting}
            onClick={option.run}
            className={cn(
              'flex w-fit max-w-full cursor-pointer items-baseline gap-2 rounded-sm px-2 py-1 text-left text-sm transition-colors',
              'hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60',
              option.primary ? 'text-text-primary' : 'text-text-secondary'
            )}
          >
            <span className="min-w-0">{option.label}</span>
            <span className="shrink-0 text-text-faint">({option.hint})</span>
          </button>
        ))}
      </div>

      <p className="mt-1.5 text-xs text-text-faint" aria-live="polite">
        {isThisSubmitting
          ? 'Submitting…'
          : 'With this prompt focused, press y, a, or esc'}
      </p>
    </div>
  );
}
