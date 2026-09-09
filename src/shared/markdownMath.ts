/**
 * Shared Markdown math grammar (port of t3code PR #10698,
 * `packages/client-runtime/src/markdownMath.ts`).
 *
 * Recognizes `$…$`, `$$…$$`, `\(…\)` and `\[…\]` inside Markdown's text
 * grammar, so code spans, links and escapes keep their semantics. Pandoc-style
 * dollar boundaries keep `$20 and $30` as ordinary prose, and unfinished
 * math stays readable while streaming.
 *
 * Kept in `shared/` and free of React so it can be unit-tested directly and
 * reused by the renderer without a second delimiter scanner.
 */

import type { Literal, Root, Text } from 'mdast';
import { markdownLineEnding, markdownSpace } from 'micromark-util-character';
import type { Code, Construct, State, Tokenizer } from 'micromark-util-types';
import remarkParse from 'remark-parse';
import { unified, type Processor } from 'unified';
import { visit } from 'unist-util-visit';

export interface MarkdownMath {
  readonly source: string;
  readonly tex: string;
  readonly display: boolean;
}

interface MathNode extends Literal {
  type: 'inlineMath';
  data: {
    math: MarkdownMath | null;
    hName: 'span';
    hProperties: { dataMathSource: string };
  };
  /**
   * The source as a text child, so the equation survives sanitizers that
   * strip `dataMathSource` (see `rehypeMathSource`). Harmless when the
   * attribute survives — the renderer reads the attribute, never the child.
   */
  children: [Text];
}

declare module 'mdast' {
  interface RootContentMap {
    inlineMath: MathNode;
  }
  interface PhrasingContentMap {
    inlineMath: MathNode;
  }
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    t3Math: 't3Math';
    t3MathData: 't3MathData';
  }
}

// Bound both incomplete-delimiter lookahead and work handed to a TeX renderer.
const MAX_MATH_LENGTH = 16_384;

export function markdownMath(source: string): MarkdownMath | null {
  const opener = source.startsWith('$$') ? '$$' : source.slice(0, 2);
  const delimiter = opener === '\\(' || opener === '\\[' || opener === '$$' ? opener : '$';
  const close = delimiter === '\\(' ? '\\)' : delimiter === '\\[' ? '\\]' : delimiter;
  if (
    !source.startsWith(delimiter) ||
    !source.endsWith(close) ||
    source.length <= delimiter.length + close.length ||
    source.length > MAX_MATH_LENGTH
  )
    return null;
  const tex = source.slice(delimiter.length, -close.length).trim();
  return tex ? { source, tex, display: delimiter === '$$' || delimiter === '\\[' } : null;
}

const tokenizeMath: Tokenizer = function (effects, ok, nok) {
  let opener: '$' | '$$' | '\\(' | '\\[' = '$';
  let count = 0;
  let previous: Code = null;
  let closingCount = 0;
  let hasContent = false;
  let lineStart = false;
  let dataOpen = false;
  const closeData = () => {
    if (dataOpen) effects.exit('t3MathData');
    dataOpen = false;
  };
  const consume = (code: Code) => {
    if (!dataOpen) effects.enter('t3MathData');
    dataOpen = true;
    effects.consume(code);
    count += 1;
    previous = code;
  };
  return start;

  function unfinished(code: Code): State | undefined {
    if (opener === '$' || opener === '$$') return nok(code);
    closeData();
    effects.exit('t3Math');
    return ok(code);
  }
  function start(code: Code): State | undefined {
    effects.enter('t3Math');
    consume(code);
    return code === 92 ? backslashOpen : dollarOpen;
  }
  function backslashOpen(code: Code): State | undefined {
    if (code !== 40 && code !== 91) return nok(code);
    opener = code === 40 ? '\\(' : '\\[';
    consume(code);
    return body;
  }
  function dollarOpen(code: Code): State | undefined {
    if (code === 36) {
      opener = '$$';
      consume(code);
      return displayStart;
    }
    if (code === null || markdownLineEnding(code) || markdownSpace(code)) return nok(code);
    return body(code);
  }
  function displayStart(code: Code): State | undefined {
    return code === 36 ? nok(code) : body(code);
  }
  function body(code: Code): State | undefined {
    if (code === null || count >= MAX_MATH_LENGTH) return unfinished(code);
    if (markdownLineEnding(code)) {
      // A blank line ends a candidate. Never swallow later paragraphs while streaming.
      if (lineStart || opener === '$') return unfinished(code);
      lineStart = true;
      closeData();
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
      count += 1;
      previous = code;
      return body;
    }
    if (!markdownSpace(code)) lineStart = false;
    if (code === 92) {
      consume(code);
      return escaped;
    }
    /*
     * Atlas deviation (upstream #10698 has this hole): a bare backtick aborts
     * the candidate. The tokenizer commits at the earlier `$` before the code
     * construct is ever tried, so without this `Pay $30 for `$x$`` matches
     * `$30 for `$` and eats the code span. Aborting re-scans from the `$`,
     * which falls back to literal text while the code span parses normally.
     * An escaped backtick (TeX grave) arrives via `escaped` and is unaffected.
     */
    if (code === 96) return nok(code);
    if (code === 36 && (opener === '$' || opener === '$$')) {
      if (
        !hasContent ||
        (opener === '$' && (markdownSpace(previous) || markdownLineEnding(previous)))
      )
        return nok(code);
      closingCount = 1;
      consume(code);
      return closeDollar;
    }
    if (!markdownSpace(code)) hasContent = true;
    consume(code);
    return body;
  }
  function escaped(code: Code): State | undefined {
    if ((opener === '\\(' && code === 41) || (opener === '\\[' && code === 93)) {
      consume(code);
      closeData();
      effects.exit('t3Math');
      return ok;
    }
    if (code === null || markdownLineEnding(code)) return body(code);
    hasContent = true;
    consume(code);
    return body;
  }
  function closeDollar(code: Code): State | undefined {
    if (code === 36) {
      closingCount += 1;
      consume(code);
      return closeDollar;
    }
    if (closingCount !== opener.length) return nok(code);
    // Pandoc-style dollar boundaries keep "$20 and $30" as ordinary prose.
    if (opener === '$' && code !== null && code >= 48 && code <= 57) return nok(code);
    closeData();
    effects.exit('t3Math');
    return ok(code);
  }
};

