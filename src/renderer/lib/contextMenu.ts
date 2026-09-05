/**
 * Formats a raw text selection as a Markdown blockquote, suitable for quoting
 * into a composer draft.
 *
 * Empty lines inside the block are formatted as bare `>` to maintain markdown quote continuity.
 * Trailing double newline ensures following text starts on an unquoted line.
 */
export function formatMarkdownQuote(text: string): string {
  const trimmed = text.replace(/\r\n?/g, '\n').trim();
  if (!trimmed) {
    return '';
  }

  const lines = trimmed.split('\n');
  const quoted = lines.map((line) => (line.trim().length > 0 ? `> ${line}` : '>')).join('\n');
  return `${quoted}\n\n`;
}

/**
 * Formats text into an explanation prompt with the selected text blockquoted.
 */
export function formatExplainPrompt(text: string): string {
  const quote = formatMarkdownQuote(text);
  if (!quote) {
    return '';
  }

  return `Explain the following:\n\n${quote}`;
}

/** Longest query the palette search input and FTS path should ever receive. */
export const MAX_SEARCH_QUERY_CHARS = 200;

/**
 * Collapses a raw transcript selection into a single-line palette query:
 * newlines become spaces, runs of whitespace collapse, and the result is
 * capped so a whole-message selection does not become a paragraph-long search.
 */
export function sanitizeSearchQuery(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  return collapsed.length > MAX_SEARCH_QUERY_CHARS
    ? collapsed.slice(0, MAX_SEARCH_QUERY_CHARS).trimEnd()
    : collapsed;
}
