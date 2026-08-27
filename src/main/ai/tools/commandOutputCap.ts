/**
 * Bounds how much child-process output the main process is willing to hold.
 *
 * A command like `find /`, `yes`, or `cat` on a large binary streams faster
 * than any timeout can save us: the naive `stdout += chunk` accumulator grows
 * to hundreds of megabytes inside the Electron main process long before
 * `timeoutMs` fires. The renderer's display truncation is irrelevant here,
 * because the full string is already resident by the time it is handed over.
 *
 * The bound follows the Codex live-output ingest cap and has three layers:
 *
 *   1. A byte budget. Everything is retained verbatim until the budget is
 *      exceeded, so the common case is byte-for-byte unchanged.
 *   2. Head + tail line retention once over budget: the first N and last N
 *      completed lines survive, the middle is replaced by a counted marker.
 *   3. Per-line head + tail. Each retained line keeps only a prefix and a
 *      suffix. This is the layer that actually makes the buffer unbounded-safe:
 *      without it, output that never emits a newline is a single line and
 *      layers 1 and 2 retain all of it.
 */

/** Codex uses 1 MiB; the same budget comfortably holds any realistic build log. */
export const COMMAND_OUTPUT_BYTE_BUDGET = 1024 * 1024;

/** Completed lines kept from the start of the stream once over budget. */
export const COMMAND_OUTPUT_HEAD_LINES = 50;

/** Completed lines kept from the end of the stream once over budget. */
export const COMMAND_OUTPUT_TAIL_LINES = 50;

/** Characters kept from the start of each retained line. */
export const COMMAND_OUTPUT_LINE_HEAD_CHARS = 2_000;

/** Characters kept from the end of each retained line. */
export const COMMAND_OUTPUT_LINE_TAIL_CHARS = 2_000;

function formatByteBudget(bytes: number) {
  if (bytes > 0 && bytes % (1024 * 1024) === 0) {
    return `${bytes / (1024 * 1024)} MiB`;
  }

  if (bytes > 0 && bytes % 1024 === 0) {
    return `${bytes / 1024} KiB`;
  }

  return `${bytes} bytes`;
}

/**
 * JavaScript strings are UTF-16, so an astral character (emoji, some CJK
 * extensions) occupies two code units. Slicing between them would leave lone
 * surrogates that encode as U+FFFD once the string is written out, so every cut
 * is nudged back onto a code-point boundary.
 */
function safeCutIndex(value: string, index: number) {
  if (index <= 0) {
    return 0;
  }

  if (index >= value.length) {
    return value.length;
  }

  const current = value.charCodeAt(index);

  if (current >= 0xdc00 && current <= 0xdfff) {
    const previous = value.charCodeAt(index - 1);

    if (previous >= 0xd800 && previous <= 0xdbff) {
      return index - 1;
    }
  }

  return index;
}

export class BoundedCommandOutput {
  private readonly byteBudget: number;

  /**
   * Optional overflow tee, invoked with the FULL stream from the moment the
   * byte budget is crossed: first with the entire buffered prefix at the
   * crossing, then with every subsequent chunk. It fires only on overflow, so
   * a caller can use it to persist the complete output lazily (see
   * `SpillingCommandOutput`) without touching the bounded in-memory path.
   */
  private readonly tee: ((text: string) => void) | undefined;

  /** Verbatim chunks, kept only while the stream is still under budget. */
  private buffered: string[] | null = [];
  private bufferedBytes = 0;

  private readonly headLines: string[] = [];
  private readonly tailRing: string[] = new Array<string>(COMMAND_OUTPUT_TAIL_LINES);
  private tailStart = 0;
  private tailCount = 0;
  private omittedLines = 0;
  private droppedWithinLine = false;

  private pendingHead = '';
  private pendingTail = '';
  private pendingOmitted = 0;

  constructor(byteBudget: number = COMMAND_OUTPUT_BYTE_BUDGET, tee?: (text: string) => void) {
    this.byteBudget = Math.max(0, byteBudget);
    this.tee = tee;
  }

  get truncated() {
    return this.omittedLines > 0 || this.droppedWithinLine;
  }

  /**
   * Per-chunk cost is O(chunk), never O(accumulated): under budget the chunk is
   * pushed onto an array, over budget it is scanned once for newlines while the
   * retained head/tail buffers stay at their fixed caps. The single O(n) pass
   * happens exactly once, when the budget is first crossed.
   */
  write(text: string) {
    if (!text) {
      return;
    }

    if (this.buffered) {
      this.buffered.push(text);
      this.bufferedBytes += Buffer.byteLength(text);

      if (this.bufferedBytes <= this.byteBudget) {
        return;
      }

      const buffered = this.buffered.join('');
      this.buffered = null;
      this.ingest(buffered);
      return;
    }

    this.ingest(text);
  }

