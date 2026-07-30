import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import type { ToolWorkspace } from './toolWorkspace';
import { resolveWorkspaceCwd, resolveWritablePath } from './toolWorkspace';
import { runCommand } from './toolRuntime';

/** Beyond this, the LCS table is too big to be worth it; emit a replace hunk. */
const MAX_DIFF_LINES = 4000;
const DIFF_CONTEXT_LINES = 3;

function splitLines(value: string) {
  return value.length === 0 ? [] : value.replace(/\r\n?/g, '\n').split('\n');
}

/**
 * Longest common subsequence over lines, as an index-pair list.
 *
 * A diff library would do, but the app ships none and this is ~40 lines: for
 * inputs this size (a source file, not a repository) the quadratic table is
 * cheaper than a dependency.
 */
function lcsPairs(before: string[], after: string[]) {
  const rows = before.length;
  const cols = after.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      table[row]![col] =
        before[row] === after[col]
          ? table[row + 1]![col + 1]! + 1
          : Math.max(table[row + 1]![col]!, table[row]![col + 1]!);
    }
  }

  const pairs: Array<[number, number]> = [];
  let row = 0;
  let col = 0;
  while (row < rows && col < cols) {
    if (before[row] === after[col]) {
      pairs.push([row, col]);
      row += 1;
      col += 1;
    } else if (table[row + 1]![col]! >= table[row]![col + 1]!) {
      row += 1;
    } else {
      col += 1;
    }
  }

  return pairs;
}

type DiffOp = { sign: ' ' | '+' | '-'; content: string; oldLine: number; newLine: number };

function buildOps(before: string[], after: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  const pairs = lcsPairs(before, after);
  let oldIndex = 0;
  let newIndex = 0;

  const flushTo = (oldEnd: number, newEnd: number) => {
    while (oldIndex < oldEnd) {
      ops.push({ sign: '-', content: before[oldIndex]!, oldLine: oldIndex + 1, newLine: newIndex + 1 });
      oldIndex += 1;
    }
    while (newIndex < newEnd) {
      ops.push({ sign: '+', content: after[newIndex]!, oldLine: oldIndex + 1, newLine: newIndex + 1 });
      newIndex += 1;
    }
  };

  for (const [oldPair, newPair] of pairs) {
    flushTo(oldPair, newPair);
    ops.push({ sign: ' ', content: before[oldPair]!, oldLine: oldIndex + 1, newLine: newIndex + 1 });
    oldIndex += 1;
    newIndex += 1;
  }

  flushTo(before.length, after.length);
  return ops;
}

/**
 * A unified diff in the exact shape `parseUnifiedDiff` in
 * `src/shared/toolCellGrammar.ts` consumes, so an edit made by a tool renders
 * in the transcript and in the workbench Changes tab without a translation step.
 *
 * The tool result *is* this string: the renderer reads diffs off the tool
 * output, so returning a JSON envelope would leave the panels empty.
 */
export function buildUnifiedDiff(displayPath: string, beforeText: string, afterText: string): string | null {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);

  if (beforeText === afterText) {
    return null;
  }

  const header = `--- a/${displayPath}\n+++ b/${displayPath}`;

  if (before.length > MAX_DIFF_LINES || after.length > MAX_DIFF_LINES) {
    return [
      header,
      `@@ -1,${before.length} +1,${after.length} @@`,
      ...before.map((line) => `-${line}`),
      ...after.map((line) => `+${line}`)
    ].join('\n');
  }

  const ops = buildOps(before, after);
  const changedIndexes = ops.flatMap((op, index) => (op.sign === ' ' ? [] : [index]));
  if (changedIndexes.length === 0) {
    return null;
  }

  // Group changes that are within 2×context of each other into one hunk, the
  // way `diff -U3` does, so a two-line edit does not print the whole file.
  const groups: Array<{ start: number; end: number }> = [];
  for (const index of changedIndexes) {
    const last = groups.at(-1);
    if (last && index - last.end <= DIFF_CONTEXT_LINES * 2) {
      last.end = index;
      continue;
    }
    groups.push({ start: index, end: index });
  }

  const body: string[] = [];
  for (const group of groups) {
    const start = Math.max(0, group.start - DIFF_CONTEXT_LINES);
    const end = Math.min(ops.length - 1, group.end + DIFF_CONTEXT_LINES);
    const slice = ops.slice(start, end + 1);

    const oldCount = slice.filter((op) => op.sign !== '+').length;
    const newCount = slice.filter((op) => op.sign !== '-').length;
    const oldStart = slice.find((op) => op.sign !== '+')?.oldLine ?? 1;
    const newStart = slice.find((op) => op.sign !== '-')?.newLine ?? 1;

    body.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of slice) {
      body.push(`${op.sign}${op.content}`);
    }
  }

  return [header, ...body].join('\n');
}

