/**
 * The end-of-turn changed-files card.
 *
 * A turn that edited files closes with a filled card: a collapse chevron,
 * `N changed files` over its `+A −D` totals, a `Hide/Show files` toggle, a
 * prev/next file pager, `Undo` and `Open diff` on the right. Files group
 * under collapsible top-directory rows (`src/renderer  +71 −22`), each
 * carrying its own totals; every file row expands to its unified diff.
 *
 * Open state lives in the transcript UI store, keyed by stable ids — the
 * transcript is virtualized, so `useState` here would silently re-collapse
 * the moment the card scrolls out of view.
 *
 * Diff counts use the diff tokens (green/red-salmon), not the semantic
 * error orange — `--diff-del-fg-count` lets a theme pin a dedicated count
 * colour, falling back to the diff body foreground.
 */

import { ChevronDown, ChevronRight, ChevronUp, FileDiff, Folder, Undo2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import type { ChangedFilesSummary, DiffFile } from '../../../shared/toolCellGrammar';
import { basename, changedFilesToPlainText } from '../../../shared/toolCellGrammar';
import { stableId, useDisclosure, useTranscriptUiStore } from '../../stores/useTranscriptUiStore';
import { RAW_BLOCK, useRawTranscript } from '../../lib/rawTranscript';
import { cn } from '../../lib/utils';
import { DiffBlock, MINUS } from './DiffBlock';
import { Disclosure } from './ToolCell';

const ADD_COUNT_STYLE = { color: 'var(--diff-add-fg-count, var(--success))' } as const;
const DEL_COUNT_STYLE = { color: 'var(--diff-del-fg-count, var(--diff-del-fg))' } as const;

/** First path segment, or `''` for a root-level file (rendered ungrouped). */
export function topDirectoryOf(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.length > 1 ? (segments[0] ?? '') : '';
}

type FileGroup = {
  /** Top directory, or `''` for root-level files. */
  folder: string;
  files: DiffFile[];
  added: number;
  removed: number;
};

/**
 * Files already arrive path-sorted; folders keep first-seen order with root
 * files first, so the list reads top-down like the working tree.
 */
export function groupChangedFiles(files: DiffFile[]): FileGroup[] {
  const groups = new Map<string, FileGroup>();
  for (const file of files) {
    const folder = topDirectoryOf(file.path);
    let group = groups.get(folder);
    if (!group) {
      group = { folder, files: [], added: 0, removed: 0 };
      groups.set(folder, group);
    }
    group.files.push(file);
    group.added += file.added;
    group.removed += file.removed;
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.folder) return -1;
    if (!b.folder) return 1;
    return a.folder.localeCompare(b.folder);
  });
}

/**
 * The directory the file sits in, trailing separator included, or `''`.
 *
 * Rendered dimmed in front of the filename rather than dropped: the path is
 * how you tell `db/client.ts` from `renderer/client.ts`, and the contrast
 * split keeps the filename readable at a glance anyway.
 */
function directoryOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut < 0 ? '' : path.slice(0, cut + 1);
}

