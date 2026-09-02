/**
 * Codex transcript cell grammar.
 *
 * Pure functions that turn `ChatToolPart`s into the shape the transcript
 * renders. The **app** (not the CLI TUI) renders each activity phase as a
 * single dim summary row — `Ran npm test`, `Explored 3 files`,
 * `Searched the web for X` — with details revealed on click. That row text
 * is the `label` field. See `docs/codex-parity/reference-visual-spec.md` §5.
 *
 * `verb`/`subject` are retained alongside `label` because the workbench
 * still composes its own rows from them.
 *
 * Kept in `shared/` and free of React so it can be unit-tested directly.
 */

import type { CanonicalToolType, ChatToolPart, ChatToolState } from './contracts';
import { describeMcpToolName } from './mcp';
import { isPlanToolPart } from './planTool';

/** Head/tail line budget for an agent tool call's output block. */
export const TOOL_OUTPUT_MAX_LINES = 5;
/** Line budget for the command continuation block. */
export const COMMAND_CONTINUATION_MAX_LINES = 2;

export type ToolCellStatus = 'pending' | 'running' | 'success' | 'failed' | 'awaiting-approval';

export type ToolCellKind =
  | 'command'
  | 'explore'
  | 'edit'
  | 'web'
  | 'mcp'
  | 'image'
  | 'generic';

/**
 * A single tool call reduced to its display grammar.
 *
 * `label` is the entire visible text of the transcript's collapsed
 * activity row (`Ran npm test`, `Explored 3 files`). `verb`/`subject`
 * survive as the decomposed form the workbench renders from.
 */
export type ToolCell = {
  id: string;
  kind: ToolCellKind;
  status: ToolCellStatus;
  /** Collapsed activity-row text — dim, no bold segments, no glyph. */
  label: string;
  verb: string;
  subject: string;
  /** Rendered as syntax-highlighted code when the cell is a command. */
  subjectIsCode: boolean;
  /** Extra command lines, shown under a `│` gutter. */
  continuation: string[];
  /** How many continuation lines were dropped. */
  continuationOmitted: number;
  /** Every extra command line, so the `… +N lines` marker can expand. */
  continuationAll: string[];
  detail: ToolDetail;
  durationMs: number | null;
  /** The parts this cell was built from — `Explored` merges several. */
  parts: ChatToolPart[];
};

export type ToolDetail =
  | { type: 'none' }
  | {
      type: 'text';
      /** Head + tail slice, ready to render collapsed. */
      lines: string[];
      /**
       * The untruncated output. The `… +N lines` marker is a button, and
       * without the full text there is nothing for it to reveal — the
       * output would be permanently unreachable.
       */
      allLines: string[];
      /** How many of `lines` came from the head (never a `length / 2` guess). */
      head: number;
      /** How many of `lines` came from the tail. */
      tail: number;
      omitted: number;
      empty: boolean;
    }
  | { type: 'diff'; files: DiffFile[]; added: number; removed: number }
  | { type: 'explore'; entries: ExploreEntry[] }
  | { type: 'error'; text: string }
  | { type: 'approval'; reason: string | null; command: string | null };

export type ExploreEntry = {
  /** `Read` | `List` | `Search` | `Run` */
  label: string;
  /** For `Read`, several calls coalesce into one comma-joined line. */
  values: string[];
  /** `Search foo in src/` — the ` in ` separator renders dim. */
  scope?: string;
};

export type DiffFile = {
  path: string;
  /** Present when the change was a rename: `old → new`. */
  previousPath?: string;
  added: number;
  removed: number;
  hunks: DiffHunk[];
};

export type DiffHunk = {
  /** True when this hunk is not adjacent to the previous one (renders `⋮`). */
  gapBefore: boolean;
  lines: DiffLine[];
};

