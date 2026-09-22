/**
 * Large-output streaming benchmark: incremental registry sync + O(H+T) cap
 * versus a naive full re-split every flush.
 *
 * Run: node --import tsx --test tests/toolOutputStreamBench.test.ts
 * (also part of the regular suite; asserts a floor so it cannot silently rot)
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildToolCells, TOOL_OUTPUT_MAX_LINES } from '../src/shared/toolCellGrammar.js';
import {
  clearToolOutputLineStores,
  createLineStore,
  syncToolOutputLineStore,
} from '../src/shared/toolOutputStream.js';
import type { ChatToolPart } from '../src/shared/contracts.js';

function line(i: number): string {
  return `bench-line-${String(i).padStart(6, '0')} payload ${i * 17}`;
}

function splitLinesNaive(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
}

test('large stream: incremental cap beats naive full re-split', () => {
  clearToolOutputLineStores();
  const totalLines = 20_000;
  const flushEvery = 100;

  let text = '';
  let incrementalMs = 0;
  let naiveMs = 0;
  let incrementalWork = 0;
  let naiveWork = 0;

  for (let i = 0; i < totalLines; i++) {
    text += line(i) + '\n';
    if ((i + 1) % flushEvery !== 0) continue;

    const t0 = performance.now();
    const store = syncToolOutputLineStore('bench-stream', text);
    const { view, metrics } = store.getCapView(TOOL_OUTPUT_MAX_LINES, TOOL_OUTPUT_MAX_LINES);
    incrementalMs += performance.now() - t0;
    incrementalWork += metrics.linesRead + flushEvery;

    const t1 = performance.now();
    const all = splitLinesNaive(text);
    const head = all.slice(0, TOOL_OUTPUT_MAX_LINES);
    const tail = all.slice(-TOOL_OUTPUT_MAX_LINES);
    naiveMs += performance.now() - t1;
    naiveWork += all.length;

    assert.equal(view.omitted, all.length - TOOL_OUTPUT_MAX_LINES * 2);
    assert.equal(view.head[0], head[0]);
    assert.equal(view.tail[view.tail.length - 1], tail[tail.length - 1]);
  }

  // buildToolCells on the final snapshot stays in the same ballpark as one
  // cap read (it must not materialize 20k React-facing strings up front).
  const tCell = performance.now();
  const cells = buildToolCells([
    {
      id: 'bench',
      type: 'tool',
      toolCallId: 'bench-cell',
      toolName: 'bash',
      toolType: 'command_execution',
      state: 'output-available',
      input: { command: 'cat huge.log' },
      output: text,
    } as unknown as ChatToolPart,
  ]);
  const cellMs = performance.now() - tCell;
  const detail = cells[0].detail;
  assert.equal(detail.type, 'text');
  if (detail.type === 'text') {
    assert.equal(detail.omitted, totalLines - TOOL_OUTPUT_MAX_LINES * 2);
    assert.equal(detail.lines.length, TOOL_OUTPUT_MAX_LINES * 2);
  }

  const flushes = totalLines / flushEvery;
  console.log(
    JSON.stringify(
      {
        totalLines,
        flushes,
        incrementalMs: Number(incrementalMs.toFixed(2)),
        naiveMs: Number(naiveMs.toFixed(2)),
        speedup: Number((naiveMs / Math.max(incrementalMs, 0.001)).toFixed(1)),
        incrementalWork,
        naiveWork,
        workRatio: Number((naiveWork / Math.max(incrementalWork, 1)).toFixed(1)),
        buildToolCellsMs: Number(cellMs.toFixed(2)),
      },
      null,
      2
    )
  );

  // Floor, not a vibe: incremental path must do far less work than re-splitting.
  assert.ok(naiveWork > incrementalWork * 5, `naiveWork=${naiveWork} incrementalWork=${incrementalWork}`);
  assert.ok(cellMs < 500, `buildToolCells took ${cellMs}ms`);
});

test('windowed expand cost stays O(viewport) on a 50k-line log', () => {
  clearToolOutputLineStores();
  const store = createLineStore();
  let text = '';
  for (let i = 0; i < 50_000; i++) text += line(i) + '\n';
  store.append(text);

  const rowHeight = 18;
  const viewport = 400;
  const t0 = performance.now();
  let mounted = 0;
  for (let scroll = 0; scroll < 50_000; scroll += 200) {
    const win = store.getWindow(rowHeight, viewport, scroll * rowHeight);
    mounted = Math.max(mounted, win.end - win.start);
  }
  const ms = performance.now() - t0;

  assert.ok(mounted <= Math.ceil(viewport / rowHeight) + 10, `mounted=${mounted}`);
  assert.ok(ms < 250, `window sweep took ${ms}ms`);
  console.log(JSON.stringify({ logLines: 50_000, maxMounted: mounted, windowSweepMs: Number(ms.toFixed(2)) }));
});