function fileRowId(path: string) {
  return stableId('changed-file', path);
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
  const barSeed = useMemo(
    () => summary.files.map((file) => file.path).join('|'),
    [summary.files]
  );
  const barId = useMemo(() => stableId('changed-files', barSeed), [barSeed]);
  const [filesOpen, toggleFilesOpen] = useDisclosure(barId, true);
  const setExpanded = useTranscriptUiStore((state) => state.setExpanded);
  const raw = useRawTranscript();

  const groups = useMemo(() => groupChangedFiles(summary.files), [summary.files]);
  const rawText = useMemo(() => changedFilesToPlainText(summary), [summary]);
  const [undoState, setUndoState] = useState<'idle' | 'running' | 'done'>('idle');

  // Render-order path list: the prev/next pager walks it, expanding each
  // folder and diff as it lands and scrolling the row into view.
  const flatPaths = useMemo(
    () => groups.flatMap((group) => group.files.map((file) => file.path)),
    [groups]
  );
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const focusedIndex = focusedPath ? flatPaths.indexOf(focusedPath) : -1;

  const goToFile = (index: number) => {
    const path = flatPaths[index];
    if (!path) return;
    const folder = topDirectoryOf(path);
    if (folder) setExpanded(stableId('changed-folder', `${barSeed}|${folder}`), true);
    setExpanded(fileRowId(path), true);
    setFocusedPath(path);
    // The diff expands in the same frame; scrolling after paint lands on the
    // opened row rather than where it was while collapsed.
    requestAnimationFrame(() => {
      rowRefs.current.get(path)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };

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
    // The card's whole visual identity — the fill, the counts, the folders —
    // is chrome. In raw mode the header and every patch body collapse into
    // one selectable block; the actions survive as plain links because they
    // do things, which is not a rendering choice.
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
    <div className="mt-4 overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
      <div className="flex h-11 items-center gap-1.5 px-2.5">
        <button
          type="button"
          onClick={toggleFilesOpen}
          aria-expanded={filesOpen}
          aria-label={filesOpen ? 'Hide changed files' : 'Show changed files'}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              'size-4 transition-transform duration-fast motion-reduce:transition-none',
              !filesOpen && '-rotate-90'
            )}
          />
        </button>

        <span className="shrink-0 text-base font-semibold text-text-primary">
          {count} {count === 1 ? 'file' : 'files'}
        </span>
        <span className="app-code-compact shrink-0 tabular-nums" style={ADD_COUNT_STYLE}>
          +{summary.added}
        </span>
        <span className="app-code-compact shrink-0 tabular-nums" style={DEL_COUNT_STYLE}>
          {MINUS}
          {summary.removed}
        </span>

        <button
          type="button"
          onClick={toggleFilesOpen}
          aria-expanded={filesOpen}
          className="shrink-0 cursor-pointer rounded-md px-1.5 py-1 text-sm text-text-tertiary transition-colors hover:text-text-secondary"
        >
          {filesOpen ? 'Hide files' : 'Show files'}
        </button>

        <span className="min-w-0 flex-1" />

        {onUndo ? (
          <button
            type="button"
            onClick={() => void runUndo()}
            disabled={undoState !== 'idle'}
            aria-label={`${undoLabel(undoState)} the edits from this turn`}
            title={`${undoLabel(undoState)} the edits from this turn`}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-default disabled:text-text-faint"
          >
            <Undo2 aria-hidden className="size-3.5" />
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => goToFile(focusedIndex <= 0 ? 0 : focusedIndex - 1)}
          disabled={flatPaths.length === 0 || focusedIndex === 0}
          aria-label="Previous changed file"
          title="Previous changed file"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronUp aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => goToFile(focusedIndex + 1)}
          disabled={focusedIndex >= flatPaths.length - 1}
          aria-label="Next changed file"
          title="Next changed file"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronDown aria-hidden className="size-4" />
        </button>

        {onReview ? (
          <button
            type="button"
            onClick={onReview}
            className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border-subtle px-3 text-sm text-text-primary transition-colors hover:bg-bg-hover"
          >
            <FileDiff aria-hidden className="size-3.5" />
            Open diff
          </button>
        ) : null}
      </div>

      {filesOpen ? (
        <div className="border-t border-border-subtle px-1 pb-1">
          {groups.map((group) =>
            group.folder ? (
              <ChangedFolderGroup
                key={group.folder}
                group={group}
                barSeed={barSeed}
                focusedPath={focusedPath}
                setRowRef={(path, element) => {
                  if (element) rowRefs.current.set(path, element);
                  else rowRefs.current.delete(path);
                }}
              />
            ) : (
              group.files.map((file) => (
                <div
                  key={file.path}
                  ref={(element) => {
                    if (element) rowRefs.current.set(file.path, element);
                    else rowRefs.current.delete(file.path);
                  }}
                >
                  <ChangedFileRow
                    file={file}
                    displayDir={directoryOf(file.path)}
                    displayName={basename(file.path)}
                    focused={focusedPath === file.path}
                  />
                </div>
              ))
            )
          )}
        </div>
      ) : null}
    </div>
  );
}