export type DiffLine = {
  sign: '+' | '-' | ' ';
  /** Old number on deletes, new number on inserts, shared on context. */
  lineNumber: number | null;
  content: string;
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export function toolCellKind(part: ChatToolPart): ToolCellKind {
  const name = (part.toolName ?? '').toLowerCase();

  // A read/list/grep/glob call is an "explore" even though the canonical
  // type calls the search family `web_search`; distinguish by tool name.
  if (/^(read_file|glob_search|grep_search|list_files|site_read_file)$/.test(name)) {
    return 'explore';
  }

  switch (part.toolType as CanonicalToolType | undefined | null) {
    case 'command_execution':
      return 'command';
    case 'file_change':
      return 'edit';
    case 'web_search':
      return name.includes('grep') || name.includes('glob') ? 'explore' : 'web';
    case 'mcp_tool_call':
      return 'mcp';
    case 'image_view':
      return 'image';
    default:
      break;
  }

  if (name === 'bash' || name.includes('shell') || name.includes('command')) return 'command';
  if (name.includes('write') || name.includes('edit') || name.includes('patch')) return 'edit';
  if (name.includes('fetch') || name.includes('web')) return 'web';
  if (name.includes('search')) return 'explore';
  return 'generic';
}

export function toolCellStatus(state: ChatToolState): ToolCellStatus {
  switch (state) {
    case 'input-streaming':
      return 'pending';
    case 'input-available':
    case 'output-partial':
      return 'running';
    case 'approval-requested':
      return 'awaiting-approval';
    case 'approval-responded':
      return 'running';
    case 'output-available':
      return 'success';
    case 'output-error':
    case 'output-denied':
      return 'failed';
    default:
      return 'pending';
  }
}

const isFinished = (status: ToolCellStatus) => status === 'success' || status === 'failed';

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

/** `src/renderer/App.tsx` → `App.tsx` for compact subjects. */
export function basename(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, '');
  const index = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  return index === -1 ? cleaned : cleaned.slice(index + 1);
}

/** Codex strips `bash -lc` wrappers before displaying a command. */
export function stripShellWrapper(command: string): string {
  const match = command.match(/^\s*(?:bash|sh|zsh)\s+-l?c\s+(.*)$/s);
  if (!match) return command.trim();

  const rest = match[1].trim();
  const quote = rest[0];
  if ((quote === '"' || quote === "'") && rest.endsWith(quote) && rest.length > 1) {
    return rest.slice(1, -1).trim();
  }
  return rest;
}

function toolText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Output truncation — head/tail, never head-only
// ---------------------------------------------------------------------------

/**
 * Take up to `limit` lines from the head and `limit` from the tail,
 * reporting how many were dropped in between. Matches the TUI's
 * `output_lines()`; head-only truncation would hide the failure at the
 * end of a long log, which is exactly what a reader needs.
 */
export function truncateHeadTail(
  lines: string[],
  limit: number = TOOL_OUTPUT_MAX_LINES
): { lines: string[]; omitted: number } {
  if (lines.length <= limit * 2) {
    return { lines, omitted: 0 };
  }
  return {
    lines: [...lines.slice(0, limit), ...lines.slice(lines.length - limit)],
    omitted: lines.length - limit * 2,
  };
}

/**
 * A bare `\r` rewinds the cursor to column 0 rather than starting a new
 * line, so a progress bar that redraws itself 400 times is one line of
 * output. Treating `\r` as a newline (the previous behaviour) turned every
 * spinner and download bar into hundreds of near-identical transcript rows
 * and blew the head/tail budget on noise.
 */
function collapseCarriageReturns(line: string): string {
  if (!line.includes('\r')) return line;
  const segments = line.split('\r');
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index].length > 0) return segments[index];
  }
  return '';
}

function splitLines(value: string): string[] {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map(collapseCarriageReturns);
}

// ---------------------------------------------------------------------------
// Unified diff parsing
// ---------------------------------------------------------------------------

const HUNK_HEADER = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

/**
 * Parse a unified diff into per-file hunks.
 *
 * Tolerant by design: tool output is not guaranteed to be a well-formed
 * patch, so anything unparseable yields `null` and the caller falls back
 * to plain text rather than rendering a broken diff.
 */
