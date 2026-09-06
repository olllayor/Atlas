/**
 * Bare-URL linkification for plain-text surfaces (user message bubbles).
 *
 * Assistant messages get rich links from the markdown pipeline
 * (`MarkdownAnchor`); user bubbles render raw text via `CitedText`, so a
 * pasted URL sat there as dead text. This splits text runs into text/url
 * segments so the renderer can hand URLs to the same anchor + favicon
 * components — nothing new is invented here.
 *
 * Citation splitting runs first and owns `atlas://` hrefs (malformed ones
 * stay verbatim inside text runs), so this only ever sees `http(s)://`.
 * Candidates still go through `parseExternalMarkdownUrl`: anything `new
 * URL` rejects stays plain text rather than becoming a confident link.
 */

import { parseExternalMarkdownUrl } from './markdownLinks';

export type TextUrlSegment = { kind: 'text'; text: string } | { kind: 'url'; url: string };

/** Trailing characters that end a sentence, not a URL. `)` is handled with paren balancing below. */
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"', ']', '}']);

/**
 * Split off sentence punctuation from a raw URL match.
 *
 * A trailing `)` is only stripped when it is unbalanced — Wikipedia-style
 * links like `…/X_(disambiguation)` keep theirs, while `(see https://…/y.)`
 * loses the closer and the period.
 */
function splitTrailingPunctuation(raw: string): { url: string; trailing: string } {
  let end = raw.length;
  while (end > 0) {
    const char = raw[end - 1]!;
    if (char === ')') {
      const head = raw.slice(0, end);
      const open = head.split('(').length;
      const close = head.split(')').length;
      if (close > open) {
        end -= 1;
        continue;
      }
      break;
    }
    if (TRAILING_PUNCTUATION.has(char)) {
      end -= 1;
      continue;
    }
    break;
  }
  return { url: raw.slice(0, end), trailing: raw.slice(end) };
}

export function splitTextByUrls(text: string): TextUrlSegment[] {
  // Fresh regex per call: `matchAll` needs `/g`, and a shared global would
  // carry `lastIndex` state between messages.
  const pattern = /https?:\/\/[^\s<>"`]+/gi;
  const segments: TextUrlSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const { url, trailing } = splitTrailingPunctuation(match[0]);
    // Unparseable stays text — a confident half-link is worse than none.
    if (!url || !parseExternalMarkdownUrl(url)) continue;
    if (start > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, start) });
    }
    segments.push({ kind: 'url', url });
    cursor = start + url.length + trailing.length;
    if (trailing) {
      segments.push({ kind: 'text', text: trailing });
    }
  }

  if (cursor === 0) return [{ kind: 'text', text }];
  if (cursor < text.length) {
    segments.push({ kind: 'text', text: text.slice(cursor) });
  }
  return segments;
}
