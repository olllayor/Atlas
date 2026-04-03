const VISUAL_START = '<visual';
const VISUAL_END = '</visual>';
const POTENTIAL_START_TOKENS = [VISUAL_START, '<svg', '<html', '<style', '<div style'];

/** Holds possible split of `</visual>` and long opening tags (e.g. `<div ... style=`). */
export const SAFETY_BUFFER = 32;

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

  private nextVisualId(requestId: string): string {
    return `visual-${requestId}-${this.visualCounter++}`;
  }

  private currentOpenVisualId(): string {
    return `visual-${this.lastRequestId}-${this.visualCounter - 1}`;
  }

  private rawCombined(): string {
    return this.rawBuffer + this.buffer;
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
    const results: ParsedChunk[] = [];
    this.lastRequestId = requestId;
    this.buffer += chunk;

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
        const visualIdx = this.buffer.indexOf(VISUAL_START);
        const raw = findEarliestRawKind(this.buffer);

        const useVisual = visualIdx !== -1 && (raw === null || visualIdx <= raw.index);
        const useRaw = raw !== null && !useVisual;

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
  }
}
