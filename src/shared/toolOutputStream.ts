/**
 * Streamed tool-output lines with a derived head/tail cap.
 *
 * One model: full text lives in a per-call line store; the message tree keeps
 * `ChatToolPart.output` for persistence and raw mode, and the render path
 * holds a handle (`ToolStubPart.jobId` = `toolCallId`) into this store. The
 * cap is an O(H+T) derived view. Expand asks for a window, never the whole
 * log as one React prop.
 *
 * Grafts from the arena synthesis (`SYNTHESIS.md`):
 * - frozen head array identity once truncation engages (incremental patch)
 * - `finish` flushes the trailing partial then marks terminal status (job log)
 * - bounded `peek` for running calls (job log)
 */

export type JobStatus = 'running' | 'done' | 'error';

/**
 * What the render path keys the store by. Persistence still rides on
 * `ChatToolPart.output`; this is the handle that keeps stream cost off
 * repeated full-text rebuilds.
 */
export type ToolStubPart = {
  readonly kind: 'tool-stub';
  readonly jobId: string;
  readonly command: string;
};

export type CapView = {
  readonly head: readonly string[];
  readonly tail: readonly string[];
  readonly omitted: number;
  readonly totalLines: number;
  readonly truncated: boolean;
  readonly status: JobStatus;
  /** Bounded live peek (trailing partial or last line). Not a second copy of the log. */
  readonly peek: string | null;
};

export type WindowSpec = {
  readonly start: number;
  readonly end: number;
  readonly padTop: number;
  readonly padBottom: number;
};

export type AppendMetrics = {
  /** Complete lines written by this append. */
  readonly linesAdded: number;
  /** Store rows touched (chunk-local). */
  readonly linesTouched: number;
};

export type CapReadMetrics = {
  /** Rows copied into the cap view. Equals head.length + tail.length. */
  readonly linesRead: number;
};

export type LineStore = {
  append(chunk: string): AppendMetrics;
  /** Close the trailing partial and mark terminal status. */
  finish(status: Exclude<JobStatus, 'running'>): AppendMetrics;
  getLineCount(): number;
  getLine(index: number): string;
  getLines(start: number, end: number): readonly string[];
  getCapView(h: number, t: number): { view: CapView; metrics: CapReadMetrics };
  getWindow(
    rowHeight: number,
    viewportHeight: number,
    scrollTop: number,
    overscan?: number
  ): WindowSpec;
  subscribe(listener: () => void): () => void;
  getGeneration(): number;
  getStatus(): JobStatus;
};

export function createToolStubPart(jobId: string, command: string): ToolStubPart {
  return { kind: 'tool-stub', jobId, command };
}

/**
 * A bare `\r` rewinds the cursor rather than starting a new line. Collapse to
 * the last non-empty segment so progress bars stay one row (matches
 * `toolCellGrammar.splitLines`).
 */
function collapseCarriageReturns(line: string): string {
  if (!line.includes('\r')) return line;
  const segments = line.split('\r');
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index].length > 0) return segments[index];
  }
  return '';
}

