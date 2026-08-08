/**
 * The end-of-turn "Edited N files" card.
 *
 * A turn that edited files closes with a bordered card: a leading glyph tile,
 * `Edited 4 files` over its `+271 −73` totals, `Undo` and `Review` on the
 * right, then one row per file — directory dimmed, filename in full contrast,
 * counts on the right rail. Long turns show the first few files and keep the
 * rest behind `Show N more files`, so a twenty-file turn does not push the
 * reply off the screen.
 *
 * Each row still expands to its unified diff: the card is the summary, and the
 * diff is one click under it rather than in another panel.
 *
 * Diff counts use the diff tokens (green/red-salmon), not the semantic
 * error orange — `--diff-del-fg-count` lets a theme pin a dedicated count
 * colour, falling back to the diff body foreground.
 */

import { ChevronDown, ChevronRight, FileDiff, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ChangedFilesSummary, DiffFile } from '../../../shared/toolCellGrammar';
import { basename, changedFilesToPlainText } from '../../../shared/toolCellGrammar';
import { stableId, useDisclosure } from '../../stores/useTranscriptUiStore';
import { RAW_BLOCK, useRawTranscript } from '../../lib/rawTranscript';
import { cn } from '../../lib/utils';
import { DiffBlock, MINUS } from './DiffBlock';
import { Disclosure } from './ToolCell';

const ADD_COUNT_STYLE = { color: 'var(--diff-add-fg-count, var(--success))' } as const;
const DEL_COUNT_STYLE = { color: 'var(--diff-del-fg-count, var(--diff-del-fg))' } as const;

/**
 * How many file rows are shown before the card folds the rest away.
 *
 * Three is what fits under the header without the card competing with the
 * reply it belongs to; anything past that is available in one click.
 */
export const CHANGED_FILES_VISIBLE_ROWS = 3;

/**
 * Basename plus just enough parent directory to tell two files apart.
 *
 * A turn that edits `src/main/index.ts` and `src/renderer/index.ts`
 * previously rendered two rows both reading `index.ts`, which is worse
 * than useless — the reader cannot tell which diff belongs to which file.
 */
function disambiguateNames(files: DiffFile[]): string[] {
  const names = files.map((file) => basename(file.path));
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);

  return files.map((file, index) => {
    const name = names[index];
    if ((counts.get(name) ?? 0) < 2) return name;

    const segments = file.path.split(/[\\/]/).filter(Boolean);
    const parent = segments[segments.length - 2];
    return parent ? `${parent}/${name}` : name;
  });
}

/**
 * The directory the file sits in, trailing separator included, or `''`.
 *
 * It is rendered dimmed in front of the filename rather than dropped: the
 * path is how you tell `db/client.ts` from `renderer/client.ts`, and the
 * contrast split keeps the filename readable at a glance anyway.
 */
function directoryOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut < 0 ? '' : path.slice(0, cut + 1);
}

