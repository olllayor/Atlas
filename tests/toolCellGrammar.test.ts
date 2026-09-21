import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ChatToolPart } from '../src/shared/contracts';
import {
  buildToolCells,
  collectChangedFiles,
  formatElapsed,
  parseUnifiedDiff,
  resolveToolCallPresentation,
  stripShellWrapper,
  truncateHeadTail,
} from '../src/shared/toolCellGrammar';

function toolPart(overrides: Partial<ChatToolPart> & Pick<ChatToolPart, 'toolName'>): ChatToolPart {
  return {
    id: overrides.id ?? overrides.toolName,
    type: 'tool',
    toolCallId: overrides.toolCallId ?? overrides.id ?? overrides.toolName,
    toolName: overrides.toolName,
    state: 'output-available',
    ...overrides,
  } as ChatToolPart;
}

describe('stripShellWrapper', () => {
  it('unwraps bash -lc with double quotes', () => {
    assert.equal(stripShellWrapper('bash -lc "pnpm test"'), 'pnpm test');
  });

  it('unwraps sh -c with single quotes', () => {
    assert.equal(stripShellWrapper("sh -c 'ls -la'"), 'ls -la');
  });

  it('leaves a plain command alone', () => {
    assert.equal(stripShellWrapper('  pnpm build  '), 'pnpm build');
  });
});

