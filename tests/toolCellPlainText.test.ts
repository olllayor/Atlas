/**
 * Raw mode's plain-text rendering of the transcript cell grammar.
 *
 * There is no DOM in this suite (bare `node --test`, no jsdom), which is why
 * the conversion is a pure function over the cell model rather than something
 * each component derives from its own JSX. Everything a reader would get by
 * selecting a raw cell and hitting copy is decided here and asserted here.
 *
 * The rules being pinned:
 *   - a copied diff is a patch `git apply` accepts (ASCII `-`, never U+2212)
 *   - nothing that only exists as decoration survives (`⋮`, chevrons, gutters)
 *   - truncation markers are buttons in the rich view, so the raw view emits
 *     the *whole* output rather than the head/tail slice behind them
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatToolPart } from '../src/shared/contracts.ts';
import {
  buildToolCells,
  changedFilesToPlainText,
  collectChangedFiles,
  diffFileToPlainText,
  parseUnifiedDiff,
  toolCellToPlainText,
} from '../src/shared/toolCellGrammar.ts';
import { derivePlanView, planViewToPlainText } from '../src/shared/planTool.ts';

const part = (overrides: Partial<ChatToolPart>): ChatToolPart =>
  ({
    id: 'part-1',
    type: 'tool',
    toolCallId: 'call-1',
    toolName: 'bash',
    state: 'output-available',
    input: {},
    output: '',
    dynamic: false,
    ...overrides,
  }) as ChatToolPart;

const cellFor = (input: Partial<ChatToolPart>) => {
  const cells = buildToolCells([part(input)]);
  assert.equal(cells.length, 1, 'expected exactly one cell');
  return cells[0];
};

// ---------------------------------------------------------------------------
// Command cells
// ---------------------------------------------------------------------------

test('raw command cell leads with the label and follows with the output', () => {
  const cell = cellFor({
    toolType: 'command_execution',
    input: { command: 'npm test' },
    output: 'ok 1\nok 2',
  });

  assert.equal(toolCellToPlainText(cell), 'Ran npm test\nok 1\nok 2');
});

test('raw command cell emits the full output, not the head/tail slice', () => {
  const lines = Array.from({ length: 40 }, (_value, index) => `line ${index + 1}`);
  const cell = cellFor({
    toolType: 'command_execution',
    input: { command: 'cat log' },
    output: lines.join('\n'),
  });

  // The rich cell shows 5 + 5 with a `… +30 lines` *button* between them, and
  // a button contributes nothing to a selection.
  assert.equal(cell.detail.type, 'text');
  assert.ok(cell.detail.type === 'text' && cell.detail.omitted === 30);

  const text = toolCellToPlainText(cell);
  for (const line of lines) assert.ok(text.includes(line), `missing ${line}`);
  assert.ok(!text.includes('…'));
});

test('raw command cell includes every continuation line of a multi-line command', () => {
  const cell = cellFor({
    toolType: 'command_execution',
    input: { command: 'a\nb\nc\nd\ne' },
    output: 'done',
  });

  // Only two continuation lines are previewed in the rich view.
  assert.equal(cell.continuation.length, 2);
  assert.equal(cell.continuationOmitted, 2);

  assert.equal(toolCellToPlainText(cell), 'Ran a\nb\nc\nd\ne\ndone');
});

test('an empty finished command says so rather than rendering nothing', () => {
  const cell = cellFor({
    toolType: 'command_execution',
    input: { command: 'true' },
    output: '',
  });

  assert.equal(toolCellToPlainText(cell), 'Ran true\n(no output)');
});

test('raw output strips ANSI escapes rather than pasting them', () => {
  // The rich path strips these inside TerminalBlock, which raw mode does not
  // render — so without an explicit strip a coloured test runner pastes as
  // `\u001B[32m✔\u001B[0m`.
  const cell = cellFor({
    toolType: 'command_execution',
    input: { command: 'pnpm test' },
    output: '\u001B[32m✔ pass\u001B[0m\n\u001B[31m✖ fail\u001B[0m',
  });

  assert.equal(toolCellToPlainText(cell), 'Ran pnpm test\n✔ pass\n✖ fail');
});

test('a raw error block is stripped too', () => {
  const cell = cellFor({
    toolType: 'command_execution',
    input: { command: 'build' },
    state: 'output-error',
    errorText: '\u001B[31merror: boom\u001B[0m',
  });

  assert.equal(toolCellToPlainText(cell), 'Ran build\nerror: boom');
});

test('a failed command carries its error text', () => {
  const cell = cellFor({
    toolType: 'command_execution',
    input: { command: 'false' },
    state: 'output-error',
    errorText: 'exit status 1',
  });

  assert.equal(toolCellToPlainText(cell), 'Ran false\nexit status 1');
});

// ---------------------------------------------------------------------------
// Explore cells
// ---------------------------------------------------------------------------

test('raw explore cell lists its entries one per line, scope inline', () => {
  const cells = buildToolCells([
    part({ id: 'a', toolCallId: 'a', toolName: 'read_file', input: { path: 'src/App.tsx' } }),
    part({ id: 'b', toolCallId: 'b', toolName: 'read_file', input: { path: 'src/main.ts' } }),
    part({
      id: 'c',
      toolCallId: 'c',
      toolName: 'grep_search',
      input: { query: 'useState', path: 'src/' },
    }),
  ]);

  assert.equal(cells.length, 1);
  assert.equal(
    toolCellToPlainText(cells[0]),
    'Explored 2 files\nRead App.tsx, main.ts\nSearch useState in src/'
  );
});

// ---------------------------------------------------------------------------
// Diffs
// ---------------------------------------------------------------------------

const PATCH = [
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,3 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
].join('\n');

test('a raw diff is a patch git apply would accept', () => {
  const files = parseUnifiedDiff(PATCH);
  assert.ok(files);

  const text = diffFileToPlainText(files[0]);

  assert.equal(
    text,
    ['--- src/app.ts (+1 -1)', ' const a = 1;', '-const b = 2;', '+const b = 3;'].join('\n')
  );

  // The display minus is a rendering detail of the table; a patch that carries
  // it is a patch that does not apply.
  assert.ok(!text.includes('−'), 'raw diff must use ASCII -, not U+2212');
});

test('a raw diff drops the gutter line numbers the table renders', () => {
  const files = parseUnifiedDiff(PATCH);
  assert.ok(files);

  // The table puts a right-aligned number in its own <td>, which every browser
  // joins into the selection with a tab.
  assert.ok(files[0].hunks[0].lines.every((line) => line.lineNumber != null));
  assert.ok(!/^\s*\d/m.test(diffFileToPlainText(files[0])));
});

test('a raw diff writes @@ where the table draws a gap glyph', () => {
  const files = parseUnifiedDiff(
    [
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
      '@@ -80,1 +80,1 @@',
      '-c',
      '+d',
    ].join('\n')
  );
  assert.ok(files);

  const text = diffFileToPlainText(files[0]);
  assert.ok(text.includes('\n@@\n'));
  assert.ok(!text.includes('⋮'));
});

test('a raw diff elides past the line cap and says how many it dropped', () => {
  const body = Array.from({ length: 12 }, (_value, index) => `+line ${index}`);
  const files = parseUnifiedDiff(
    ['--- a/x.ts', '+++ b/x.ts', `@@ -1,0 +1,${body.length} @@`, ...body].join('\n')
  );
  assert.ok(files);

  const text = diffFileToPlainText(files[0], 5);
  assert.ok(text.includes('+line 4'));
  assert.ok(!text.includes('+line 5'));
  assert.ok(text.includes('… 7 more diff lines'));
});

test('an edit cell renders its label and its patch together', () => {
  const cell = cellFor({ toolType: 'file_change', toolName: 'apply_patch', output: PATCH });

  assert.equal(
    toolCellToPlainText(cell),
    ['Edited app.ts', '--- src/app.ts (+1 -1)', ' const a = 1;', '-const b = 2;', '+const b = 3;'].join(
      '\n'
    )
  );
});

test('the changed-files bar renders as a header plus every patch', () => {
  const summary = collectChangedFiles([
    part({ toolType: 'file_change', toolName: 'apply_patch', output: PATCH }),
  ]);
  assert.ok(summary);

  const text = changedFilesToPlainText(summary);
  assert.ok(text.startsWith('Edited 1 file +1 -1'));
  assert.ok(text.includes('-const b = 2;'));
  assert.ok(!text.includes('−'));
});

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

test('a raw approval cell states the reason and the exact command', () => {
  const cell = cellFor({
    toolType: 'command_execution',
    state: 'approval-requested',
    input: { command: 'rm -rf build' },
    approval: { id: 'ap-1', reason: 'Destructive command' },
  } as Partial<ChatToolPart>);

  assert.equal(
    toolCellToPlainText(cell),
    'Approve rm -rf build\nReason: Destructive command\n$ rm -rf build'
  );
});

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

test('a raw plan uses checkbox characters instead of icons and strikethrough', () => {
  const view = derivePlanView([
    part({
      toolName: 'update_plan',
      input: {
        explanation: 'Two steps',
        plan: [
          { step: 'Read the code', status: 'completed' },
          { step: 'Write the fix', status: 'in_progress' },
          { step: 'Run the tests', status: 'pending' },
        ],
      },
    }),
  ]);
  assert.ok(view);

  assert.equal(
    planViewToPlainText(view),
    ['Plan (1/3)', 'Two steps', '[x] Read the code', '[~] Write the fix', '[ ] Run the tests'].join(
      '\n'
    )
  );
});

// ---------------------------------------------------------------------------
// Shape invariants
// ---------------------------------------------------------------------------

test('every cell kind produces non-empty text that starts with its label', () => {
  const samples: Array<Partial<ChatToolPart>> = [
    { toolType: 'command_execution', input: { command: 'ls' }, output: 'a\nb' },
    { toolType: 'file_change', toolName: 'apply_patch', output: PATCH },
    { toolType: 'web_search', toolName: 'web_fetch', input: { query: 'atlas' }, output: 'hit' },
    { toolType: 'mcp_tool_call', toolName: 'mcp__x__y', input: { a: 1 }, output: 'ok' },
    { toolType: 'image_view', toolName: 'view_image', input: { path: 'a/b.png' }, output: 'seen' },
    { toolName: 'something_else', output: 'ok' },
  ];

  for (const sample of samples) {
    const cell = cellFor(sample);
    const text = toolCellToPlainText(cell);
    assert.ok(text.length > 0, `empty text for ${cell.kind}`);
    assert.ok(text.startsWith(cell.label), `${cell.kind} did not lead with its label`);
  }
});