function clipPeek(line: string, max = 80): string {
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

/**
 * Append-only line store. Streaming cost is O(chunk rows). Cap derivation is
 * O(H+T). Head array identity freezes once truncation starts so a memoized
 * head block never repaints during stream.
 */
export function createLineStore(): LineStore {
  const lines: string[] = [];
  let partial = '';
  let status: JobStatus = 'running';
  let generation = 0;
  const listeners = new Set<() => void>();

  let frozenHead: readonly string[] | null = null;
  let frozenHeadN = -1;

  const notify = (): void => {
    generation += 1;
    for (const l of listeners) l();
  };

  const rowCount = (): number => (partial ? lines.length + 1 : lines.length);

  const rowAt = (index: number): string => {
    if (index < lines.length) return lines[index]!;
    if (index === lines.length && partial) return collapseCarriageReturns(partial);
    return '';
  };

  const peekLine = (): string | null => {
    if (partial) return collapseCarriageReturns(partial);
    if (lines.length > 0) return lines[lines.length - 1]!;
    return null;
  };

  return {
    append(chunk: string): AppendMetrics {
      if (!chunk) return { linesAdded: 0, linesTouched: 0 };

      const buf = partial + chunk;
      partial = '';
      let linesAdded = 0;
      let linesTouched = 0;

      let start = 0;
      for (;;) {
        const nl = buf.indexOf('\n', start);
        if (nl === -1) break;
        let line = buf.slice(start, nl);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        lines.push(collapseCarriageReturns(line));
        linesAdded += 1;
        linesTouched += 1;
        start = nl + 1;
      }
      if (start < buf.length) {
        partial = buf.slice(start);
        linesTouched += 1;
      }
      notify();
      return { linesAdded, linesTouched };
    },

    finish(next: Exclude<JobStatus, 'running'>): AppendMetrics {
      let metrics: AppendMetrics = { linesAdded: 0, linesTouched: 0 };
      if (partial) {
        lines.push(collapseCarriageReturns(partial));
        partial = '';
        metrics = { linesAdded: 1, linesTouched: 1 };
      }
      status = next;
      notify();
      return metrics;
    },

    getLineCount(): number {
      return rowCount();
    },

    getLine(index: number): string {
      return rowAt(index);
    },

    getLines(start: number, end: number): readonly string[] {
      const s = Math.max(0, start);
      const e = Math.min(rowCount(), end);
      const out: string[] = [];
      for (let i = s; i < e; i++) out.push(rowAt(i));
      return out;
    },

    getCapView(h: number, t: number): { view: CapView; metrics: CapReadMetrics } {
      const total = rowCount();
      const headN = Math.max(0, h);
      const tailN = Math.max(0, t);
      const peek = peekLine();
      const clippedPeek = peek === null ? null : clipPeek(peek);

      if (total <= headN + tailN) {
        frozenHead = null;
        frozenHeadN = -1;
        const all: string[] = [];
        for (let i = 0; i < total; i++) all.push(rowAt(i));
        return {
          view: {
            head: all,
            tail: [],
            omitted: 0,
            totalLines: total,
            truncated: false,
            status,
            peek: clippedPeek,
          },
          metrics: { linesRead: total },
        };
      }

      if (!frozenHead || frozenHeadN !== headN) {
        const head: string[] = [];
        for (let i = 0; i < headN; i++) head.push(rowAt(i));
        frozenHead = head;
        frozenHeadN = headN;
      }

      const tail: string[] = [];
      const tailStart = total - tailN;
      for (let i = tailStart; i < total; i++) tail.push(rowAt(i));

      return {
        view: {
          head: frozenHead,
          tail,
          omitted: total - headN - tailN,
          totalLines: total,
          truncated: true,
          status,
          peek: clippedPeek,
        },
        metrics: { linesRead: headN + tailN },
      };
    },

    /**
     * Fixed-height row window. One calculator only. Plug TanStack by mapping
     * its virtual items onto `{start,end}` at the call site.
     */
    getWindow(rowHeight, viewportHeight, scrollTop, overscan = 3): WindowSpec {
      const total = rowCount();
      const rh = Math.max(1, rowHeight);
      const first = Math.floor(Math.max(0, scrollTop) / rh);
      const visible = Math.ceil(Math.max(0, viewportHeight) / rh);
      const start = Math.max(0, first - overscan);
      const end = Math.min(total, first + visible + overscan);
      return {
        start,
        end,
        padTop: start * rh,
        padBottom: Math.max(0, (total - end) * rh),
      };
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getGeneration(): number {
      return generation;
    },

    getStatus(): JobStatus {
      return status;
    },
  };
}

type RegistryEntry = {
  store: LineStore;
  /** Last ingested length. Suffix append is `text.slice(textLength)`. */
  textLength: number;
  /** Tail sample of the ingested text, used as a cheap prefix check. */
  tailSample: string;
};

const TAIL_SAMPLE_LEN = 64;
/** Cap cached stores so a long session cannot grow without bound. */
const MAX_REGISTRY_ENTRIES = 256;

const registry = new Map<string, RegistryEntry>();

function tailSampleOf(text: string): string {
  return text.length <= TAIL_SAMPLE_LEN ? text : text.slice(text.length - TAIL_SAMPLE_LEN);
}

/**
 * Keep one line store per tool call. When the new text extends what we already
 * hold, append only the suffix so stream flushes stay O(delta). The join is
 * checked against a fixed tail sample, not a full `startsWith` (that is O(n)
 * per flush and quadratic over a long stream). Rebuild when the text is not
 * an extension (rewrite / error swap).
 */
export function syncToolOutputLineStore(jobId: string, text: string): LineStore {
  const existing = registry.get(jobId);
  if (existing) {
    const boundary = existing.textLength;
    if (text.length === boundary && tailSampleOf(text) === existing.tailSample) {
      return existing.store;
    }
    if (text.length > boundary) {
      const join = text.slice(Math.max(0, boundary - existing.tailSample.length), boundary);
      if (join.endsWith(existing.tailSample) || existing.tailSample.endsWith(join)) {
        const suffix = text.slice(boundary);
        if (suffix) existing.store.append(suffix);
        existing.textLength = text.length;
        existing.tailSample = tailSampleOf(text);
        return existing.store;
      }
    }
  }

  const store = createLineStore();
  if (text) store.append(text);
  if (registry.size >= MAX_REGISTRY_ENTRIES) {
    const oldest = registry.keys().next();
    if (!oldest.done) registry.delete(oldest.value);
  }
  registry.set(jobId, {
    store,
    textLength: text.length,
    tailSample: tailSampleOf(text),
  });
  return store;
}

/** Flush partial and mark the call terminal. Safe to call more than once. */
export function finishToolOutputLineStore(
  jobId: string,
  status: Exclude<JobStatus, 'running'>
): LineStore | undefined {
  const entry = registry.get(jobId);
  if (!entry) return undefined;
  if (entry.store.getStatus() === 'running') {
    entry.store.finish(status);
  }
  return entry.store;
}

export function getToolOutputLineStore(jobId: string): LineStore | undefined {
  return registry.get(jobId)?.store;
}

/** Drop every cached store. Tests and conversation teardown. */
export function clearToolOutputLineStores(): void {
  registry.clear();
}
