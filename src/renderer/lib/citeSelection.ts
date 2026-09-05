/**
 * Transcript text selection for Cite.
 *
 * Ports t3code's `assistantTextSelection` to Atlas markers. Each assistant
 * message root carries `data-cite-source="<messageId>"` and the transcript
 * scroller carries `data-cite-viewport`. Capture reads the message's DOM text
 * in DOM order (one line break per block, controls and hidden subtrees
 * skipped), records offsets into that stream, and stores normalized positions
 * plus a short prefix/suffix window so the quote re-resolves after re-renders.
 * Resolution demands a single context-matching occurrence; ties resolve to
 * null rather than the wrong spot.
 *
 * Positions are UTF-16 offsets into the whitespace-normalized stream. The
 * selector text keeps original line breaks and indentation.
 */

import { ASSISTANT_CITATION_CONTEXT_LENGTH } from '../../shared/citations';

export const CITE_SOURCE_ATTR = 'data-cite-source';
export const CITE_VIEWPORT_ATTR = 'data-cite-viewport';

export type CiteSelector = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly prefix: string;
  readonly suffix: string;
};

/** Live DOM state for an open comment or a pending cite, never persisted. */
export type CiteSourceAnchor = {
  source: HTMLElement;
  range: Range;
  viewport: HTMLElement;
};

export type CapturedCiteSelection = {
  messageId: string;
  source: HTMLElement;
  selector: CiteSelector;
  range: Range;
};

/**
 * DOM Range alias for modules where another `Range` type (e.g. the
 * virtualizer's) shadows the global. Same type, unambiguous name.
 */
export type CiteDomRange = Range;

const CONTROL_SELECTOR = 'button, input, textarea, select, [role=button], [contenteditable]';
const EXCLUDED_SELECTOR = `${CONTROL_SELECTOR}, [hidden], [aria-hidden=true], script, style, template, noscript, svg`;
const BLOCK_SELECTOR =
  'address, article, aside, blockquote, dd, div, dl, dt, figcaption, figure, footer, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, table, td, th, tr, ul';

export function normalizeCiteWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function splitsSurrogatePair(text: string, offset: number): boolean {
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/** Keeps the exact captured text while storing normalized UTF-16 positions and context. */
export function createCiteSelector(
  text: string,
  rawStart: number,
  rawEnd: number,
): CiteSelector | null {
  const quote = text.slice(rawStart, rawEnd);
  if (quote.trim().length === 0) return null;

  const normalized = normalizeCiteWhitespace(text);
  let start = normalizeCiteWhitespace(text.slice(0, rawStart)).length;
  // A selection starting inside a whitespace run includes its normalized space.
  if (rawStart > 0 && /\s/.test(text[rawStart - 1]!) && /\s/.test(text[rawStart]!)) {
    start -= 1;
  }
  const end = normalizeCiteWhitespace(text.slice(0, rawEnd)).length;
  let prefixStart = Math.max(0, start - ASSISTANT_CITATION_CONTEXT_LENGTH);
  let suffixEnd = Math.min(normalized.length, end + ASSISTANT_CITATION_CONTEXT_LENGTH);
  // A split pair becomes a replacement character when the context enters a URL.
  if (splitsSurrogatePair(normalized, prefixStart)) prefixStart += 1;
  if (splitsSurrogatePair(normalized, suffixEnd)) suffixEnd -= 1;
  return {
    text: quote,
    start,
    end,
    prefix: normalized.slice(prefixStart, start),
    suffix: normalized.slice(end, suffixEnd),
  };
}

/**
 * Matches case-sensitive text after collapsing each whitespace run to one
 * space, without trimming. Repeated quotes require one match for all supplied
 * context; saved offsets cannot break a context tie since they may have
 * drifted.
 */
export function findCitedText(
  text: string,
  selector: CiteSelector,
): { start: number; end: number } | null {
  const normalized = normalizeCiteWhitespace(text);
  const quote = normalizeCiteWhitespace(selector.text);
  if (quote.trim().length === 0) return null;

  const prefix = normalizeCiteWhitespace(selector.prefix);
  const suffix = normalizeCiteWhitespace(selector.suffix);
  const matchesContext = (start: number, end: number) =>
    normalized.slice(Math.max(0, start - prefix.length), start) === prefix &&
    normalized.slice(end, end + suffix.length) === suffix;

  let match =
    Number.isSafeInteger(selector.start) &&
    Number.isSafeInteger(selector.end) &&
    selector.start >= 0 &&
    selector.end - selector.start === quote.length &&
    normalized.slice(selector.start, selector.end) === quote &&
    matchesContext(selector.start, selector.end)
      ? { start: selector.start, end: selector.end }
      : null;
  let onlyQuote: { start: number; end: number } | null = null;
  let quoteCount = 0;

  for (
    let start = normalized.indexOf(quote);
    start !== -1;
    start = normalized.indexOf(quote, start + 1)
  ) {
    const end = start + quote.length;
    quoteCount += 1;
    onlyQuote = { start, end };
    if (!matchesContext(start, end)) continue;
    if (match !== null && match.start !== start) return null;
    match = { start, end };
  }

  return match ?? (quoteCount === 1 ? onlyQuote : null);
}

type TextChunk = { node: Text; start: number; end: number };

/**
 * Uses DOM text order, with a line break between HTML blocks and at <br>.
 * Inline markup contributes displayed text. Controls and hidden subtrees do
 * not. No layout reads, so reflow cannot move the stream.
 */
function readCiteText(root: HTMLElement) {
  const parts: string[] = [];
  const chunks: TextChunk[] = [];
  let length = 0;
  let separator = false;

  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      const text = node as Text;
      if (text.length === 0) return;
      if (separator && length > 0) {
        parts.push('\n');
        length += 1;
      }
      separator = false;
      chunks.push({ node: text, start: length, end: length + text.length });
      parts.push(text.data);
      length += text.length;
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.matches(EXCLUDED_SELECTOR)) return;
    const block = element.matches(BLOCK_SELECTOR);
    if (block || element.tagName === 'BR') separator = true;
    for (const child of element.childNodes) visit(child);
    if (block) separator = true;
  };

  visit(root);
  return { text: parts.join(''), chunks };
}