export function parseUnifiedDiff(raw: string): DiffFile[] | null {
  if (!raw.includes('@@')) return null;

  const lines = splitLines(raw);
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let previousHunkEnd: number | null = null;

  const closeHunk = () => {
    if (current && hunk && hunk.lines.length) current.hunks.push(hunk);
    hunk = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ') || line.startsWith('--- ')) {
      if (line.startsWith('--- ')) {
        closeHunk();
        const previous = line.slice(4).trim().replace(/^a\//, '');
        current = { path: previous, added: 0, removed: 0, hunks: [] };
        files.push(current);
        previousHunkEnd = null;
      }
      continue;
    }

    if (line.startsWith('+++ ')) {
      const next = line.slice(4).trim().replace(/^b\//, '');
      if (current) {
        if (next !== current.path && next !== '/dev/null' && current.path !== '/dev/null') {
          current.previousPath = current.path;
        }
        current.path = next;
      }
      continue;
    }

    const header = line.match(HUNK_HEADER);
    if (header) {
      closeHunk();
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      if (!current) {
        current = { path: '', added: 0, removed: 0, hunks: [] };
        files.push(current);
      }
      hunk = { gapBefore: previousHunkEnd != null && newLine > previousHunkEnd + 1, lines: [] };
      continue;
    }

    if (!hunk || !current) continue;

    if (line.startsWith('+')) {
      hunk.lines.push({ sign: '+', lineNumber: newLine, content: line.slice(1) });
      current.added += 1;
      newLine += 1;
    } else if (line.startsWith('-')) {
      hunk.lines.push({ sign: '-', lineNumber: oldLine, content: line.slice(1) });
      current.removed += 1;
      oldLine += 1;
    } else if (line.startsWith(' ') || line === '') {
      hunk.lines.push({ sign: ' ', lineNumber: newLine, content: line.slice(1) });
      oldLine += 1;
      newLine += 1;
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — carries no line of its own.
      continue;
    } else {
      closeHunk();
      continue;
    }
    previousHunkEnd = newLine;
  }

  closeHunk();

  const usable = files.filter((file) => file.hunks.length > 0);
  if (!usable.length) return null;

  // Codex sorts files by path.
  usable.sort((a, b) => a.path.localeCompare(b.path));
  return usable;
}

// ---------------------------------------------------------------------------
// Per-kind cell construction
// ---------------------------------------------------------------------------

function commandOf(part: ChatToolPart): string | null {
  const input = asRecord(part.input);
  const raw = readString(input, 'command', 'cmd', 'script', 'shellCommand');
  return raw ? stripShellWrapper(raw) : null;
}

function pathOf(part: ChatToolPart): string | null {
  const input = asRecord(part.input);
  return readString(input, 'path', 'filePath', 'file', 'relativePath', 'target');
}

function queryOf(part: ChatToolPart): string | null {
  const input = asRecord(part.input);
  return readString(input, 'query', 'q', 'pattern', 'search', 'url');
}

function outputText(part: ChatToolPart): string {
  if (part.state === 'output-error') return part.errorText ?? '';
  return toolText(part.output);
}

function buildTextDetail(part: ChatToolPart): ToolDetail {
  const text = outputText(part).trim();
  if (!text) {
    // `(no output)` is a *result*, so it may only be claimed once the call
    // has finished. While a call is still in flight, having produced
    // nothing yet is not the same as having produced nothing.
    if (!isFinished(toolCellStatus(part.state))) {
      return { type: 'none' };
    }
    // Codex renders a literal, dim `(no output)` rather than nothing —
    // "the command produced nothing" and "we lost the output" must not
    // look the same.
    return { type: 'text', lines: [], allLines: [], head: 0, tail: 0, omitted: 0, empty: true };
  }

  // Fast count of lines without splitting the entire string into an array.
  let end = text.length;
  while (end > 0 && (text.charCodeAt(end - 1) === 10 || text.charCodeAt(end - 1) === 13)) {
    end--;
  }
  if (end === 0) {
    return { type: 'text', lines: [], allLines: [], head: 0, tail: 0, omitted: 0, empty: true };
  }

  let lineCount = 1;
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      lineCount++;
    }
  }

  // Small outputs: split eagerly, no head/tail omission.
  if (lineCount <= TOOL_OUTPUT_MAX_LINES * 2) {
    const allLines = splitLines(text);
    return {
      type: 'text',
      lines: allLines,
      allLines,
      head: allLines.length,
      tail: 0,
      omitted: 0,
      empty: false,
    };
  }

  // Large outputs: extract only the first and last `TOOL_OUTPUT_MAX_LINES` lines.
  // This avoids allocating thousands of short-lived string slices on every stream flush.
  let headEnd = 0;
  let headSeen = 0;
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      headSeen++;
      if (headSeen === TOOL_OUTPUT_MAX_LINES) {
        headEnd = i;
        break;
      }
    }
  }
  const headSlice = text.slice(0, headEnd - (headEnd > 0 && text.charCodeAt(headEnd - 1) === 13 ? 1 : 0));
  const head = splitLines(headSlice);

  let tailStart = 0;
  let tailSeen = 0;
  for (let i = end - 1; i >= 0; i--) {
    if (text.charCodeAt(i) === 10) {
      tailSeen++;
      if (tailSeen === TOOL_OUTPUT_MAX_LINES) {
        tailStart = i + 1;
        break;
      }
    }
  }
  const tail = splitLines(text.slice(tailStart, end));
  const lines = [...head, ...tail];
  const omitted = lineCount - TOOL_OUTPUT_MAX_LINES * 2;

  let cachedAllLines: string[] | null = null;
  return {
    type: 'text',
    lines,
    get allLines(): string[] {
      if (!cachedAllLines) {
        cachedAllLines = splitLines(text);
      }
      return cachedAllLines;
    },
    head: TOOL_OUTPUT_MAX_LINES,
    tail: TOOL_OUTPUT_MAX_LINES,
    omitted,
    empty: false,
  };
}

