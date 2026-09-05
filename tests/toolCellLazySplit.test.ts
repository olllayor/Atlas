import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatToolPart } from '../src/shared/contracts.js';
import { buildToolCells } from '../src/shared/toolCellGrammar.js';

test('buildTextDetail handles massive outputs lazily without eager line allocation', () => {
  const lineCount = 10_000;
  const lines: string[] = [];
  for (let i = 1; i <= lineCount; i++) {
    lines.push(`Log entry number ${i}: processing batch payload chunk ${i * 42}`);
  }
  const bigOutput = lines.join('\n');

  const part: ChatToolPart = {
    id: 'part-big',
    type: 'tool',
    toolCallId: 'call-big',
    toolName: 'bash',
    toolType: 'command_execution',
    state: 'output-available',
    input: { command: 'cat massive.log' },
    output: bigOutput,
  } as unknown as ChatToolPart;

  const t0 = performance.now();
  const cells = buildToolCells([part]);
  const elapsedMs = performance.now() - t0;

  assert.equal(cells.length, 1);
  const cell = cells[0];
  assert.equal(cell.detail.type, 'text');
  if (cell.detail.type !== 'text') return;

  // Head lines are the first 5, tail lines are the last 5
  assert.equal(cell.detail.head, 5);
  assert.equal(cell.detail.tail, 5);
  assert.equal(cell.detail.omitted, lineCount - 10);
  assert.equal(cell.detail.lines.length, 10);
  assert.equal(cell.detail.lines[0], 'Log entry number 1: processing batch payload chunk 42');
  assert.equal(cell.detail.lines[4], 'Log entry number 5: processing batch payload chunk 210');
  assert.equal(cell.detail.lines[5], 'Log entry number 9996: processing batch payload chunk 419832');
  assert.equal(cell.detail.lines[9], 'Log entry number 10000: processing batch payload chunk 420000');

  // Must finish rapidly without allocating all 10,000 strings upfront
  assert.ok(elapsedMs < 200, `parsing took ${elapsedMs}ms, expected < 200ms`);

  // When requested, allLines still resolves accurately
  assert.equal(cell.detail.allLines.length, lineCount);
  assert.equal(cell.detail.allLines[500], 'Log entry number 501: processing batch payload chunk 21042');
});