function excludedAncestor(node: Node): Element | null {
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return element?.closest(EXCLUDED_SELECTOR) ?? null;
}

function isUsableCiteRange(root: HTMLElement, range: Range): boolean {
  if (
    range.collapsed ||
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer) ||
    excludedAncestor(range.startContainer) !== null ||
    excludedAncestor(range.endContainer) !== null
  ) {
    return false;
  }
  // Interior controls are allowed; the reader omits them from the stream.
  return true;
}

function selectedTextBoundary(range: Range, node: Node, last: boolean): Text | null {
  if (!range.intersectsNode(node)) return null;
  if (node.nodeType === 3) {
    const text = node as Text;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : text.length;
    return start < end ? text : null;
  }
  for (
    let child = last ? node.lastChild : node.firstChild;
    child !== null;
    child = last ? child.previousSibling : child.nextSibling
  ) {
    const boundary = selectedTextBoundary(range, child, last);
    if (boundary !== null) return boundary;
  }
  return null;
}

/** Captures the ordered native range, including selections dragged backwards. */
export function captureCiteSelection(
  viewport: HTMLElement,
  selection: Selection | null,
): CapturedCiteSelection | null {
  if (selection === null || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const first = selectedTextBoundary(range, range.commonAncestorContainer, false);
  const last = selectedTextBoundary(range, range.commonAncestorContainer, true);
  if (first === null || last === null) return null;
  const source = first.parentElement?.closest<HTMLElement>(`[${CITE_SOURCE_ATTR}]`);
  if (!source || !viewport.contains(source)) return null;
  const messageId = source.getAttribute(CITE_SOURCE_ATTR);
  if (!messageId) return null;

  // A paragraph selection can end at the next block's offset 0 or a parent
  // boundary. Validate the text actually selected, not that empty endpoint.
  range.setStart(first, first === range.startContainer ? range.startOffset : 0);
  range.setEnd(last, last === range.endContainer ? range.endOffset : last.length);
  if (!isUsableCiteRange(source, range)) return null;

  const stream = readCiteText(source);
  let rawStart: number | null = null;
  let rawEnd = 0;
  for (const chunk of stream.chunks) {
    if (!range.intersectsNode(chunk.node)) continue;
    const start = range.startContainer === chunk.node ? range.startOffset : 0;
    const end = range.endContainer === chunk.node ? range.endOffset : chunk.node.length;
    if (start === end) continue;
    rawStart ??= chunk.start + start;
    rawEnd = chunk.start + end;
  }
  if (rawStart === null) return null;
  const selector = createCiteSelector(stream.text, rawStart, rawEnd);
  return selector === null ? null : { messageId, source, selector, range };
}

function rawTextOffset(text: string, normalizedOffset: number): number {
  let offset = 0;
  for (const match of text.matchAll(/\s+|\S+/g)) {
    const whitespace = /\s/.test(match[0][0]!);
    const length = whitespace ? 1 : match[0].length;
    if (normalizedOffset <= offset + length) {
      return (
        match.index +
        (whitespace && normalizedOffset > offset ? match[0].length : normalizedOffset - offset)
      );
    }
    offset += length;
  }
  return text.length;
}

/** Resolves against the current DOM without changing the user's selection. */
export function resolveCiteRange(root: HTMLElement, selector: CiteSelector): Range | null {
  if (excludedAncestor(root) !== null) return null;
  const stream = readCiteText(root);
  const match = findCitedText(stream.text, selector);
  if (match === null) return null;

  const start = rawTextOffset(stream.text, match.start);
  const end = rawTextOffset(stream.text, match.end);
  const first = stream.chunks.find((chunk) => chunk.end > start);
  const last = stream.chunks.findLast((chunk) => chunk.start < end);
  if (first === undefined || last === undefined) return null;

  const range = root.ownerDocument.createRange();
  range.setStart(first.node, Math.max(0, start - first.start));
  range.setEnd(last.node, Math.min(last.node.length, end - last.start));
  return isUsableCiteRange(root, range) ? range : null;
}

/** Finds a message source by id for comment anchoring and click-to-source. */
export function findCiteSourceAnchor(
  scope: ParentNode,
  messageId: string,
): Omit<CiteSourceAnchor, 'range'> | null {
  const source = scope.querySelector<HTMLElement>(`[${CITE_SOURCE_ATTR}="${CSS.escape(messageId)}"]`);
  const viewport = source?.closest<HTMLElement>(`[${CITE_VIEWPORT_ATTR}]`);
  if (!source || !viewport) return null;
  return { source, viewport };
}
