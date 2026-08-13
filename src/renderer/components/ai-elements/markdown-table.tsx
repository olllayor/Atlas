import { Check, Copy } from 'lucide-react';
import { useCallback, useRef } from 'react';
import type { ComponentProps, CSSProperties } from 'react';
import { extractTableDataFromElement, tableDataToMarkdown } from 'streamdown';

import { cn } from '../../lib/utils';
import { useClipboard } from '../../hooks/useClipboard';

/**
 * Markdown tables, rendered the way Codex renders them.
 *
 * Streamdown ships its own table chrome — an outer card (`rounded-lg border
 * bg-sidebar p-2`) wrapping a second bordered box, a permanently visible
 * copy/download/fullscreen toolbar, and a fully ruled grid. That is four
 * nested rectangles and three buttons around what is usually a six-row
 * comparison, and it reads as a widget dropped into the prose rather than as
 * part of the answer.
 *
 * Codex draws the same data with rules alone (`docs/codex-parity/
 * research-raw.md` §6.3, from its own `visualize.css`):
 *
 *   - `border-collapse`, no outer border, no card, no fill;
 *   - a hairline under each row, and the last row loses it;
 *   - a heavier rule under the header (16% fg vs the 8% hairline);
 *   - `th` at weight 600 — the only 600 in the entire stylesheet;
 *   - cell padding `10px 24px 10px 0`, i.e. flush left, gap on the right, so
 *     the first column aligns with the paragraph text above it;
 *   - right-aligned cells get `tabular-nums`;
 *   - the only wrapper is `overflow-x: auto`.
 *
 * The TUI states the same grammar in box-drawing characters: header row, a
 * heavy `━` rule, `─` between body rows, and no vertical rules anywhere
 * (`codex-rs/tui/src/markdown_render.rs`, `TABLE_HEADER_SEPARATOR_CHAR` /
 * `TABLE_BODY_SEPARATOR_CHAR`).
 *
 * The one deliberate divergence: a copy button. Codex has none, but losing
 * copy outright is a functional regression, so it is hover- and
 * focus-revealed and carries no chrome at rest — the table still looks like
 * prose until you reach for it.
 */

type NodeProp = { node?: unknown };

const alignmentOf = (style: CSSProperties | undefined) => style?.textAlign;

function MarkdownTable({ children, className, node: _node, ...props }: ComponentProps<'table'> & NodeProp) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { copied, copy } = useClipboard();

  const handleCopy = useCallback(() => {
    const table = wrapperRef.current?.querySelector('table');
    if (!table) return;
    void copy(tableDataToMarkdown(extractTableDataFromElement(table)));
  }, [copy]);

  return (
    <div className="group/table relative my-4" ref={wrapperRef}>
      {/*
        Sits over the header row's trailing gutter rather than in a toolbar
        of its own: a row that only exists on hover would either reserve
        empty space at rest or shift the table down when it appears.
      */}
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : 'Copy table as Markdown'}
        className="absolute -top-1 right-0 z-10 rounded-md bg-[var(--bg-base)]/80 p-1.5 text-text-muted opacity-0 backdrop-blur-sm transition-opacity duration-fast hover:text-text-primary focus-visible:opacity-100 group-hover/table:opacity-100 group-focus-within/table:opacity-100 motion-reduce:transition-none"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-[var(--text-tertiary)]" /> : <Copy className="h-3.5 w-3.5" />}
      </button>

      <div className="scrollbar-auto-hide overflow-x-auto overscroll-y-auto">
        <table
          className={cn(
            'w-full border-collapse text-left [&_tbody_tr:last-child>td]:border-b-0',
            className
          )}
          data-streamdown="table"
          {...props}
        >
          {children}
        </table>
      </div>
    </div>
  );
}

function MarkdownThead({ children, className, node: _node, ...props }: ComponentProps<'thead'> & NodeProp) {
  return (
    <thead className={className} data-streamdown="table-header" {...props}>
      {children}
    </thead>
  );
}

function MarkdownTbody({ children, className, node: _node, ...props }: ComponentProps<'tbody'> & NodeProp) {
  return (
    <tbody className={className} data-streamdown="table-body" {...props}>
      {children}
    </tbody>
  );
}

function MarkdownTr({ children, className, node: _node, ...props }: ComponentProps<'tr'> & NodeProp) {
  return (
    <tr className={className} data-streamdown="table-row" {...props}>
      {children}
    </tr>
  );
}

function MarkdownTh({ children, className, node: _node, style, ...props }: ComponentProps<'th'> & NodeProp) {
  return (
    <th
      className={cn(
        'border-b border-border-medium py-2 pr-6 pl-0 align-bottom font-semibold text-text-primary last:pr-0',
        alignmentOf(style) === 'right' && 'tabular-nums',
        className
      )}
      data-streamdown="table-header-cell"
      style={style}
      {...props}
    >
      {children}
    </th>
  );
}

function MarkdownTd({ children, className, node: _node, style, ...props }: ComponentProps<'td'> & NodeProp) {
  return (
    <td
      className={cn(
        'border-b border-border-subtle py-2.5 pr-6 pl-0 align-top last:pr-0',
        alignmentOf(style) === 'right' && 'tabular-nums',
        className
      )}
      data-streamdown="table-cell"
      style={style}
      {...props}
    >
      {children}
    </td>
  );
}

export const markdownTableComponents = {
  table: MarkdownTable,
  thead: MarkdownThead,
  tbody: MarkdownTbody,
  tr: MarkdownTr,
  th: MarkdownTh,
  td: MarkdownTd
};