function exploreEntryFor(part: ChatToolPart): ExploreEntry {
  const name = (part.toolName ?? '').toLowerCase();
  const path = pathOf(part);
  const query = queryOf(part);

  if (name.includes('glob') || name.includes('list')) {
    return { label: 'List', values: [path ?? query ?? part.toolName] };
  }
  if (name.includes('grep') || name.includes('search')) {
    return { label: 'Search', values: [query ?? part.toolName], scope: path ?? undefined };
  }
  if (name.includes('read')) {
    return { label: 'Read', values: [path ? basename(path) : part.toolName] };
  }
  return { label: 'Run', values: [query ?? path ?? part.toolName] };
}

function durationOf(parts: ChatToolPart[]): number | null {
  let start: number | null = null;
  let end: number | null = null;
  for (const part of parts) {
    const partStart = part.startedAt ? Date.parse(part.startedAt) : NaN;
    const partEnd = part.completedAt ? Date.parse(part.completedAt) : NaN;
    if (!Number.isNaN(partStart)) start = start == null ? partStart : Math.min(start, partStart);
    if (!Number.isNaN(partEnd)) end = end == null ? partEnd : Math.max(end, partEnd);
  }
  if (start == null || end == null || end < start) return null;
  return end - start;
}

/** `0s` · `59s` · `1m 00s` · `1h 01m 01s` — the TUI's compact format. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

function buildSingleCell(part: ChatToolPart): ToolCell {
  const kind = toolCellKind(part);
  const status = toolCellStatus(part.state);
  const finished = isFinished(status);

  const base = {
    id: part.id || part.toolCallId,
    kind,
    status,
    subjectIsCode: false,
    continuation: [] as string[],
    continuationOmitted: 0,
    continuationAll: [] as string[],
    durationMs: durationOf([part]),
    parts: [part],
  };

  if (status === 'awaiting-approval') {
    const verb = kind === 'edit' ? 'Approve edits to' : 'Approve';
    const subject = commandOf(part) ?? pathOf(part) ?? part.title ?? part.toolName;
    return {
      ...base,
      label: `${verb} ${subject}`.trim(),
      verb,
      subject,
      subjectIsCode: kind === 'command',
      detail: {
        type: 'approval',
        reason: part.approval?.reason ?? null,
        command: commandOf(part),
      },
    };
  }

  if (kind === 'command') {
    const command = commandOf(part) ?? part.title ?? part.toolName;
    const commandLines = splitLines(command);
    const [head, ...rest] = commandLines;
    const continuation = rest.slice(0, COMMAND_CONTINUATION_MAX_LINES);

    return {
      ...base,
      label: `${finished ? 'Ran' : 'Running'} ${head ?? ''}`.trim(),
      verb: finished ? 'Ran' : 'Running',
      subject: head ?? '',
      subjectIsCode: true,
      continuation,
      continuationOmitted: Math.max(0, rest.length - continuation.length),
      continuationAll: rest,
      detail:
        part.state === 'output-error'
          ? { type: 'error', text: part.errorText ?? 'Command failed' }
          : buildTextDetail(part),
    };
  }

  if (kind === 'edit') {
    const path = pathOf(part);
    const diff = parseUnifiedDiff(outputText(part));

    if (diff) {
      const added = diff.reduce((sum, file) => sum + file.added, 0);
      const removed = diff.reduce((sum, file) => sum + file.removed, 0);
      const single = diff.length === 1 ? diff[0] : null;
      return {
        ...base,
        label: single ? `Edited ${basename(single.path)}` : `Edited ${diff.length} files`,
        verb: diff.length > 1 ? `Edited ${diff.length} files` : 'Edited',
        subject: single
          ? single.previousPath
            ? `${single.previousPath} → ${single.path}`
            : single.path
          : '',
        detail: { type: 'diff', files: diff, added, removed },
      };
    }

    const editTarget = path ?? part.title ?? part.toolName;
    return {
      ...base,
      label: `${finished ? 'Edited' : 'Editing'} ${path ? basename(path) : editTarget}`,
      verb: 'Edited',
      subject: editTarget,
      detail:
        part.state === 'output-error'
          ? { type: 'error', text: part.errorText ?? 'Edit failed' }
          : buildTextDetail(part),
    };
  }

  if (kind === 'web') {
    const query = queryOf(part);
    return {
      ...base,
      label: finished ? `Searched the web for ${query ?? ''}`.trim() : 'Searching the web',
      verb: finished ? 'Searched the web for' : 'Searching the web',
      subject: finished ? (query ?? '') : '',
      detail:
        part.state === 'output-error'
          ? { type: 'error', text: part.errorText ?? 'Search failed' }
          : buildTextDetail(part),
    };
  }

  if (kind === 'mcp') {
    const input = asRecord(part.input);
    let args = '';
    try {
      args = Object.keys(input).length ? JSON.stringify(input) : '';
    } catch {
      args = '';
    }
    // `github.search_issues`, not `mcp__github_github__search_issues`. The wire
    // name is an implementation detail; what a reader needs is which plugin
    // acted and what it did. Falls back to the raw name when the namespacing
    // cannot be read back — a confident half-answer would be worse.
    const display = describeMcpToolName(part.toolName);
    const shown = display?.label ?? part.toolName;

    return {
      ...base,
      label: `${finished ? 'Called' : 'Calling'} ${shown}`,
      verb: finished ? 'Called' : 'Calling',
      subject: `${shown}(${args})`,
      subjectIsCode: true,
      detail:
        part.state === 'output-error'
          ? { type: 'error', text: part.errorText ?? 'Tool call failed' }
          : buildTextDetail(part),
    };
  }

  if (kind === 'image') {
    const imagePath = pathOf(part);
    return {
      ...base,
      label: `Viewed ${imagePath ? basename(imagePath) : 'image'}`,
      verb: 'Viewed Image',
      subject: imagePath ?? '',
      detail: buildTextDetail(part),
    };
  }

  const genericSubject = part.title?.trim() || part.toolName;
  return {
    ...base,
    label: `${finished ? 'Called' : 'Calling'} ${genericSubject}`,
    verb: finished ? 'Called' : 'Calling',
    subject: genericSubject,
    detail:
      part.state === 'output-error'
        ? { type: 'error', text: part.errorText ?? 'Tool call failed' }
        : buildTextDetail(part),
  };
}

/**
 * Merge a run of read-only calls into a single `Explored` cell, collapsing
 * consecutive `Read`s onto one deduplicated line.
 *
 * This is the highest-leverage rule in the grammar: a turn that reads six
 * files renders as one line here and as six cards without it.
 */
