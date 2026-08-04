/**
 * The end-of-turn "Changed N files" bar.
 *
 * When a turn edited files, the Codex app closes it with a rounded,
 * elevated bar: `Changed 8 files  +23 −16 … Review ›`
 * (`docs/codex-parity/reference-visual-spec.md` §5, reference shot 22).
 * Atlas has no prop path from the transcript to the workbench panel, so
 * "Review" expands the bar inline into per-file rows (shot 12): filename,
 * per-file +/− counts, chevron, each opening its unified diff.
 *
 * Diff counts use the diff tokens (green/red-salmon), not the semantic
 * error orange — `--diff-del-fg-count` lets a theme pin a dedicated count
 * colour, falling back to the diff body foreground.
 */

import { ChevronRight, FileDiff } from 'lucide-react';
import { useMemo } from 'react';

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

export function ChangedFilesBar({
  summary,
  onReview,
}: {
  summary: ChangedFilesSummary;
  /** Opens the workbench Changes tab. Absent, the bar only expands inline. */
  onReview?: () => void;
}) {
  const count = summary.files.length;

  // Keyed by the file set so the bar's open state survives the virtualizer
  // unmounting the row when it scrolls out of view.
  const barId = useMemo(
    () => stableId('changed-files', summary.files.map((file) => file.path).join('|')),
    [summary.files]
  );
  const [isOpen, toggleOpen] = useDisclosure(barId, false);
  const raw = useRawTranscript();

  const names = useMemo(() => disambiguateNames(summary.files), [summary.files]);
  const rawText = useMemo(() => changedFilesToPlainText(summary), [summary]);

  if (raw) {
    // The bar's whole visual identity — the elevated slab, the chevron, the
    // coloured counts — is chrome. In raw mode the header and every patch
    // body collapse into one selectable block; "Review" survives as a plain
    // link because it opens a panel, which is an action, not a rendering.
    return (
      <div className="mt-4">
        <pre className={cn('app-code-text m-0 leading-[1.55] text-text-secondary', RAW_BLOCK)}>
          {rawText}
        </pre>
        {onReview ? (
          <button
            type="button"
            onClick={onReview}
            className="mt-1 cursor-pointer text-sm text-text-tertiary underline decoration-dotted underline-offset-2 transition-colors hover:text-text-secondary"
          >
            Review changes
          </button>
        ) : null}
      </div>
    );
  }

  return (
    // `overflow-hidden` so the last expanded diff cannot square off the
    // bar's bottom corners.
    <div className="relative mt-4 overflow-hidden rounded-xl bg-bg-surface">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        aria-label={`Changed ${count} ${count === 1 ? 'file' : 'files'}, ${summary.added} additions, ${summary.removed} deletions. ${isOpen ? 'Hide' : 'Review'} changes`}
        className="flex h-12 w-full cursor-pointer items-center gap-2 px-4 text-left transition-colors hover:bg-bg-hover"
      >
        <FileDiff aria-hidden className="h-4 w-4 shrink-0 text-text-tertiary" />
        <span className="text-base text-text-primary">
          Changed {count} {count === 1 ? 'file' : 'files'}
        </span>
        <span className="app-code-compact shrink-0 tabular-nums" style={ADD_COUNT_STYLE}>
          +{summary.added}
        </span>
        <span className="app-code-compact shrink-0 tabular-nums" style={DEL_COUNT_STYLE}>
          {MINUS}
          {summary.removed}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-base text-text-secondary">
          {onReview ? null : 'Review'}
          <ChevronRight
            aria-hidden
            className={cn(
              'h-4 w-4 transition-transform duration-fast motion-reduce:transition-none',
              isOpen && 'rotate-90'
            )}
          />
        </span>
      </button>

      {/*
        With a workbench to send it to, "Review" means the panel — the chevron
        keeps the inline expansion for a quick look without leaving the
        transcript. It sits outside the toggle button because a button inside a
        button is not a thing the DOM allows.
      */}
      {onReview ? (
        <button
          type="button"
          onClick={onReview}
          className="absolute right-11 top-0 flex h-12 cursor-pointer items-center text-base text-text-secondary transition-colors hover:text-text-primary"
        >
          Review
        </button>
      ) : null}

      <Disclosure open={isOpen}>
        <div className="px-4 pb-2">
          {summary.files.map((file, index) => (
            <ChangedFileRow
              key={file.path}
              file={file}
              name={names[index]}
              // No divider above the first row — the bar header already
              // provides that edge, and doubling it reads as a gap.
              isFirst={index === 0}
            />
          ))}
        </div>
      </Disclosure>
    </div>
  );
}

function ChangedFileRow({
  file,
  name,
  isFirst,
}: {
  file: DiffFile;
  name: string;
  isFirst: boolean;
}) {
  const rowId = useMemo(() => stableId('changed-file', file.path), [file.path]);
  const [isOpen, toggleOpen] = useDisclosure(rowId, false);
  const title = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;

  return (
    <div className={cn(!isFirst && 'border-t border-border-subtle')}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        aria-label={`${title}, ${file.added} additions, ${file.removed} deletions. ${isOpen ? 'Hide' : 'Show'} diff`}
        className="group/file flex h-10 w-full cursor-pointer items-center gap-2 text-left transition-colors hover:bg-bg-hover"
      >
        <code className="app-code-compact min-w-0 truncate text-text-secondary" title={title}>
          {name}
        </code>
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
            'ml-auto h-3.5 w-3.5 shrink-0 text-text-tertiary opacity-35 transition-[opacity,transform] duration-fast group-hover/file:opacity-100 group-focus-within/file:opacity-100 motion-reduce:transition-none',
            isOpen && 'rotate-90 opacity-100'
          )}
        />
      </button>

      <Disclosure open={isOpen}>
        <div className="pb-2">
          <DiffBlock file={file} />
        </div>
      </Disclosure>
    </div>
  );
}
