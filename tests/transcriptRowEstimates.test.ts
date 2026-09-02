import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatToolPart } from '../src/shared/contracts.js';
import { buildToolCells } from '../src/shared/toolCellGrammar.js';

/**
 * The transcript's row-height estimator runs the tool-cell grammar, which
 * parses every unified diff in a turn. The virtualizer calls it synchronously
 * for every row it has not measured, so the cost below is what a cache miss
 * costs on the thread that paints. This test documents the shape of that work
 * and guards the two things that keep it off the streaming path: the grammar
 * being deterministic per part list, and the parse being the expensive half.
 */

function diffText(files: number, linesPerFile: number) {
  let out = '';
  for (let file = 0; file < files; file += 1) {
    out += `diff --git a/src/file${file}.ts b/src/file${file}.ts\n`;
    out += `--- a/src/file${file}.ts\n+++ b/src/file${file}.ts\n`;
    out += `@@ -1,${linesPerFile} +1,${linesPerFile} @@\n`;
    for (let line = 0; line < linesPerFile; line += 1) {
      out +=
        line % 3 === 0
          ? `+  const added${line} = ${line};\n`
          : line % 3 === 1
            ? `-  const removed${line} = ${line};\n`
            : `   const kept${line} = ${line};\n`;
    }
  }
  return out;
}

function editPart(files: number, lines: number): ChatToolPart {
  return {
    type: 'tool',
    toolCallId: `call-${files}-${lines}`,
    toolName: 'apply_patch',
    toolType: 'file_change',
    state: 'output-available',
    input: { path: 'src/file0.ts' },
    output: diffText(files, lines),
  } as unknown as ChatToolPart;
}

test('the grammar folds an edit turn into diff cells the estimator can size', () => {
  const cells = buildToolCells([editPart(3, 40)]);
  const diffCells = cells.filter((cell) => cell.detail.type === 'diff');

  assert.equal(diffCells.length, 1);
  const detail = diffCells[0]!.detail;
  assert.equal(detail.type, 'diff');
  if (detail.type !== 'diff') return;
  assert.equal(detail.files.length, 3);
});

test('the same parts always fold to the same cells, so a cached estimate stays correct', () => {
  const parts = [editPart(3, 40), editPart(1, 120)];

  const first = buildToolCells(parts);
  const second = buildToolCells(parts);

  // Cheap structural equality: the estimate only reads counts and file lists.
  assert.deepEqual(
    first.map((cell) => cell.detail.type),
    second.map((cell) => cell.detail.type)
  );
  assert.deepEqual(
    first.flatMap((cell) => (cell.detail.type === 'diff' ? cell.detail.files.map((f) => f.path) : [])),
    second.flatMap((cell) => (cell.detail.type === 'diff' ? cell.detail.files.map((f) => f.path) : []))
  );
});