async function readIfExists(filePath: string) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** Path shown in the diff: relative to the project, which is how users read it. */
function displayPathFor(target: string, workspace: ToolWorkspace | undefined) {
  const root = workspace?.root;
  if (!root) {
    return target;
  }

  const relativePath = relative(resolve(root), target);
  return relativePath && !relativePath.startsWith('..') ? relativePath : target;
}

export async function writeFileToolExecute(
  input: { file_path: string; content: string },
  workspace?: ToolWorkspace
) {
  const target = resolveWritablePath(input.file_path, workspace);
  const previous = await readIfExists(target);
  const displayPath = displayPathFor(target, workspace);

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, input.content, 'utf8');

  const diff = buildUnifiedDiff(displayPath, previous ?? '', input.content);

  if (diff) {
    return diff;
  }

  return previous == null
    ? `Created ${displayPath} (empty file).`
    : `${displayPath} already had this exact content; nothing changed.`;
}

export async function editFileToolExecute(
  input: { file_path: string; old_string: string; new_string: string; replace_all?: boolean },
  workspace?: ToolWorkspace
) {
  const target = resolveWritablePath(input.file_path, workspace);
  const previous = await readIfExists(target);

  if (previous == null) {
    throw new Error(`${input.file_path} does not exist. Use write_file to create it.`);
  }

  if (input.old_string === input.new_string) {
    throw new Error('old_string and new_string are identical, so this edit would do nothing.');
  }

  const occurrences = previous.split(input.old_string).length - 1;

  if (occurrences === 0) {
    throw new Error(
      'old_string was not found in the file. Read the file again — the text must match exactly, including indentation.'
    );
  }

  // Same rule as Atlas's own editing tools: an ambiguous match is a failed
  // edit, not a coin flip about which occurrence the model meant.
  if (occurrences > 1 && !input.replace_all) {
    throw new Error(
      `old_string appears ${occurrences} times. Include more surrounding context to make it unique, or pass replace_all.`
    );
  }

  const next = input.replace_all
    ? previous.split(input.old_string).join(input.new_string)
    : previous.replace(input.old_string, input.new_string);

  await writeFile(target, next, 'utf8');

  const displayPath = displayPathFor(target, workspace);
  return buildUnifiedDiff(displayPath, previous, next) ?? `${displayPath} unchanged.`;
}

async function runGit(args: string[], workspace: ToolWorkspace | undefined) {
  const cwd = resolveWorkspaceCwd(workspace);
  const result = await runCommand('git', args, { cwd, timeoutMs: 20_000 });

  if (result.code !== 0) {
    const message = result.stderr.trim() || result.stdout.trim();
    throw new Error(message || `git ${args[0]} exited with code ${result.code ?? 'unknown'}.`);
  }

  return result.stdout;
}

export async function gitStatusToolExecute(_input: Record<string, never>, workspace?: ToolWorkspace) {
  const output = await runGit(['status', '--porcelain=v1', '--branch'], workspace);
  return output.trim() || 'Working tree clean.';
}

export async function gitDiffToolExecute(
  input: { staged?: boolean; path?: string },
  workspace?: ToolWorkspace
) {
  const args = ['--no-pager', 'diff', '--no-color', '-U3'];
  if (input.staged) {
    args.push('--staged');
  }
  if (input.path?.trim()) {
    args.push('--', input.path.trim());
  }

  const output = await runGit(args, workspace);
  return output.trim() || 'No changes.';
}