describe('truncateHeadTail', () => {
  it('keeps short output whole', () => {
    const lines = ['a', 'b', 'c'];
    assert.deepEqual(truncateHeadTail(lines, 5), { lines, omitted: 0 });
  });

  it('takes from both ends, not just the head', () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index}`);
    const result = truncateHeadTail(lines, 5);

    assert.equal(result.omitted, 20);
    assert.equal(result.lines.length, 10);
    assert.equal(result.lines[0], 'line 0');
    // The tail must survive — a failure at the end of a long log is
    // exactly what head-only truncation would hide.
    assert.equal(result.lines.at(-1), 'line 29');
  });
});

describe('formatElapsed', () => {
  it('matches the compact TUI format', () => {
    assert.equal(formatElapsed(0), '0s');
    assert.equal(formatElapsed(59_000), '59s');
    assert.equal(formatElapsed(60_000), '1m 00s');
    assert.equal(formatElapsed(185_000), '3m 05s');
    assert.equal(formatElapsed(3_661_000), '1h 01m 01s');
  });
});

describe('parseUnifiedDiff', () => {
  const diff = [
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,3 +1,4 @@',
    ' const a = 1;',
    '-const b = 2;',
    '+const b = 3;',
    '+const c = 4;',
    ' export { a };',
  ].join('\n');

  it('counts additions and removals', () => {
    const files = parseUnifiedDiff(diff);
    assert.ok(files);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, 'src/app.ts');
    assert.equal(files[0].added, 2);
    assert.equal(files[0].removed, 1);
  });

  it('assigns old numbers to deletes and new numbers to inserts', () => {
    const files = parseUnifiedDiff(diff);
    const lines = files![0].hunks[0].lines;

    const removed = lines.find((line) => line.sign === '-');
    const added = lines.find((line) => line.sign === '+');
    assert.equal(removed?.lineNumber, 2);
    assert.equal(added?.lineNumber, 2);
  });

  it('marks non-adjacent hunks so the gap can render', () => {
    const withGap = [
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,1 +1,1 @@',
      '-one',
      '+ONE',
      '@@ -40,1 +40,1 @@',
      '-forty',
      '+FORTY',
    ].join('\n');

    const files = parseUnifiedDiff(withGap);
    assert.equal(files![0].hunks.length, 2);
    assert.equal(files![0].hunks[0].gapBefore, false);
    assert.equal(files![0].hunks[1].gapBefore, true);
  });

  it('detects renames from the ---/+++ pair', () => {
    const renamed = [
      '--- a/old_name.rs',
      '+++ b/new_name.rs',
      '@@ -1,1 +1,1 @@',
      '-A',
      '+B',
    ].join('\n');

    const files = parseUnifiedDiff(renamed);
    assert.equal(files![0].previousPath, 'old_name.rs');
    assert.equal(files![0].path, 'new_name.rs');
  });

  it('returns null for output that is not a diff', () => {
    assert.equal(parseUnifiedDiff('just some text'), null);
    assert.equal(parseUnifiedDiff(''), null);
  });
});

describe('buildToolCells', () => {
  it('uses past-tense verbs when a call is finished', () => {
    const cells = buildToolCells([
      toolPart({
        toolName: 'bash',
        toolType: 'command_execution',
        input: { command: 'bash -lc "pnpm test"' },
        output: 'ok',
      }),
    ]);

    assert.equal(cells.length, 1);
    assert.equal(cells[0].verb, 'Ran');
    assert.equal(cells[0].subject, 'pnpm test');
    assert.equal(cells[0].subjectIsCode, true);
    assert.equal(cells[0].label, 'Ran pnpm test');
  });

  it('uses present-participle verbs while a call is running', () => {
    const cells = buildToolCells([
      toolPart({
        toolName: 'bash',
        toolType: 'command_execution',
        state: 'input-available',
        input: { command: 'pnpm build' },
      }),
    ]);

    assert.equal(cells[0].verb, 'Running');
    assert.equal(cells[0].status, 'running');
    assert.equal(cells[0].label, 'Running pnpm build');
  });

  it('labels a settled known tool with its own completed name, not "Called X" (PR #9267)', () => {
    const cells = buildToolCells([
      toolPart({ toolName: 'git_commit', input: { message: 'fix: typo' }, output: 'ok' }),
    ]);

    assert.equal(cells.length, 1);
    assert.equal(cells[0].label, 'Committed changes');
    assert.equal(cells[0].verb, 'Committed changes');
  });

  it('labels a running known tool with its live name', () => {
    const cells = buildToolCells([
      toolPart({ toolName: 'site_build', state: 'input-available', input: {} }),
    ]);

    assert.equal(cells[0].status, 'running');
    assert.equal(cells[0].label, 'Building site');
  });

  it('reads action arguments for branch and stash labels', () => {
    const switched = buildToolCells([
      toolPart({
        toolName: 'git_branch',
        input: { action: 'switch', name: 'feature/x' },
        output: 'ok',
      }),
    ]);
    assert.equal(switched[0].label, 'Switched to feature/x');

    const stashed = buildToolCells([
      toolPart({ toolName: 'git_stash', input: { action: 'pop' }, output: 'ok' }),
    ]);
    assert.equal(stashed[0].label, 'Restored stashed changes');
  });

  it('keeps "Called X" for unknown tools and leaves edits alone', () => {
    const unknown = buildToolCells([toolPart({ toolName: 'frobnicate', output: 'ok' })]);
    assert.equal(unknown[0].label, 'Called frobnicate');

    const edit = buildToolCells([
      toolPart({
        toolName: 'apply_patch',
        toolType: 'file_change',
        input: { path: 'src/a.ts' },
        output: 'ok',
      }),
    ]);
    assert.match(edit[0].label, /Edited/);
  });

  it('never gives a namespaced MCP tool a built-in friendly name', () => {
    assert.equal(
      resolveToolCallPresentation('mcp__github__git_commit', 'settled', {}),
      null
    );
  });

  it('coalesces consecutive reads into one "Explored N files" cell', () => {
    const cells = buildToolCells([
      toolPart({ id: 'r1', toolName: 'read_file', input: { path: 'src/a.ts' }, output: '' }),
      toolPart({ id: 'r2', toolName: 'read_file', input: { path: 'src/b.ts' }, output: '' }),
      toolPart({ id: 'r3', toolName: 'read_file', input: { path: 'src/c.ts' }, output: '' }),
    ]);

    assert.equal(cells.length, 1, 'three reads must render as one cell');
    assert.equal(cells[0].verb, 'Explored');
    assert.equal(cells[0].label, 'Explored 3 files');

    const detail = cells[0].detail;
    assert.equal(detail.type, 'explore');
    if (detail.type !== 'explore') return;
    assert.equal(detail.entries.length, 1, 'consecutive reads share one line');
    assert.deepEqual(detail.entries[0].values, ['a.ts', 'b.ts', 'c.ts']);
  });

  it('produces no cell for an update_plan call', () => {
    // The plan has its own checklist cell; a generic `Called update_plan` row
    // beside it would show the same event twice.
    const cells = buildToolCells([
      toolPart({
        id: 'p1',
        toolName: 'update_plan',
        input: { plan: [{ step: 'Read the code', status: 'in_progress' }] },
        output: { message: 'Plan updated.' },
      }),
    ]);

    assert.equal(cells.length, 0);
  });

  it('excludes update_plan from a mixed run', () => {
    const cells = buildToolCells([
      toolPart({ id: 'r1', toolName: 'read_file', input: { path: 'src/a.ts' }, output: '' }),
      toolPart({ id: 'p1', toolName: 'update_plan', input: { plan: [] }, output: '' }),
      toolPart({
        id: 'c1',
        toolName: 'bash',
        toolType: 'command_execution',
        input: { command: 'pnpm test' },
        output: 'ok',
      }),
    ]);

    assert.deepEqual(
      cells.map((cell) => cell.kind),
      ['explore', 'command']
    );
  });

  it('deduplicates repeated read targets', () => {
    const cells = buildToolCells([
      toolPart({ id: 'r1', toolName: 'read_file', input: { path: 'src/a.ts' }, output: '' }),
      toolPart({ id: 'r2', toolName: 'read_file', input: { path: 'src/a.ts' }, output: '' }),
    ]);

    const detail = cells[0].detail;
    if (detail.type !== 'explore') throw new Error('expected explore detail');
    assert.deepEqual(detail.entries[0].values, ['a.ts']);
    assert.equal(cells[0].label, 'Explored 1 file', 'the label counts distinct files');
  });

  it('labels a still-running explore run in the active form', () => {
    const cells = buildToolCells([
      toolPart({ id: 'r1', toolName: 'read_file', input: { path: 'src/a.ts' }, output: '' }),
      toolPart({ id: 'r2', toolName: 'read_file', state: 'input-available', input: { path: 'src/b.ts' } }),
    ]);

    assert.equal(cells[0].status, 'running');
    assert.equal(cells[0].label, 'Exploring files');
  });

  it('keeps a search on its own line but still inside the Explored cell', () => {
    const cells = buildToolCells([
      toolPart({ id: 's1', toolName: 'grep_search', input: { pattern: 'foo', path: 'src' }, output: '' }),
      toolPart({ id: 'r1', toolName: 'read_file', input: { path: 'src/a.ts' }, output: '' }),
    ]);

    assert.equal(cells.length, 1);
    const detail = cells[0].detail;
    if (detail.type !== 'explore') throw new Error('expected explore detail');
    assert.equal(detail.entries.length, 2);
    assert.equal(detail.entries[0].label, 'Search');
    assert.equal(detail.entries[0].scope, 'src');
    assert.equal(detail.entries[1].label, 'Read');
  });

  it('breaks the explore run when a non-read call intervenes', () => {
    const cells = buildToolCells([
      toolPart({ id: 'r1', toolName: 'read_file', input: { path: 'a.ts' }, output: '' }),
      toolPart({
        id: 'c1',
        toolName: 'bash',
        toolType: 'command_execution',
        input: { command: 'ls' },
        output: '',
      }),
      toolPart({ id: 'r2', toolName: 'read_file', input: { path: 'b.ts' }, output: '' }),
    ]);

    assert.deepEqual(
      cells.map((cell) => cell.verb),
      ['Explored', 'Ran', 'Explored']
    );
  });

  it('never coalesces a call awaiting approval', () => {
    const cells = buildToolCells([
      toolPart({ id: 'r1', toolName: 'read_file', input: { path: 'a.ts' }, output: '' }),
      toolPart({
        id: 'r2',
        toolName: 'read_file',
        state: 'approval-requested',
        input: { path: 'secret.env' },
        approval: { id: 'a1', reason: 'outside the workspace' },
      }),
    ]);

    assert.equal(cells.length, 2);
    assert.equal(cells[1].status, 'awaiting-approval');
    assert.equal(cells[1].detail.type, 'approval');
  });

  it('folds image views into the surrounding explore run as reads (t3code PR #9597)', () => {
    const cells = buildToolCells([
      toolPart({ id: 'r1', toolName: 'read_file', input: { path: 'src/a.ts' }, output: '' }),
      toolPart({
        id: 'v1',
        toolName: 'view_image',
        toolType: 'image_view',
        input: { path: 'assets/shot.png' },
        output: '',
      }),
      toolPart({ id: 'r2', toolName: 'read_file', input: { path: 'src/b.ts' }, output: '' }),
    ]);

    assert.equal(cells.length, 1, 'a bare image path must not split the read group');
    assert.equal(cells[0].kind, 'explore');
    assert.equal(cells[0].label, 'Explored 3 files');
    const detail = cells[0].detail;
    if (detail.type !== 'explore') throw new Error('expected explore detail');
    assert.deepEqual(
      detail.entries.flatMap((entry) => entry.values),
      ['a.ts', 'shot.png', 'b.ts']
    );
  });

  it('keeps an image view awaiting approval on its own row', () => {
    const cells = buildToolCells([
      toolPart({ id: 'r1', toolName: 'read_file', input: { path: 'a.ts' }, output: '' }),
      toolPart({
        id: 'v1',
        toolName: 'view_image',
        toolType: 'image_view',
        state: 'approval-requested',
        input: { path: 'assets/shot.png' },
        approval: { id: 'a1', reason: 'outside the workspace' },
      }),
    ]);

    assert.equal(cells.length, 2);
    assert.equal(cells[1].status, 'awaiting-approval');
  });

  it('renders empty command output as an explicit empty marker', () => {
    const cells = buildToolCells([
      toolPart({
        toolName: 'bash',
        toolType: 'command_execution',
        input: { command: 'true' },
        output: '',
      }),
    ]);

    const detail = cells[0].detail;
    if (detail.type !== 'text') throw new Error('expected text detail');
    assert.equal(detail.empty, true, '"no output" must be distinguishable from "lost output"');
  });

  it('caps command continuation lines and reports the overflow', () => {
    const cells = buildToolCells([
      toolPart({
        toolName: 'bash',
        toolType: 'command_execution',
        input: { command: 'one\ntwo\nthree\nfour\nfive' },
        output: '',
      }),
    ]);

    // Multiline finished commands compact to `Ran <program>` (t3code PR
    // #10898), so the head line joins the continuation block to stay
    // expandable rather than living in the label.
    assert.equal(cells[0].label, 'Ran one');
    assert.equal(cells[0].subject, 'one');
    assert.deepEqual(cells[0].continuation, ['one', 'two']);
    assert.equal(cells[0].continuationOmitted, 3);
    assert.deepEqual(cells[0].continuationAll, ['one', 'two', 'three', 'four', 'five']);
  });

  it('keeps a long completed command compact and expandable (t3code PR #10898)', () => {
    const heredoc = "python3 - <<'PY'\nprint('verification complete')\nPY";
    const longSingleLine = `python3 -c "print('${'x'.repeat(120)}')"`;
    const cases: Array<{ command: string; output: string; head: string }> = [
      { command: heredoc, output: '', head: "python3 - <<'PY'" },
      { command: heredoc, output: 'Script finished successfully', head: "python3 - <<'PY'" },
      {
        command: "python3 - <<'PY'\r\nprint('verification complete')\r\nPY",
        output: 'Script finished successfully',
        head: "python3 - <<'PY'",
      },
      { command: longSingleLine, output: '', head: longSingleLine },
    ];

    for (const { command, output, head } of cases) {
      const cells = buildToolCells([
        toolPart({
          toolName: 'bash',
          toolType: 'command_execution',
          input: { command },
          output,
        }),
      ]);

      assert.equal(cells.length, 1);
      assert.equal(cells[0].label, 'Ran python3');
      assert.ok(
        !cells[0].label.includes('print('),
        'the collapsed row must not inline the script'
      );
      // The full command survives in the continuation block, so expansion
      // (and raw mode) still reveal every line even with no output.
      const expanded = cells[0].continuationAll.join('\n');
      assert.ok(expanded.includes(head), 'expansion keeps the head line');
      assert.ok(
        expanded.includes(command.split(/\r?\n/).at(-1)!),
        'expansion keeps the tail line'
      );
      if (output) {
        const detail = cells[0].detail;
        assert.equal(detail.type, 'text');
        assert.ok(
          detail.type === 'text' && detail.allLines.join('\n').includes(output),
          'expansion keeps the output too'
        );
      } else {
        assert.equal(cells[0].detail.type, 'text', 'empty output stays expandable');
      }
    }
  });

  it('leaves a short one-line completed command alone', () => {
    const cells = buildToolCells([
      toolPart({
        toolName: 'bash',
        toolType: 'command_execution',
        input: { command: 'pnpm test' },
        output: 'ok',
      }),
    ]);

    assert.equal(cells[0].label, 'Ran pnpm test');
    assert.deepEqual(cells[0].continuationAll, []);
  });

  it('leaves a running long command expanded while it is live', () => {
    const cells = buildToolCells([
      toolPart({
        toolName: 'bash',
        toolType: 'command_execution',
        state: 'input-available',
        input: { command: "python3 - <<'PY'\nprint('verification complete')\nPY" },
      }),
    ]);

    assert.equal(cells[0].status, 'running');
    assert.ok(cells[0].label.startsWith('Running python3 - '), 'live rows keep the full head');
  });

  it('builds a diff detail with a +/- summary for file edits', () => {
    const cells = buildToolCells([
      toolPart({
        toolName: 'apply_patch',
        toolType: 'file_change',
        input: { path: 'src/app.ts' },
        output: ['--- a/src/app.ts', '+++ b/src/app.ts', '@@ -1,2 +1,2 @@', '-old', '+new'].join('\n'),
      }),
    ]);

    assert.equal(cells[0].verb, 'Edited');
    assert.equal(cells[0].label, 'Edited app.ts', 'the label uses the basename');
    const detail = cells[0].detail;
    if (detail.type !== 'diff') throw new Error('expected diff detail');
    assert.equal(detail.added, 1);
    assert.equal(detail.removed, 1);
  });

  it('says "Edited N files" when a patch spans several files', () => {
    const cells = buildToolCells([
      toolPart({
        toolName: 'apply_patch',
        toolType: 'file_change',
        output: [
          '--- a/a.txt',
          '+++ b/a.txt',
          '@@ -1,1 +1,1 @@',
          '-one',
          '+ONE',
          '--- a/b.txt',
          '+++ b/b.txt',
          '@@ -1,0 +1,1 @@',
          '+new',
        ].join('\n'),
      }),
    ]);

    assert.equal(cells[0].verb, 'Edited 2 files');
    assert.equal(cells[0].label, 'Edited 2 files');
    const detail = cells[0].detail;
    if (detail.type !== 'diff') throw new Error('expected diff detail');
    assert.equal(detail.files.length, 2);
  });

  it('labels web searches with the query', () => {
    const done = buildToolCells([
      toolPart({
        id: 'w1',
        toolName: 'web_search',
        toolType: 'web_search',
        input: { query: 'electron rebuild arm64' },
        output: 'results',
      }),
    ]);
    assert.equal(done[0].label, 'Searched the web for electron rebuild arm64');

    const running = buildToolCells([
      toolPart({
        id: 'w2',
        toolName: 'web_search',
        toolType: 'web_search',
        state: 'input-available',
        input: { query: 'electron rebuild arm64' },
      }),
    ]);
    assert.equal(running[0].label, 'Searching the web');
  });

  it('computes duration from the part timestamps', () => {
    const cells = buildToolCells([
      toolPart({
        toolName: 'bash',
        toolType: 'command_execution',
        input: { command: 'sleep 2' },
        output: '',
        startedAt: '2026-07-28T03:00:00.000Z',
        completedAt: '2026-07-28T03:00:02.500Z',
      }),
    ]);

    assert.equal(cells[0].durationMs, 2500);
  });
});

describe('collectChangedFiles', () => {
  const editPart = (id: string, path: string, diff: string, state = 'output-available') =>
    toolPart({
      id,
      toolName: 'apply_patch',
      toolType: 'file_change',
      state: state as ChatToolPart['state'],
      input: { path },
      output: diff,
    });

  const diffFor = (path: string, adds: number, dels: number) =>
    [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${dels} +1,${adds} @@`,
      ...Array.from({ length: dels }, (_, index) => `-old ${index}`),
      ...Array.from({ length: adds }, (_, index) => `+new ${index}`),
    ].join('\n');

  it('returns null for a turn with no successful edits', () => {
    assert.equal(collectChangedFiles([]), null);
    assert.equal(
      collectChangedFiles([
        toolPart({
          toolName: 'bash',
          toolType: 'command_execution',
          input: { command: 'ls' },
          output: '',
        }),
      ]),
      null
    );
  });

  it('aggregates edits across the turn into per-file totals', () => {
    const summary = collectChangedFiles([
      editPart('e1', 'a.ts', diffFor('a.ts', 2, 1)),
      editPart('e2', 'b.ts', diffFor('b.ts', 3, 0)),
    ]);

    assert.ok(summary);
    assert.equal(summary.files.length, 2);
    assert.equal(summary.added, 5);
    assert.equal(summary.removed, 1);
  });

  it('merges repeated edits to the same file', () => {
    const summary = collectChangedFiles([
      editPart('e1', 'a.ts', diffFor('a.ts', 1, 1)),
      editPart('e2', 'a.ts', diffFor('a.ts', 2, 0)),
    ]);

    assert.ok(summary);
    assert.equal(summary.files.length, 1, 'two edits to one file must merge');
    assert.equal(summary.files[0].added, 3);
    assert.equal(summary.files[0].removed, 1);
  });

  it('ignores failed and still-running edits', () => {
    const summary = collectChangedFiles([
      editPart('e1', 'a.ts', diffFor('a.ts', 1, 0)),
      editPart('e2', 'b.ts', diffFor('b.ts', 4, 4), 'output-error'),
      editPart('e3', 'c.ts', diffFor('c.ts', 4, 4), 'input-available'),
    ]);

    assert.ok(summary);
    assert.equal(summary.files.length, 1, 'only the successful edit counts');
    assert.equal(summary.files[0].path, 'a.ts');
  });
});