function buildExploreCell(parts: ChatToolPart[]): ToolCell {
  const entries: ExploreEntry[] = [];

  for (const part of parts) {
    const entry = exploreEntryFor(part);
    const previous = entries[entries.length - 1];

    // Only `Read` coalesces, and only with an immediately preceding Read.
    if (previous && previous.label === 'Read' && entry.label === 'Read') {
      for (const value of entry.values) {
        if (!previous.values.includes(value)) previous.values.push(value);
      }
      continue;
    }
    entries.push(entry);
  }

  const anyRunning = parts.some((part) => !isFinished(toolCellStatus(part.state)));
  const anyFailed = parts.some((part) => toolCellStatus(part.state) === 'failed');

  // The row label counts distinct files touched (reads and lists) —
  // `Explored 3 files` — matching the app's collapsed summary. Searches
  // still appear in the expanded entry list but are not "files".
  const fileValues = new Set<string>();
  for (const entry of entries) {
    if (entry.label === 'Read' || entry.label === 'List') {
      for (const value of entry.values) fileValues.add(value);
    }
  }
  const fileCount = fileValues.size;
  const label = anyRunning
    ? 'Exploring files'
    : fileCount > 0
      ? `Explored ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`
      : 'Explored';

  return {
    id: parts[0].id || parts[0].toolCallId,
    kind: 'explore',
    status: anyFailed ? 'failed' : anyRunning ? 'running' : 'success',
    label,
    verb: anyRunning ? 'Exploring' : 'Explored',
    subject: '',
    subjectIsCode: false,
    continuation: [],
    continuationOmitted: 0,
    continuationAll: [],
    detail: { type: 'explore', entries },
    durationMs: durationOf(parts),
    parts,
  };
}

