/**
 * Command output.
 *
 * Codex rules (`docs/codex-parity/design-audit.md` §4):
 *  - stdout and stderr are interleaved in one stream, no channel split
 *  - all output text is dim — recessive relative to the command
 *  - head/tail truncation with `… +N lines` between the halves
 *
 * Three things the first cut got wrong and this one does not:
 *
 *  1. `… +N lines` was static text, so the middle of every long log was
 *     permanently unreachable. It is a button now, and expanding scrolls
 *     inside the block rather than growing the transcript without bound.
 *  2. `whitespace-pre-wrap` + `break-words` next to `overflow-x-auto` meant
 *     nothing ever scrolled horizontally and column-aligned output (test
 *     runners, tables, `ls -l`) was shredded mid-token. Output is `pre` now
 *     and scrolls sideways for real.
 *  3. Every SGR sequence was stripped, so a red FAIL and a green PASS were
 *     the same grey. The basic 16 colours map onto theme tokens; everything
 *     else is still stripped rather than printed as `[32m` garbage.
 *
 * Output is emphatically *not* passed through the markdown pipeline —
 * backticks and asterisks in program output are not markup.
 */

import { Check, Copy } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { UIEvent } from 'react';

import { TOOL_OUTPUT_MAX_LINES, stripAnsi } from '../../../shared/toolCellGrammar';
import type { LineStore, WindowSpec } from '../../../shared/toolOutputStream';
import { useClipboard } from '../../hooks/useClipboard';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

/*
 * `stripAnsi` and its CSI/OSC pattern live in `shared/toolCellGrammar` since
 * raw mode needed them: raw mode renders the same output without this
 * component, and two copies of the escape pattern would mean a sequence this
 * one learns to strip is still printed as `←[32m✓←[0m` over there.
 */
export { stripAnsi };

/** Just the SGR (`ESC [ ... m`) subset, which is the part that carries colour. */
// eslint-disable-next-line no-control-regex
const SGR_PATTERN = /\u001B\[([0-9;]*)m/g;

/**
 * A bare `\r` rewinds the cursor to column 0, so a progress bar that
 * redraws itself 400 times is *one* line, not 400. Keep the final redraw.
 */
export function collapseCarriageReturns(line: string): string {
  if (!line.includes('\r')) return line;
  const segments = line.split('\r');
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index].length > 0) return segments[index];
  }
  return '';
}

/**
 * The basic 16 SGR foreground colours, mapped onto semantic theme tokens
 * rather than literal hexes — a red FAIL has to stay red on every theme,
 * and "red" in the abstract is exactly what `--error` means.
 */
const SGR_CLASS: Record<number, string> = {
  30: 'text-text-faint',
  31: 'text-error',
  32: 'text-success',
  33: 'text-warning',
  34: 'text-accent',
  35: 'text-text-secondary',
  36: 'text-accent',
  37: 'text-text-secondary',
  90: 'text-text-faint',
  91: 'text-error',
  92: 'text-success',
  93: 'text-warning',
  94: 'text-accent',
  95: 'text-text-secondary',
  96: 'text-accent',
  97: 'text-text-primary',
};

type Segment = { text: string; className?: string };

function applySgr(codes: number[], current: string | undefined): string | undefined {
  let next = current;
  for (const code of codes) {
    if (code === 0) {
      next = undefined;
    } else if (code === 39) {
      // Default foreground.
      next = undefined;
    } else if (SGR_CLASS[code]) {
      next = SGR_CLASS[code];
    }
    // Bold/dim/italic and 256/truecolor selectors are deliberately ignored:
    // the point is the pass/fail signal, not terminal emulation.
  }
  return next;
}

/** Split one line into coloured runs, dropping every non-SGR escape. */
export function parseAnsiLine(line: string): Segment[] {
  const source = collapseCarriageReturns(line);
  if (!source.includes('\u001B')) {
    return [{ text: source }];
  }

  const segments: Segment[] = [];
  let className: string | undefined;
  let lastIndex = 0;

  SGR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SGR_PATTERN.exec(source)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: stripAnsi(source.slice(lastIndex, match.index)), className });
    }
    const codes = match[1]
      .split(';')
      .filter((part) => part !== '')
      .map(Number);
    className = applySgr(codes.length ? codes : [0], className);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < source.length) {
    segments.push({ text: stripAnsi(source.slice(lastIndex)), className });
  }

  return segments.filter((segment) => segment.text.length > 0);
}