export function ChangedFilesBar({
  summary,
  onReview,
  onUndo,
}: {
  summary: ChangedFilesSummary;
  /** Opens the workbench Changes tab. Absent, the card only expands inline. */
  onReview?: () => void;
  /**
   * Rolls this turn's edits back on disk. Absent — no project, or a turn
   * whose edits were never recorded — the control is not offered, because a
   * button that cannot undo anything is worse than no button.
   */
  onUndo?: () => Promise<void>;
}) {
  const count = summary.files.length;

  // Keyed by the file set so the card's open state survives the virtualizer
  // unmounting the row when it scrolls out of view.
  const barId = useMemo(
    () => stableId('changed-files', summary.files.map((file) => file.path).join('|')),
    [summary.files]
  );
  const [showAll, toggleShowAll] = useDisclosure(barId, false);
  const raw = useRawTranscript();

  const names = useMemo(() => disambiguateNames(summary.files), [summary.files]);
  const rawText = useMemo(() => changedFilesToPlainText(summary), [summary]);
  const [undoState, setUndoState] = useState<'idle' | 'running' | 'done'>('idle');

  const hidden = Math.max(0, count - CHANGED_FILES_VISIBLE_ROWS);
  const visibleFiles = showAll
    ? summary.files
    : summary.files.slice(0, CHANGED_FILES_VISIBLE_ROWS);

  const runUndo = async () => {
    if (!onUndo || undoState !== 'idle') return;
    setUndoState('running');
    try {
      await onUndo();
      setUndoState('done');
    } catch {
      // The caller surfaces the failure; the card just stops claiming to be
      // mid-undo so the control can be tried again.
      setUndoState('idle');
    }
  };

  if (raw) {
    // The card's whole visual identity — the border, the glyph tile, the
    // coloured counts — is chrome. In raw mode the header and every patch
    // body collapse into one selectable block; the actions survive as plain
    // links because they do things, which is not a rendering choice.
    return (
      <div className="mt-4">
        <pre className={cn('app-code-text m-0 leading-[1.55] text-text-secondary', RAW_BLOCK)}>
          {rawText}
        </pre>
        <div className="mt-1 flex items-center gap-3">
          {onUndo ? (
            <button
              type="button"
              onClick={() => void runUndo()}
              disabled={undoState !== 'idle'}
              className="cursor-pointer text-sm text-text-tertiary underline decoration-dotted underline-offset-2 transition-colors hover:text-text-secondary disabled:cursor-default disabled:no-underline"
            >
              {undoLabel(undoState)}
            </button>
          ) : null}
          {onReview ? (
            <button
              type="button"
              onClick={onReview}
              className="cursor-pointer text-sm text-text-tertiary underline decoration-dotted underline-offset-2 transition-colors hover:text-text-secondary"
            >
              Review changes
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    // `overflow-hidden` so the last expanded diff cannot square off the
    // card's bottom corners.
    <div className="mt-4 overflow-hidden rounded-xl border border-border-subtle">
      <div className="flex items-center gap-3 px-3 py-3">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-surface"
        >
          <FileDiff className="h-4 w-4 text-text-secondary" />
        </span>

        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-base text-text-primary">
            Edited {count} {count === 1 ? 'file' : 'files'}
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="app-code-compact tabular-nums" style={ADD_COUNT_STYLE}>
              +{summary.added}
            </span>
            <span className="app-code-compact tabular-nums" style={DEL_COUNT_STYLE}>
              {MINUS}
              {summary.removed}
            </span>
          </div>
        </div>

        {onUndo ? (
          <button
            type="button"
            onClick={() => void runUndo()}
            disabled={undoState !== 'idle'}
            aria-label={`${undoLabel(undoState)} the edits from this turn`}
            className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-base text-text-secondary transition-colors hover:text-text-primary disabled:cursor-default disabled:text-text-tertiary"
          >
            {undoLabel(undoState)}
            <Undo2 aria-hidden className="h-3.5 w-3.5" />
          </button>
        ) : null}

        {onReview ? (
          <button
            type="button"
            onClick={onReview}
            className="h-8 shrink-0 cursor-pointer rounded-lg border border-border-subtle px-3 text-base text-text-primary transition-colors hover:bg-bg-hover"
          >
            Review
          </button>
        ) : null}
      </div>

      <div className="border-t border-border-subtle px-1 pb-1">
        {visibleFiles.map((file, index) => (
          <ChangedFileRow key={file.path} file={file} name={names[index]} />
        ))}

        {hidden > 0 ? (
          <button
            type="button"
            onClick={toggleShowAll}
            aria-expanded={showAll}
            className="flex h-9 w-full cursor-pointer items-center gap-1 rounded-lg px-3 text-left text-base text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
          >
            {showAll ? 'Show fewer files' : `Show ${hidden} more ${hidden === 1 ? 'file' : 'files'}`}
            <ChevronDown
              aria-hidden
              className={cn(
                'h-3.5 w-3.5 transition-transform duration-fast motion-reduce:transition-none',
                showAll && 'rotate-180'
              )}
            />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function undoLabel(state: 'idle' | 'running' | 'done') {
  if (state === 'running') return 'Undoing…';
  return state === 'done' ? 'Undone' : 'Undo';
}

function ChangedFileRow({ file, name }: { file: DiffFile; name: string }) {
  const rowId = useMemo(() => stableId('changed-file', file.path), [file.path]);
  const [isOpen, toggleOpen] = useDisclosure(rowId, false);
  const title = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
  // `name` already carries a parent segment when two files share a basename,
  // so the dimmed prefix is trimmed to what it does not already show.
  const directory = directoryOf(file.path).slice(0, Math.max(0, file.path.length - name.length));

  return (
    <div>
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        aria-label={`${title}, ${file.added} additions, ${file.removed} deletions. ${isOpen ? 'Hide' : 'Show'} diff`}
        className="group/file flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left transition-colors hover:bg-bg-hover"
      >
        <span className="min-w-0 flex-1 truncate text-base" title={title}>
          <span className="text-text-tertiary">{directory}</span>
          <span className="text-text-primary">{name}</span>
        </span>
        <span className="app-code-compact shrink-0 tabular-nums" style={ADD_COUNT_STYLE}>
          +{file.added}
        </span>
        <span className="app-code-compact shrink-0 tabular-nums" style={DEL_COUNT_STYLE}>
          {MINUS}
          {file.removed}
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-text-tertiary opacity-0 transition-[opacity,transform] duration-fast group-hover/file:opacity-100 group-focus-within/file:opacity-100 motion-reduce:transition-none',
            isOpen && 'rotate-90 opacity-100'
          )}
        />
      </button>

      <Disclosure open={isOpen}>
        <div className="px-2 pb-2">
          <DiffBlock file={file} />
        </div>
      </Disclosure>
    </div>
  );
}
