/**
 * Unified diff rendering.
 *
 * Codex rules (`docs/codex-parity/design-audit.md` §5):
 *  - unified, never side-by-side
 *  - `{right-aligned line number}{space}{sign}{content}`
 *  - old number on deletes, new number on inserts, shared on context
 *  - gutter width adapts to the largest number
 *  - non-adjacent hunks separated by a lone `⋮`
 *
 * Colours come from the `--diff-*` tokens, which carry GitHub's palette
 * (`#213A2B` / `#4A221D` dark, `#DAFBE1` / `#FFEBE9` light).
 *
 * Two accessibility rules the first cut broke: added/removed was conveyed
 * by background colour alone with the `+`/`-` marked `aria-hidden`, so a
 * screen reader heard a flat list of unattributed lines; and the 400-row
 * cap was a dead end with no way to see the rest. Both are fixed here.
 */

import { Check, Copy } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { DiffFile, DiffLine } from '../../../shared/toolCellGrammar';
import { useClipboard } from '../../hooks/useClipboard';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

/** Cap rendered rows so a thousand-line patch cannot stall the transcript. */
const MAX_RENDERED_LINES = 400;

/**
 * One minus glyph everywhere. U+2212 is the same advance width as `+` in
 * every monospace face we ship, so signs stay in one column; ASCII `-`
 * does not, and the two were mixed across the transcript.
 */
export const MINUS = '−';

type DiffRowModel = { kind: 'gap' } | ({ kind: 'line' } & DiffLine);

export function DiffBlock({ file }: { file: DiffFile }) {
  const [expanded, setExpanded] = useState(false);
  const { copied, copy } = useClipboard();

  const { all, gutterWidth } = useMemo(() => {
    const collected: DiffRowModel[] = [];
    let widest = 1;

    for (const hunk of file.hunks) {
      if (hunk.gapBefore) collected.push({ kind: 'gap' });
      for (const line of hunk.lines) {
        if (line.lineNumber != null) {
          widest = Math.max(widest, String(line.lineNumber).length);
        }
        collected.push({ kind: 'line', ...line });
      }
    }

    return { all: collected, gutterWidth: widest };
  }, [file]);

  const hidden = Math.max(0, all.length - MAX_RENDERED_LINES);
  const rows = expanded ? all : all.slice(0, MAX_RENDERED_LINES);

  // Copies as a real unified patch — ASCII signs, not the U+2212 used for
  // display — so the result can be piped straight into `git apply`.
  const patchText = useMemo(
    () => all.map((row) => (row.kind === 'gap' ? '...' : `${row.sign}${row.content}`)).join('\n'),
    [all]
  );

  if (!all.length) return null;

  return (
    <div className="group/diff relative overflow-hidden rounded-sm border border-border-subtle">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void copy(patchText)}
            aria-label={copied ? 'Copied' : 'Copy diff'}
            className="absolute right-1 top-1 z-10 rounded-sm bg-bg-surface/90 p-1 text-text-muted opacity-0 transition-opacity duration-fast hover:text-text-primary focus-visible:opacity-100 group-hover/diff:opacity-100 group-focus-within/diff:opacity-100 motion-reduce:transition-none"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{copied ? 'Copied' : 'Copy diff'}</TooltipContent>
      </Tooltip>

      {/*
        `whitespace-pre` + a real horizontal scroller. The previous
        `whitespace-pre-wrap break-words` made `overflow-x-auto` inert and
        chopped identifiers mid-token, which is precisely the information a
        diff exists to preserve.
      */}
      <div
        className={cn(
          'scrollbar-auto-hide overflow-x-auto',
          expanded && hidden > 0 && 'max-h-[60vh] overflow-y-auto'
        )}
      >
        <table className="app-code-text w-full border-collapse leading-[1.55]">
          <tbody>
            {rows.map((row, index) =>
              row.kind === 'gap' ? (
                <tr key={`gap-${index}`}>
                  <td colSpan={2} className="select-none px-2 text-center text-text-faint">
                    <span aria-hidden>⋮</span>
                    <span className="sr-only">Skipped unchanged lines</span>
                  </td>
                </tr>
              ) : (
                <DiffRow key={index} line={row} gutterWidth={gutterWidth} />
              )
            )}
          </tbody>
        </table>
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="w-full cursor-pointer border-t border-border-subtle px-2 py-1 text-left text-xs text-text-faint transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          {expanded ? 'Show first 400 lines' : `Show ${hidden} more diff lines`}
        </button>
      )}
    </div>
  );
}

function DiffRow({ line, gutterWidth }: { line: DiffLine; gutterWidth: number }) {
  const isAdd = line.sign === '+';
  const isDel = line.sign === '-';

  return (
    <tr className={cn(isAdd && 'bg-diff-add-bg', isDel && 'bg-diff-del-bg')}>
      <td
        className={cn(
          'select-none whitespace-pre px-2 text-right align-top tabular-nums text-diff-gutter-fg',
          isAdd && 'bg-diff-add-gutter-bg',
          isDel && 'bg-diff-del-gutter-bg'
        )}
        style={{ width: `${gutterWidth + 1}ch` }}
      >
        {line.lineNumber ?? ''}
      </td>
      <td
        className={cn(
          'whitespace-pre pr-2 align-top',
          isAdd && 'text-diff-add-fg',
          isDel && 'text-diff-del-fg',
          !isAdd && !isDel && 'text-text-tertiary'
        )}
      >
        {/*
          The visible sign is decorative — colour and glyph both — so it is
          hidden from assistive tech and replaced with a word. Without this
          a diff reads as an undifferentiated list of code lines.
        */}
        {(isAdd || isDel) && <span className="sr-only">{isAdd ? 'Added: ' : 'Removed: '}</span>}
        <span aria-hidden className="select-none pr-1 opacity-70">
          {isDel ? MINUS : line.sign}
        </span>
        {line.content}
      </td>
    </tr>
  );
}