/** Fallback row height until the first line measures (term font + leading). */
const ESTIMATED_ROW_HEIGHT_PX = 18;

function AnsiLines({ lines }: { lines: readonly string[] }) {
  return (
    <>
      {lines.map((line, index) => {
        const segments = parseAnsiLine(line);
        return (
          // A block span is the line break. Emitting a literal `\n` as well
          // would double-space the whole block inside a `<pre>`.
          <span key={index} className="block">
            {segments.length === 0
              ? ' '
              : segments.map((segment, segmentIndex) =>
                  segment.className ? (
                    <span key={segmentIndex} className={segment.className}>
                      {segment.text}
                    </span>
                  ) : (
                    <span key={segmentIndex}>{segment.text}</span>
                  )
                )}
          </span>
        );
      })}
    </>
  );
}

/** Memo-dead during stream once head freezes (same array identity). */
const HeadLines = memo(function HeadLines({ lines }: { lines: readonly string[] }) {
  return <AnsiLines lines={lines} />;
});

/**
 * Windowed full log. Only the visible rows mount; pad spacers hold scroll
 * height. One calculator (`LineStore.getWindow`) — no second path.
 */
function VirtualLog({
  source,
  rowHeight,
  viewportHeight,
  scrollTop,
  generation,
}: {
  source: LineStore;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  generation: number;
}) {
  const win: WindowSpec = useMemo(
    () => source.getWindow(rowHeight, viewportHeight, scrollTop),
    [source, rowHeight, viewportHeight, scrollTop, generation]
  );
  const rows = source.getLines(win.start, win.end);
  return (
    <>
      <div style={{ height: win.padTop }} aria-hidden="true" />
      <AnsiLines lines={rows} />
      <div style={{ height: win.padBottom }} aria-hidden="true" />
    </>
  );
}