/** Recognize math in Markdown's text grammar, so code, links and escapes keep their semantics. */
function attachMath(this: Processor) {
  const data = this.data();
  const construct: Construct = { tokenize: tokenizeMath };
  (data.micromarkExtensions ??= []).push({
    text: { 36: construct, 92: construct },
  });
  (data.fromMarkdownExtensions ??= []).push({
    enter: {
      t3Math(token) {
        const source = this.sliceSerialize(token);
        const math = markdownMath(source);
        this.enter(
          {
            type: 'inlineMath',
            value: math?.tex ?? source,
            data: {
              math,
              hName: 'span',
              hProperties: { dataMathSource: source },
            },
            children: [{ type: 'text', value: source }],
          },
          token,
        );
      },
    },
    exit: {
      t3Math(token) {
        this.exit(token);
      },
    },
  });
}

export const remarkMath = attachMath;

type HastSpan = {
  readonly type?: unknown;
  readonly tagName?: unknown;
  properties?: Record<string, unknown>;
  readonly children?: ReadonlyArray<{ readonly type?: unknown; readonly value?: unknown }>;
};

/**
 * Re-attach math sources stripped by sanitization.
 *
 * Runs after `rehype-sanitize` (Streamdown appends the math `rehypePlugin`
 * last): a `span` whose only child is text that parses whole as math regains
 * its `dataMathSource`. Ordinary spans never match — their text is prose,
 * not a complete delimited equation — and spans that kept the attribute are
 * skipped. Genuinely authored `<span>$x$</span>` HTML upgrades too, which
 * matches math semantics.
 */
export function rehypeMathSource() {
  return (tree: unknown) => {
    visit(tree as Parameters<typeof visit>[0], 'element', (node) => {
      const element = node as unknown as HastSpan;
      if (element.tagName !== 'span') return;
      if (element.properties?.dataMathSource !== undefined) return;
      const children = element.children ?? [];
      if (children.length !== 1 || children[0]?.type !== 'text') return;
      const text = children[0]?.value;
      if (typeof text !== 'string' || markdownMath(text) === null) return;
      (element.properties ??= {}).dataMathSource = text;
    });
  };
}

const parser = unified().use(remarkParse).use(remarkMath).freeze();

/** Source ranges for consumers without a Markdown pipeline. */
export function markdownMathRanges(source: string) {
  const matches: Array<{ source: string; math: MarkdownMath | null; start: number; end: number }> =
    [];
  if (!source.includes('$') && !source.includes('\\(') && !source.includes('\\[')) return matches;
  const tree = parser.parse(source);
  function visit(node: Root | Root['children'][number] | MathNode): void {
    if (node.type === 'inlineMath') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined)
        matches.push({
          source: node.data.hProperties.dataMathSource,
          math: node.data.math,
          start,
          end,
        });
    } else if ('children' in node) {
      for (const child of node.children) visit(child);
    }
  }
  visit(tree);
  return matches;
}
