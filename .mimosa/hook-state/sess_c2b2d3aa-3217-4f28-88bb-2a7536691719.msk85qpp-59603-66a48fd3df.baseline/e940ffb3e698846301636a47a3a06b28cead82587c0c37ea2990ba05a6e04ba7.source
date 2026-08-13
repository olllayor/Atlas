const VISUAL_START = '<visual';
const VISUAL_END = '</visual>';
const FENCE = '```';
const POTENTIAL_START_TOKENS = [VISUAL_START, '<svg', '<html', '<style', '<div style', FENCE];

/** Holds possible split of `</visual>` and long opening tags (e.g. `<div ... style=`). */
export const SAFETY_BUFFER = 32;

/**
 * A fence that immediately wraps a `<visual>` block.
 *
 * Models are told not to fence visuals and do it anyway, so the wrapper is
 * removed — but only this one. The previous version stripped *every* fence
 * marker out of the stream, which silently deleted the fences around ordinary
 * ```html code samples and then let the raw-markup fallback below render the
 * sample as a live visual.
 */
const FENCE_WRAPPING_VISUAL = /```[A-Za-z0-9+#-]*[ \t]*(?:\r?\n)?(?=[ \t]*<visual)/gi;

/** A fence at the very end of the buffer: what follows decides what it means. */
const TRAILING_FENCE = /```[A-Za-z0-9+#-]*[ \t]*\r?\n?$/;

function getTrailingFenceLength(buffer: string): number {
  const match = buffer.match(TRAILING_FENCE);
  return match ? match[0].length : 0;
}

export function detectRequiredLibraries(html: string): string[] {
  const libs: string[] = [];
  if (/new Chart\s*\(/.test(html)) libs.push('chartjs');
  if (/\bd3\.(select|force|scale|axis|line|area|pie|arc|geo|brush|zoom|drag|transition)\b/.test(html)) libs.push('d3');
  return libs;
}

const RAW_END = {
  svg: '</svg>',
  html: '</html>',
  style: '</style>',
} as const;

type RawKind = keyof typeof RAW_END | 'div';

function indexOfIgnoreCase(haystack: string, needle: string, from = 0): number {
  const lowerH = haystack.toLowerCase();
  const lowerN = needle.toLowerCase();
  return lowerH.indexOf(lowerN, from);
}

function findTagEnd(buffer: string, from: number): number {
  let quote: '"' | "'" | null = null;

  for (let index = from; index < buffer.length; index += 1) {
    const character = buffer[index];
    if (quote) {
      if (character === quote && buffer[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === '>') {
      return index;
    }
  }

  return -1;
}

function getTrailingPartialTokenLength(buffer: string, tokens: string[]): number {
  const lowerBuffer = buffer.toLowerCase();
  let longest = 0;

  for (const token of tokens) {
    const maxLength = Math.min(token.length, lowerBuffer.length);
    for (let length = maxLength; length >= 1; length -= 1) {
      if (lowerBuffer.endsWith(token.slice(0, length))) {
        longest = Math.max(longest, length);
        break;
      }
    }
  }

  return longest;
}

function isBlockLeadingPosition(buffer: string, index: number): boolean {
  if (index === 0) {
    return true;
  }
  const prev = buffer[index - 1];
  return /\s/.test(prev) || '([:-'.includes(prev);
}

function findDivStyleBlockStart(buffer: string): number {
  let searchFrom = 0;
  while (searchFrom < buffer.length) {
    const i = indexOfIgnoreCase(buffer, '<div', searchFrom);
    if (i === -1) {
      return -1;
    }
    if (!isBlockLeadingPosition(buffer, i)) {
      searchFrom = i + 4;
      continue;
    }
    const tagEnd = findTagEnd(buffer, i);
    if (tagEnd === -1) {
      return -1;
    }
    const openTag = buffer.slice(i, tagEnd + 1);
    if (/\bstyle\s*=/i.test(openTag)) {
      return i;
    }
    searchFrom = i + 4;
  }
  return -1;
}

function findEarliestRawKind(buffer: string): { index: number; kind: RawKind } | null {
  let best: { index: number; kind: RawKind } | null = null;

  const tryCandidate = (index: number, kind: RawKind) => {
    if (index === -1 || !isBlockLeadingPosition(buffer, index)) {
      return;
    }
    if (!best || index < best.index) {
      best = { index, kind };
    }
  };

  tryCandidate(indexOfIgnoreCase(buffer, '<svg'), 'svg');
  tryCandidate(indexOfIgnoreCase(buffer, '<html'), 'html');
  tryCandidate(indexOfIgnoreCase(buffer, '<style'), 'style');
  const divIdx = findDivStyleBlockStart(buffer);
  if (divIdx !== -1) {
    tryCandidate(divIdx, 'div');
  }

  return best;
}

/**
 * If `s` starts with `<div`, returns index after the matching closing `</div>` when depth hits zero.
 */
function findBalancedDivEnd(s: string): number | null {
  const lower = s.toLowerCase();
  if (!lower.startsWith('<div')) {
    return null;
  }
  const firstGt = findTagEnd(s, 0);
  if (firstGt === -1) {
    return null;
  }

  let depth = 1;
  let pos = firstGt + 1;

  while (pos < s.length && depth > 0) {
    const nextOpen = lower.indexOf('<div', pos);
    const nextClose = lower.indexOf('</div>', pos);

    if (nextClose === -1) {
      return null;
    }

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      pos = nextOpen + 4;
    } else {
      depth -= 1;
      pos = nextClose + 6;
    }
  }

  return depth === 0 ? pos : null;
}

export interface ParsedChunk {
  type: 'text' | 'visual_start' | 'visual_complete';
  content: string;
  title?: string;
  visualId?: string;
}

export type VisualStreamParserOptions = {
  /**
   * Whether this turn may contain visuals at all.
   *
   * Off, the parser is a pass-through: nothing is buffered and no markup is
   * captured. A turn that was never given the visual instructions has no
   * business having its `<svg>` code sample lifted out of the transcript and
   * rendered in a sandbox.
   */
  enabled?: boolean;
  /**
   * Whether bare `<svg>` / `<div style=…>` outside a `<visual>` wrapper is
   * captured as a visual. Recovers from models that drop the wrapper.
   */
  allowRawFallback?: boolean;
};

export class VisualStreamParser {
  private buffer = '';
  private inVisual = false;
  private visualBuffer = '';
  private visualTitle: string | undefined;
  private visualCounter = 0;
  private lastRequestId = '';

  private inRaw = false;
  private rawKind: RawKind | undefined;
  private rawBuffer = '';

  private readonly enabled: boolean;
  private readonly allowRawFallback: boolean;

  /** Inside a markdown code fence: markup here is a sample, not a visual. */
  private fenceOpen = false;
  /** Opening fences removed from around a `<visual>`, whose closer is still to come. */
  private pendingFenceCloses = 0;

  constructor({ enabled = true, allowRawFallback = true }: VisualStreamParserOptions = {}) {
    this.enabled = enabled;
    this.allowRawFallback = allowRawFallback;
  }

  private nextVisualId(requestId: string): string {
    return `visual-${requestId}-${this.visualCounter++}`;
  }

  private currentOpenVisualId(): string {
    return `visual-${this.lastRequestId}-${this.visualCounter - 1}`;
  }

  private rawCombined(): string {
    return this.rawBuffer + this.buffer;
  }

  /**
   * Drop the closer of a fence whose opener was removed for wrapping a visual.
   *
   * Without this the stray ``` survives into the transcript and opens a code
   * block that swallows the rest of the reply.
   */
  private consumeClosingFence() {
    if (this.pendingFenceCloses === 0) {
      return;
    }

    const match = this.buffer.match(/^[ \t]*\r?\n?[ \t]*```[A-Za-z0-9+#-]*[ \t]*(?:\r?\n|$)/);
    if (!match) {
      return;
    }

    this.buffer = this.buffer.slice(match[0].length);
    this.pendingFenceCloses -= 1;
  }

  private findRawEndPosition(combined: string): number | null {
    if (!this.rawKind) {
      return null;
    }
    if (this.rawKind === 'div') {
      return findBalancedDivEnd(combined);
    }
    const endTag = RAW_END[this.rawKind];
    const idx = indexOfIgnoreCase(combined, endTag);
    if (idx === -1) {
      return null;
    }
    return idx + endTag.length;
  }

  feed(chunk: string, requestId: string): ParsedChunk[] {
    this.lastRequestId = requestId;

    // A turn without the visual instructions cannot produce a visual, so
    // nothing in it is worth holding back a frame for.
    if (!this.enabled) {
      return chunk.length > 0 ? [{ type: 'text', content: chunk }] : [];
    }

    const results: ParsedChunk[] = [];
    this.buffer += chunk;
    this.buffer = this.buffer.replace(FENCE_WRAPPING_VISUAL, () => {
      this.pendingFenceCloses += 1;
      return '';
    });

    while (true) {
      if (this.inRaw && this.rawKind) {
        const combined = this.rawCombined();
        const endPos = this.findRawEndPosition(combined);

        if (endPos === null) {
          const safeLen = Math.max(0, combined.length - SAFETY_BUFFER);
          this.rawBuffer = combined.slice(0, safeLen);
          this.buffer = combined.slice(safeLen);
          break;
        }

        const captured = combined.slice(0, endPos).trim();
        const rest = combined.slice(endPos);
        this.rawBuffer = '';
        this.buffer = rest;
        this.inRaw = false;
        this.rawKind = undefined;

        results.push({
          type: 'visual_complete',
          content: captured,
          visualId: this.currentOpenVisualId(),
        });
        continue;
      }

      if (!this.inVisual) {
        // Inside a fenced code block nothing is a visual — walk to the closer
        // and emit everything between as plain text.
        if (this.fenceOpen) {
          const closeIdx = this.buffer.indexOf(FENCE);
          if (closeIdx === -1) {
            const safeLen = Math.max(
              0,
              this.buffer.length - getTrailingPartialTokenLength(this.buffer, [FENCE])
            );
            if (safeLen > 0) {
              results.push({ type: 'text', content: this.buffer.slice(0, safeLen) });
            }
            this.buffer = this.buffer.slice(safeLen);
            break;
          }

          results.push({ type: 'text', content: this.buffer.slice(0, closeIdx + FENCE.length) });
          this.buffer = this.buffer.slice(closeIdx + FENCE.length);
          this.fenceOpen = false;
          continue;
        }

        const visualIdx = this.buffer.indexOf(VISUAL_START);
        const raw = this.allowRawFallback ? findEarliestRawKind(this.buffer) : null;

        const useVisual = visualIdx !== -1 && (raw === null || visualIdx <= raw.index);
        const useRaw = raw !== null && !useVisual;

        // A fence that opens before the next candidate turns that candidate
        // into sample code. Unless the fence is the last thing in the buffer,
        // in which case the next chunk decides whether it wrapped a visual.
        const fenceIdx = this.buffer.indexOf(FENCE);
        const nextCandidate = useVisual ? visualIdx : useRaw && raw ? raw.index : Number.POSITIVE_INFINITY;
        if (fenceIdx !== -1 && fenceIdx < nextCandidate) {
          const trailingFenceLength = getTrailingFenceLength(this.buffer);
          const isTrailing =
            trailingFenceLength > 0 && fenceIdx >= this.buffer.length - trailingFenceLength;

          if (fenceIdx > 0) {
            results.push({ type: 'text', content: this.buffer.slice(0, fenceIdx) });
          }
          this.buffer = this.buffer.slice(fenceIdx);

          if (isTrailing) {
            break;
          }

          results.push({ type: 'text', content: this.buffer.slice(0, FENCE.length) });
          this.buffer = this.buffer.slice(FENCE.length);
          this.fenceOpen = true;
          continue;
        }

        if (!useVisual && !useRaw) {
          const safeLen = Math.max(0, this.buffer.length - getTrailingPartialTokenLength(this.buffer, POTENTIAL_START_TOKENS));
          const safeText = this.buffer.slice(0, safeLen);
          if (safeText) {
            results.push({ type: 'text', content: safeText });
          }
          this.buffer = this.buffer.slice(safeLen);
          break;
        }

        if (useVisual) {
          if (visualIdx > 0) {
            results.push({ type: 'text', content: this.buffer.slice(0, visualIdx) });
          }

          const openTagEnd = findTagEnd(this.buffer, visualIdx);
          if (openTagEnd === -1) {
            this.buffer = this.buffer.slice(visualIdx);
            break;
          }

          const openTag = this.buffer.slice(visualIdx, openTagEnd + 1);
          if (!/^<visual(?:\s|>)/i.test(openTag)) {
            results.push({ type: 'text', content: this.buffer.slice(0, visualIdx + 1) });
            this.buffer = this.buffer.slice(visualIdx + 1);
            continue;
          }

          const titleMatch = openTag.match(/\btitle\s*=\s*(["'])(.*?)\1/i);
          this.visualTitle = titleMatch?.[2];

          this.buffer = this.buffer.slice(openTagEnd + 1);
          this.inVisual = true;
          this.visualBuffer = '';

          const visualId = this.nextVisualId(requestId);
          results.push({
            type: 'visual_start',
            content: '',
            title: this.visualTitle,
            visualId,
          });
          continue;
        }

        if (useRaw && raw) {
          if (raw.index > 0) {
            results.push({ type: 'text', content: this.buffer.slice(0, raw.index) });
          }

          this.buffer = this.buffer.slice(raw.index);
          this.inRaw = true;
          this.rawKind = raw.kind;
          this.rawBuffer = '';

          this.nextVisualId(requestId);
          results.push({
            type: 'visual_start',
            content: '',
            visualId: this.currentOpenVisualId(),
          });
          continue;
        }
      } else {
        const endIdx = this.buffer.indexOf(VISUAL_END);
        if (endIdx === -1) {
          const safeLen = Math.max(0, this.buffer.length - getTrailingPartialTokenLength(this.buffer, [VISUAL_END]));
          this.visualBuffer += this.buffer.slice(0, safeLen);
          this.buffer = this.buffer.slice(safeLen);
          break;
        }

        this.visualBuffer += this.buffer.slice(0, endIdx);
        this.buffer = this.buffer.slice(endIdx + VISUAL_END.length);
        this.inVisual = false;
        this.consumeClosingFence();

        results.push({
          type: 'visual_complete',
          content: this.visualBuffer.trim(),
          title: this.visualTitle,
          visualId: this.currentOpenVisualId(),
        });

        this.visualBuffer = '';
        this.visualTitle = undefined;
      }
    }

    return results;
  }

  flush(requestId: string): ParsedChunk[] {
    this.lastRequestId = requestId;

    if (!this.enabled) {
      return [];
    }

    const results: ParsedChunk[] = [];

    if (this.inRaw && this.rawKind) {
      const merged = this.rawCombined().trim();
      this.rawBuffer = '';
      this.buffer = '';
      this.inRaw = false;
      this.rawKind = undefined;
      results.push({
        type: 'visual_complete',
        content: merged,
        visualId: this.currentOpenVisualId(),
      });
      return results;
    }

    if (this.inVisual) {
      results.push({
        type: 'visual_complete',
        content: `${this.visualBuffer}${this.buffer}`.trim(),
        title: this.visualTitle,
        visualId: this.currentOpenVisualId(),
      });
      this.visualBuffer = '';
      this.visualTitle = undefined;
      this.inVisual = false;
      this.buffer = '';
    }

    if (this.buffer) {
      results.push({ type: 'text', content: this.buffer });
    }

    this.buffer = '';
    return results;
  }

  reset() {
    this.buffer = '';
    this.inVisual = false;
    this.visualBuffer = '';
    this.visualTitle = undefined;
    this.visualCounter = 0;
    this.lastRequestId = '';
    this.inRaw = false;
    this.rawKind = undefined;
    this.rawBuffer = '';
    this.fenceOpen = false;
    this.pendingFenceCloses = 0;
  }
}
