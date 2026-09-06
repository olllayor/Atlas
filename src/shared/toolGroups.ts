/**
 * Collapsing tool activity into one line (port of t3code #7152, adapted).
 *
 * The transcript's work phase used to render one row per tool call, so a
 * turn that searched the web four times pushed its answer below four
 * `Searched the web` lines. This module folds an ordered `ToolCell[]` into
 * *groups* — a live run becomes one shimmer line, a settled run one summary
 * toggle — while single calls and approval prompts keep their own rows.
 *
 * Two deliberate deviations from the upstream PR, both Atlas-shaped:
 * - A run of exactly one cell is not wrapped: the cell already renders as
 *   one summary line, and a toggle around it would add a click that reveals
 *   the same line. Upstream emits a toggle even for n=1.
 * - Summaries speak the cell grammar's vocabulary (`Explored N files`,
 *   `Ran N commands`) rather than upstream's request-kind actions, and the
 *   shell parser is a small first-token reader, not a full tokenizer —
 *   command subjects already arrive unwrapped via `stripShellWrapper`.
 *
 * Pure TypeScript, no React — testable like the grammar itself.
 */

import type { ToolCell } from './toolCellGrammar';

export type ToolGroup =
  | { kind: 'single'; cell: ToolCell }
  | { kind: 'live'; id: string; cells: ToolCell[] }
  | { kind: 'settled'; id: string; cells: ToolCell[] };

function isLiveCell(cell: ToolCell): boolean {
  return cell.status === 'pending' || cell.status === 'running';
}

function isSettledCell(cell: ToolCell): boolean {
  return cell.status === 'success' || cell.status === 'failed';
}

/**
 * Fold consecutive cells into groups.
 *
 * - `awaiting-approval` (and anything else unrecognized) always stands
 *   alone: an approval prompt must never hide inside a collapsed toggle,
 *   and its decision surface belongs to exactly one call.
 * - Consecutive live cells form one live run; consecutive settled cells
 *   one settled run. A run of one renders as today (no wrapper).
 * - Group ids key on the first cell's id, which is stable while a run
 *   grows at its tail, so expansion state survives streaming appends.
 */
export function groupToolCells(cells: readonly ToolCell[]): ToolGroup[] {
  const groups: ToolGroup[] = [];
  let run: ToolCell[] = [];
  let runKind: 'live' | 'settled' | null = null;

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1 || runKind == null) {
      for (const cell of run) groups.push({ kind: 'single', cell });
    } else {
      const first = run[0]!.id;
      groups.push({ kind: runKind, id: `tg:${runKind}:${first}`, cells: [...run] });
    }
    run = [];
    runKind = null;
  };

  for (const cell of cells) {
    const kind = isLiveCell(cell) ? 'live' : isSettledCell(cell) ? 'settled' : null;
    if (kind == null || kind !== runKind) {
      flush();
      if (kind == null) {
        groups.push({ kind: 'single', cell });
        continue;
      }
      runKind = kind;
    }
    run.push(cell);
  }
  flush();
  return groups;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

function sentenceJoin(labels: string[]): string {
  const lowered = labels.map((label, index) =>
    index === 0 ? label : label.charAt(0).toLowerCase() + label.slice(1)
  );
  if (lowered.length < 2) return lowered[0] ?? '';
  if (lowered.length === 2) return lowered.join(' and ');
  return `${lowered.slice(0, -1).join(', ')}, and ${lowered.at(-1)}`;
}

export type ToolGroupSummary = {
  /** One-line toggle copy, e.g. `Ran 2 commands and changed 3 files`. */
  text: string;
  /** Any member failed — the toggle wears the failure affordance. */
  hasFailure: boolean;
};

/**
 * Summarize a settled run in one line.
 *
 * Counts follow the cell grammar: commands per call, edits per distinct
 * file (diff paths where the cell parsed a patch, else one per call),
 * explores per distinct read/list file plus code searches, web searches
 * per call, everything else per call as `Used N tools`.
 */