/**
 * Reduce an ordered list of tool parts into transcript cells.
 *
 * Consecutive explore-kind calls collapse into one `Explored` cell; every
 * other call gets its own. A call awaiting approval never coalesces —
 * it needs its own decision surface.
 */
export function buildToolCells(parts: ChatToolPart[]): ToolCell[] {
  const cells: ToolCell[] = [];
  let pendingExplore: ChatToolPart[] = [];

  const flush = () => {
    if (!pendingExplore.length) return;
    cells.push(buildExploreCell(pendingExplore));
    pendingExplore = [];
  };

  for (const part of parts) {
    // The plan renders as its own checklist cell, and this function is called
    // with unfiltered part lists (the row-height estimator, the workbench), so
    // the exclusion belongs here rather than only at the transcript's grouping
    // step — otherwise a stray `Called update_plan` row appears beside it.
    if (isPlanToolPart(part)) {
      continue;
    }

    const coalescable =
      toolCellKind(part) === 'explore' && toolCellStatus(part.state) !== 'awaiting-approval';

    if (coalescable) {
      pendingExplore.push(part);
      continue;
    }

    flush();
    cells.push(buildSingleCell(part));
  }

  flush();
  return cells;
}

// ---------------------------------------------------------------------------
// Plain-text rendering (raw mode)
// ---------------------------------------------------------------------------

/**
 * The third rendering of the cell model.
 *
 * A `ToolCell` already has exactly one content model with two renderings —
 * the collapsed summary row and the expanded detail. Raw mode is the third,
 * and it belongs here rather than in each component for the same reason the
 * other two do: the moment a component hand-rolls its own plain text, the
 * raw view and the rendered view start telling different stories about the
 * same call.
 *
 * The contract for every function below: the return value is what a reader
 * would get by selecting the cell and hitting copy. That rules out anything
 * that only exists as decoration — no `⋮` gap glyphs, no U+2212 minus (a
 * copied patch has to survive `git apply`), no `›` chevrons, no box drawing.
 */

/** Diff lines to include per file before raw mode elides the rest. */
export const RAW_DIFF_MAX_LINES = 400;

/**
 * CSI/OSC sequences and stray control characters.
 *
 * Program output reaches the renderer as a raw string. The rich terminal block
 * maps the SGR subset onto theme colours and strips the rest at render time, so
 * the escape codes never live in the cell model — which means the plain-text
 * path has to strip them itself or a raw transcript prints `[32m✔[0m`.
 * "Raw" means the characters the program produced, not the bytes it wrote to a
 * TTY it thought it had.
 */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN =
  /\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[\u0000-\u0008\u000B-\u001F\u007F]/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

/**
 * Render one file's hunks as a real unified patch body.
 *
 * ASCII `+`/`-`, not the display minus, and `@@ …` in place of the `⋮` the
 * table draws — the point of the raw view is that the text is the artifact.
 */
export function diffFileToPlainText(file: DiffFile, maxLines: number = RAW_DIFF_MAX_LINES): string {
  const lines: string[] = [];
  const header = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
  lines.push(`--- ${header} (+${file.added} -${file.removed})`);

  let emitted = 0;
  let elided = 0;

  for (const hunk of file.hunks) {
    if (hunk.gapBefore) {
      if (emitted < maxLines) lines.push('@@');
    }
    for (const line of hunk.lines) {
      if (emitted >= maxLines) {
        elided += 1;
        continue;
      }
      lines.push(`${line.sign}${line.content}`);
      emitted += 1;
    }
  }

  if (elided > 0) lines.push(`… ${elided} more diff lines`);
  return lines.join('\n');
}