  toString() {
    if (this.buffered) {
      return this.buffered.join('');
    }

    const parts = [...this.headLines];

    if (this.omittedLines > 0) {
      parts.push(
        `… +${this.omittedLines} lines omitted (output exceeded ${formatByteBudget(this.byteBudget)})`
      );
    }

    for (let index = 0; index < this.tailCount; index += 1) {
      parts.push(this.tailRing[(this.tailStart + index) % COMMAND_OUTPUT_TAIL_LINES]);
    }

    // The in-progress line is always emitted, so a stream that ended with a
    // newline still reconstructs its trailing newline via the join.
    parts.push(this.pendingLineText());

    return parts.join('\n');
  }

  /**
   * The last `count` complete lines, oldest first — a UI preview without
   * rebuilding the whole bounded log. Falls back to the in-progress line when
   * nothing has committed yet, so a slow-starting stream still previews.
   */
  tailLines(count: number): string[] {
    if (count <= 0) {
      return [];
    }

    if (this.buffered) {
      // Under budget the verbatim chunks are authoritative; split off the
      // same committed-line view the over-budget path maintains. The final
      // element after a trailing newline is empty, not content.
      const joined = this.buffered.join('');
      const lines = joined.split('\n');
      if (lines.at(-1) === '') lines.pop();
      return lines.slice(-count);
    }

    const start = Math.max(0, this.tailCount - count);
    const lines: string[] = [];
    for (let index = start; index < this.tailCount; index += 1) {
      lines.push(this.tailRing[(this.tailStart + index) % COMMAND_OUTPUT_TAIL_LINES]);
    }
    return lines;
  }

  private ingest(text: string) {
    // Every chunk that reaches `ingest` is post-overflow (the first call
    // carries the entire buffered prefix), so teeing here captures the full
    // stream without touching the under-budget fast path.
    this.tee?.(text);

    let start = 0;

    for (;;) {
      const newline = text.indexOf('\n', start);

      if (newline === -1) {
        this.appendToPendingLine(text.slice(start));
        return;
      }

      this.appendToPendingLine(text.slice(start, newline));
      this.commitLine();
      start = newline + 1;
    }
  }

  private appendToPendingLine(segment: string) {
    if (!segment) {
      return;
    }

    let rest = segment;

    if (this.pendingHead.length < COMMAND_OUTPUT_LINE_HEAD_CHARS) {
      const room = COMMAND_OUTPUT_LINE_HEAD_CHARS - this.pendingHead.length;

      if (rest.length <= room) {
        this.pendingHead += rest;
        return;
      }

      const cut = safeCutIndex(rest, room);
      this.pendingHead += rest.slice(0, cut);
      rest = rest.slice(cut);

      if (!rest) {
        return;
      }
    }

    // The tail is a rolling window: it briefly grows by one chunk, then is
    // trimmed back to the cap, so the line buffer never tracks the line length.
    this.pendingTail += rest;

    if (this.pendingTail.length > COMMAND_OUTPUT_LINE_TAIL_CHARS) {
      const cut = safeCutIndex(
        this.pendingTail,
        this.pendingTail.length - COMMAND_OUTPUT_LINE_TAIL_CHARS
      );

      if (cut > 0) {
        this.pendingOmitted += cut;
        this.pendingTail = this.pendingTail.slice(cut);
        this.droppedWithinLine = true;
      }
    }
  }

  private pendingLineText() {
    if (this.pendingOmitted === 0) {
      return this.pendingHead + this.pendingTail;
    }

    return `${this.pendingHead}…[${this.pendingOmitted} characters omitted mid-line]…${this.pendingTail}`;
  }

  private commitLine() {
    const line = this.pendingLineText();
    this.pendingHead = '';
    this.pendingTail = '';
    this.pendingOmitted = 0;

    if (this.headLines.length < COMMAND_OUTPUT_HEAD_LINES) {
      this.headLines.push(line);
      return;
    }

    if (this.tailCount < COMMAND_OUTPUT_TAIL_LINES) {
      this.tailRing[(this.tailStart + this.tailCount) % COMMAND_OUTPUT_TAIL_LINES] = line;
      this.tailCount += 1;
      return;
    }

    this.tailRing[this.tailStart] = line;
    this.tailStart = (this.tailStart + 1) % COMMAND_OUTPUT_TAIL_LINES;
    this.omittedLines += 1;
  }
}