function undoLabel(state: 'idle' | 'running' | 'done') {
  if (state === 'running') return 'Undoing…';
  return state === 'done' ? 'Undone' : 'Undo';
}

function ChangedFolderGroup({
  group,
  barSeed,
  focusedPath,
  setRowRef,
}: {
  group: FileGroup;
  barSeed: string;
  focusedPath: string | null;
  setRowRef: (path: string, element: HTMLDivElement | null) => void;
}) {
  const folderId = useMemo(
    () => stableId('changed-folder', `${barSeed}|${group.folder}`),
    [barSeed, group.folder]
  );
  const [isOpen, toggleOpen] = useDisclosure(folderId, true);

  return (
    <div>
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        aria-label={`${group.folder}, ${group.files.length} ${group.files.length === 1 ? 'file' : 'files'}. ${isOpen ? 'Hide' : 'Show'} files`}
        className="group/folder flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-bg-hover"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-text-tertiary transition-transform duration-fast motion-reduce:transition-none',
            isOpen && 'rotate-90'
          )}
        />
        <Folder aria-hidden className="size-3.5 shrink-0 text-text-tertiary" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-sm text-text-secondary transition-colors group-hover/folder:text-text-primary">
          {group.folder}
        </span>
        <span className="app-code-compact shrink-0 tabular-nums" style={ADD_COUNT_STYLE}>
          +{group.added}
        </span>
        <span className="app-code-compact shrink-0 tabular-nums" style={DEL_COUNT_STYLE}>
          {MINUS}
          {group.removed}
        </span>
      </button>

      {isOpen
        ? group.files.map((file) => {
            // Inside its folder the leading segment is noise: show the path
            // relative to the folder, directory dimmed, filename full.
            const remainder = file.path.startsWith(`${group.folder}/`)
              ? file.path.slice(group.folder.length + 1)
              : file.path;
            // Backslash paths never start with `folder/`; fall back to the
            // full directory rather than a wrong relative one.
            const relative = remainder === file.path ? directoryOf(file.path) : directoryOf(remainder);
            return (
              <div key={file.path} ref={(element) => setRowRef(file.path, element)}>
                <ChangedFileRow
                  file={file}
                  displayDir={relative}
                  displayName={basename(file.path)}
                  focused={focusedPath === file.path}
                  indented
                />
              </div>
            );
          })
        : null}
    </div>
  );
}

function ChangedFileRow({
  file,
  displayDir,
  displayName,
  focused,
  indented,
}: {
  file: DiffFile;
  /** Directory prefix as rendered (dimmed); relative inside folders. */
  displayDir: string;
  displayName: string;
  focused: boolean;
  indented?: boolean;
}) {
  const [isOpen, toggleOpen] = useDisclosure(fileRowId(file.path), false);
  const title = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;

  return (
    <div>
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        aria-label={`${title}, ${file.added} additions, ${file.removed} deletions. ${isOpen ? 'Hide' : 'Show'} diff`}
        className={cn(
          'group/file flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left transition-colors hover:bg-bg-hover',
          indented && 'pl-9',
          focused && 'bg-bg-hover'
        )}
      >
        <span className="min-w-0 flex-1 truncate text-sm" title={title}>
          <span className="text-text-tertiary">{displayDir}</span>
          <span className="text-text-primary">{displayName}</span>
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
            'size-3.5 shrink-0 text-text-tertiary opacity-0 transition-[opacity,transform] duration-fast group-hover/file:opacity-100 group-focus-within/file:opacity-100 motion-reduce:transition-none',
            (isOpen || focused) && 'rotate-90 opacity-100'
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