/**
 * Everything a tool cell knows, as one selectable block.
 *
 * The summary row's `label` leads, because in raw mode there is no hover, no
 * chevron and no indent to say what the block underneath belongs to — the
 * label is the only thing tying output to the call that produced it.
 */
export function toolCellToPlainText(cell: ToolCell): string {
  const blocks: string[] = [cell.label];

  if (cell.continuationAll.length) {
    // The full continuation, not the two-line preview: a truncated command is
    // exactly the thing raw mode exists to stop shipping into a paste buffer.
    blocks.push(cell.continuationAll.join('\n'));
  }

  const detail = cell.detail;

  switch (detail.type) {
    case 'none':
      break;

    case 'text':
      // `allLines`, not the head/tail slice — the `… +N lines` marker is a
      // button, and a button contributes nothing to a copied selection.
      blocks.push(detail.empty ? '(no output)' : stripAnsi(detail.allLines.join('\n')));
      break;

    case 'error':
      blocks.push(stripAnsi(detail.text));
      break;

    case 'explore':
      blocks.push(
        detail.entries
          .map((entry) => {
            const values = entry.values.join(', ');
            return entry.scope
              ? `${entry.label} ${values} in ${entry.scope}`
              : `${entry.label} ${values}`;
          })
          .join('\n')
      );
      break;

    case 'diff':
      blocks.push(detail.files.map((file) => diffFileToPlainText(file)).join('\n\n'));
      break;

    case 'approval':
      // Rendered for completeness, but the interactive prompt stays a real
      // prompt in raw mode — see `ToolCell.tsx`. A decision the user cannot
      // make is worse than a decision they cannot cleanly copy.
      if (detail.reason) blocks.push(`Reason: ${detail.reason}`);
      if (detail.command) blocks.push(`$ ${detail.command}`);
      break;
  }

  return blocks.filter((block) => block.length > 0).join('\n');
}

// ---------------------------------------------------------------------------
// Changed-files summary (the end-of-turn "Changed N files +A −D" bar)
// ---------------------------------------------------------------------------

export type ChangedFilesSummary = {
  files: DiffFile[];
  added: number;
  removed: number;
  /**
   * The edit calls this summary was built from, newest last.
   *
   * The bar's Undo needs to name exactly the stored file changes this turn
   * produced. Path is not enough of a key: a file edited in three turns has
   * three records, and undoing the last turn must not roll back the other two.
   */
  toolCallIds: string[];
};

/**
 * Aggregate every successful file edit in a turn into one per-file
 * summary, for the "Edited N files +A −D · Review" bar the app renders
 * at the end of an editing turn. Repeated edits to the same file merge:
 * counts sum and hunks concatenate (with a gap marker between runs).
 */
export function collectChangedFiles(parts: ChatToolPart[]): ChangedFilesSummary | null {
  const byPath = new Map<string, DiffFile>();
  const toolCallIds: string[] = [];

  for (const part of parts) {
    if (toolCellKind(part) !== 'edit') continue;
    if (toolCellStatus(part.state) !== 'success') continue;

    const diff = parseUnifiedDiff(outputText(part));
    if (!diff) continue;

    if (part.toolCallId) toolCallIds.push(part.toolCallId);

    for (const file of diff) {
      const existing = byPath.get(file.path);
      if (existing) {
        existing.added += file.added;
        existing.removed += file.removed;
        existing.hunks = existing.hunks.concat(
          file.hunks.map((hunk, index) => (index === 0 ? { ...hunk, gapBefore: true } : hunk))
        );
        if (file.previousPath && !existing.previousPath) existing.previousPath = file.previousPath;
      } else {
        byPath.set(file.path, { ...file, hunks: [...file.hunks] });
      }
    }
  }

  if (!byPath.size) return null;

  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
    toolCallIds,
  };
}

/** The end-of-turn changed-files bar as selectable text. */
export function changedFilesToPlainText(summary: ChangedFilesSummary): string {
  const count = summary.files.length;
  const header = `Edited ${count} ${count === 1 ? 'file' : 'files'} +${summary.added} -${summary.removed}`;
  return [header, ...summary.files.map((file) => diffFileToPlainText(file))].join('\n\n');
}