export function TerminalBlock({
  lines,
  omitted,
  head,
  tail,
  allLines,
  source,
  peek,
  running = false,
  className,
}: {
  /** Head + tail slice as produced by the grammar. */
  lines: string[];
  omitted: number;
  /**
   * How many of `lines` belong to the head. Supplied by the grammar; when
   * absent (older callers) the split falls back to an even halving, which
   * is only ever right by accident.
   */
  head?: number;
  tail?: number;
  /** Untruncated output — what the `… +N lines` button reveals. */
  allLines?: string[];
  /**
   * Line store behind the cap. When present, expand is a virtual window over
   * the full log instead of a second head/tail slice of `allLines`.
   */
  source?: LineStore;
  /** Bounded live peek while the call is still running. */
  peek?: string | null;
  running?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { copied, copy } = useClipboard();
  const preRef = useRef<HTMLPreElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const [rowHeight, setRowHeight] = useState(ESTIMATED_ROW_HEIGHT_PX);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);

  const generation = useSyncExternalStore(
    useCallback((onChange: () => void) => source?.subscribe(onChange) ?? (() => undefined), [source]),
    useCallback(() => source?.getGeneration() ?? 0, [source]),
    useCallback(() => source?.getGeneration() ?? 0, [source])
  );

  const full = useMemo(() => {
    if (source) return [...source.getLines(0, source.getLineCount())];
    return allLines && allLines.length > 0 ? allLines : lines;
  }, [source, allLines, lines, generation]);

  // Prefer the store's frozen head so HeadLines stays memo-dead while the
  // tail slides. Fall back to slicing `lines` when no store is attached.
  const { headLines, tailLines } = useMemo(() => {
    if (omitted <= 0) return { headLines: lines as readonly string[], tailLines: [] as readonly string[] };
    if (source) {
      const view = source.getCapView(head ?? TOOL_OUTPUT_MAX_LINES, tail ?? TOOL_OUTPUT_MAX_LINES).view;
      return { headLines: view.head, tailLines: view.tail };
    }
    const headCount = head ?? Math.ceil(lines.length / 2);
    return {
      headLines: lines.slice(0, headCount),
      tailLines: lines.slice(tail != null ? lines.length - tail : headCount),
    };
  }, [source, lines, omitted, head, tail, generation]);

  const canExpand =
    omitted > 0 && (source ? source.getLineCount() > lines.length : full.length > lines.length);
  const showingAll = expanded && canExpand;

  // Legacy fallback when no store is attached: keep the old 200-line window.
  const renderedExpanded = useMemo(() => {
    const MAX_EXPANDED_RENDER_LINES = 200;
    if (source || !showingAll || full.length <= MAX_EXPANDED_RENDER_LINES) {
      return { isCapped: false, head: full, tail: [] as readonly string[], cappedCount: 0 };
    }
    const half = Math.floor(MAX_EXPANDED_RENDER_LINES / 2);
    return {
      isCapped: true,
      head: full.slice(0, half),
      tail: full.slice(full.length - half),
      cappedCount: full.length - MAX_EXPANDED_RENDER_LINES,
    };
  }, [source, showingAll, full]);

  useEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    const height = probe.getBoundingClientRect().height;
    if (height > 0) setRowHeight(height);
  }, [expanded]);

  useEffect(() => {
    if (!showingAll || !source) return;
    const pre = preRef.current;
    if (!pre) return;
    const update = () => setViewportHeight(pre.clientHeight || 320);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(pre);
    return () => observer.disconnect();
  }, [showingAll, source]);

  const onScroll = useCallback((event: UIEvent<HTMLPreElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  if (!lines.length && !showingAll) return null;

  // Plain dim mono, no gutter glyph, no border — the app's expanded
  // command output is borderless (reference-visual-spec.md §5).
  return (
    <div className="group/term relative min-w-0">
      {running && peek ? (
        <div
          data-testid="tool-output-peek"
          className="app-code-compact mb-0.5 truncate text-text-faint"
          title="streaming peek"
        >
          {peek}
        </div>
      ) : null}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void copy(full.join('\n'))}
            aria-label={copied ? 'Copied' : 'Copy output'}
            className="absolute right-0 top-0 z-10 rounded-sm bg-bg-surface/90 p-1 text-text-muted opacity-0 transition-opacity duration-fast hover:text-text-primary focus-visible:opacity-100 group-hover/term:opacity-100 group-focus-within/term:opacity-100 motion-reduce:transition-none"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{copied ? 'Copied' : 'Copy output'}</TooltipContent>
      </Tooltip>

      <pre
        ref={preRef}
        onScroll={showingAll && source ? onScroll : undefined}
        className={cn(
          'app-terminal-text scrollbar-auto-hide m-0 min-w-0 overflow-x-auto whitespace-pre text-text-tertiary',
          showingAll && 'max-h-[60vh] overflow-y-auto',
          className
        )}
      >
        {/* Measures one output line for the virtual window. */}
        <span ref={probeRef} className="pointer-events-none block select-none" aria-hidden="true">
          &nbsp;
        </span>
        {showingAll ? (
          source ? (
            <VirtualLog
              source={source}
              rowHeight={rowHeight}
              viewportHeight={viewportHeight}
              scrollTop={scrollTop}
              generation={generation}
            />
          ) : renderedExpanded.isCapped ? (
            <>
              <AnsiLines lines={renderedExpanded.head} />
              <div className="my-1.5 rounded bg-bg-hover px-2 py-0.5 text-2xs text-text-faint select-none">
                … {renderedExpanded.cappedCount} lines omitted from view (copy button includes full output)
              </div>
              <AnsiLines lines={renderedExpanded.tail} />
            </>
          ) : (
            <AnsiLines lines={full} />
          )
        ) : (
          <>
            <HeadLines lines={headLines} />
            {omitted > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  aria-label={`Show ${omitted} hidden lines of output`}
                  className="block cursor-pointer rounded-sm text-left text-text-faint underline decoration-dotted underline-offset-2 transition-colors hover:text-text-secondary"
                >
                  … +{omitted} lines
                </button>
                <AnsiLines lines={tailLines} />
              </>
            )}
          </>
        )}
      </pre>

      {showingAll && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="app-code-compact mt-0.5 cursor-pointer rounded-sm text-text-faint transition-colors hover:text-text-secondary"
        >
          Collapse output
        </button>
      )}
    </div>
  );
}