export function summarizeToolGroup(cells: readonly ToolCell[]): ToolGroupSummary {
  let commands = 0;
  const editedFiles = new Set<string>();
  let editsWithoutFiles = 0;
  const exploredFiles = new Set<string>();
  let codeSearches = 0;
  let webSearches = 0;
  let other = 0;
  let hasFailure = false;

  for (const cell of cells) {
    if (cell.status === 'failed') hasFailure = true;
    switch (cell.kind) {
      case 'command':
        commands += 1;
        break;
      case 'edit': {
        const files =
          cell.detail.type === 'diff' ? cell.detail.files.map((file) => file.path) : [];
        if (files.length > 0) {
          for (const path of files) editedFiles.add(path);
        } else {
          editsWithoutFiles += 1;
        }
        break;
      }
      case 'explore': {
        if (cell.detail.type === 'explore') {
          for (const entry of cell.detail.entries) {
            if (entry.label === 'Read' || entry.label === 'List') {
              for (const value of entry.values) exploredFiles.add(value);
            } else if (entry.label === 'Search') {
              codeSearches += entry.values.length;
            }
          }
        }
        break;
      }
      case 'web':
        webSearches += 1;
        break;
      default:
        other += 1;
        break;
    }
  }

  const labels: string[] = [];
  if (commands > 0) labels.push(`Ran ${commands} ${pluralize(commands, 'command')}`);
  const editedTotal = editedFiles.size + editsWithoutFiles;
  if (editedTotal > 0) labels.push(`Changed ${editedTotal} ${pluralize(editedTotal, 'file')}`);
  if (exploredFiles.size > 0)
    labels.push(`Explored ${exploredFiles.size} ${pluralize(exploredFiles.size, 'file')}`);
  if (codeSearches > 0)
    labels.push(`Searched code ${codeSearches} ${pluralize(codeSearches, 'time')}`);
  if (webSearches > 0)
    labels.push(`Searched the web ${webSearches} ${pluralize(webSearches, 'time')}`);
  if (other > 0) labels.push(`Used ${other} ${pluralize(other, 'tool')}`);

  return { text: sentenceJoin(labels), hasFailure };
}

// ---------------------------------------------------------------------------
// Live labels
// ---------------------------------------------------------------------------

const WRAPPER_COMMANDS = new Set(['env', 'sudo']);
const VALUE_FLAGS = new Set([
  '-u',
  '--user',
  '-g',
  '--group',
  '-D',
  '--chdir',
  '-C',
  '--close-from',
  '-S',
  '--split-string',
  '-U',
  '--other-user',
  '-e',
  '--unset',
]);

function splitCommandTokens(command: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  let hasContent = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    if (quote != null) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && index + 1 < command.length) {
        index += 1;
        current += command[index]!;
      } else {
        current += char;
      }
      hasContent = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }
    if (char === '\\' && index + 1 < command.length) {
      index += 1;
      current += command[index]!;
      hasContent = true;
      continue;
    }
    if (char === ' ' || char === '\t') {
      if (hasContent) {
        tokens.push(current);
        current = '';
        hasContent = false;
      }
      continue;
    }
    current += char;
    hasContent = true;
  }
  if (quote != null) return null;
  if (hasContent) tokens.push(current);
  return tokens;
}

function basenameOf(program: string): string {
  const parts = program.split(/[\\/]/);
  return parts[parts.length - 1] ?? program;
}

/**
 * The program a live command line runs: first token, assignments skipped,
 * `env`/`sudo` wrappers unwrapped. Null when there is nothing to name.
 */
export function commandProgram(commandLine: string, depth = 0): string | null {
  const tokens = splitCommandTokens(commandLine.trim());
  if (!tokens || depth > 3) return null;

  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]!)) {
    index += 1;
  }
  // `VAR=1` alone (or an empty line) names no program.
  if (index >= tokens.length) return null;

  let program = basenameOf(tokens[index]!);
  if (WRAPPER_COMMANDS.has(program)) {
    index += 1;
    while (index < tokens.length) {
      const flag = tokens[index]!;
      if (flag === '--') {
        index += 1;
        break;
      }
      if (!flag.startsWith('-') || flag === '-') break;
      // `-S/--split-string` carries a whole command line as its value.
      if ((flag === '-S' || flag === '--split-string') && index + 1 < tokens.length) {
        return commandProgram(tokens[index + 1]!, depth + 1);
      }
      index += 1;
      if (!flag.includes('=') && VALUE_FLAGS.has(flag)) index += 1;
    }
    if (index >= tokens.length) return null;
    program = basenameOf(tokens[index]!);
  }
  return program || null;
}

/**
 * The live run's one-line label: the latest cell's program for commands
 * (`Running pnpm`), otherwise that cell's own live label, which the grammar
 * already phrases (`Searching the web`, `Exploring files`, `Calling X`).
 */
export function liveToolLabel(cells: readonly ToolCell[]): string {
  const latest = cells[cells.length - 1];
  if (!latest) return 'Working';
  if (latest.kind === 'command') {
    const program = latest.subject ? commandProgram(latest.subject) : null;
    return program ? `Running ${program}` : latest.label || 'Running command';
  }
  return latest.label || 'Working';
}
