/**
 * Synthesized arena harness, adapted to Atlas types and the real
 * `toolCellGrammar` / registry path. Covers the grafts from SYNTHESIS.md:
 * frozen head identity, ToolStubPart handle, finish/peek, windowed expand.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatToolPart } from '../src/shared/contracts.js';
import { buildToolCells, TOOL_OUTPUT_MAX_LINES } from '../src/shared/toolCellGrammar.js';
import {
  clearToolOutputLineStores,
  createLineStore,
  createToolStubPart,
  finishToolOutputLineStore,
  syncToolOutputLineStore,
  type LineStore,
} from '../src/shared/toolOutputStream.js';

function line(i: number): string {
  return `log-line-${String(i).padStart(5, '0')} payload`;
}

function streamBody(store: LineStore, chunks: string[]): { maxTouched: number; totalAdded: number } {
  let maxTouched = 0;
  let totalAdded = 0;
  for (const chunk of chunks) {
    const m = store.append(chunk);
    if (m.linesTouched > maxTouched) maxTouched = m.linesTouched;
    totalAdded += m.linesAdded;
  }
  return { maxTouched, totalAdded };
}

const part = (overrides: Partial<ChatToolPart>): ChatToolPart =>
  ({
    id: 'part-1',
    type: 'tool',
    toolCallId: 'call-1',
    toolName: 'bash',
    toolType: 'command_execution',
    state: 'output-available',
    input: { command: 'npm test' },
    output: '',
    ...overrides,
  }) as ChatToolPart;

test('append is chunk-local and full text is retained', () => {
  clearToolOutputLineStores();
  const store = createLineStore();
  const N = 10_000;
  const chunks: string[] = [];
  for (let i = 0; i < N; i++) chunks.push(line(i) + '\n');
  chunks.push('err');
  chunks.push('or: tool failed at the end\n');

  const { maxTouched, totalAdded } = streamBody(store, chunks);
  assert.ok(maxTouched <= 3, `maxTouched=${maxTouched}`);
  assert.equal(totalAdded, N + 1);
  assert.equal(store.getLineCount(), N + 1);
  assert.equal(store.getLine(0), line(0));
  assert.equal(store.getLine(N), 'error: tool failed at the end');
});

test('cap stays H+T under stream and freezes head identity', () => {
  clearToolOutputLineStores();
  const store = createLineStore();
  const H = TOOL_OUTPUT_MAX_LINES;
  const T = TOOL_OUTPUT_MAX_LINES;
  const N = 1_000;
  let maxCapRead = 0;
  let headIdentity: readonly string[] | null = null;
  let headIdentityStable = true;

  for (let i = 0; i < N; i++) {
    if (i % 11 === 0) store.append(line(i) + '\n' + line(i + 1) + '\n');
    else store.append(line(i) + '\n');
    const { view, metrics } = store.getCapView(H, T);
    if (metrics.linesRead > maxCapRead) maxCapRead = metrics.linesRead;
    if (view.truncated) {
      assert.equal(view.head.length, H);
      assert.equal(view.tail.length, T);
      assert.equal(view.omitted, view.totalLines - H - T);
      assert.equal(view.head[0], store.getLine(0));
      assert.equal(view.tail[T - 1], store.getLine(view.totalLines - 1));
      if (headIdentity === null) headIdentity = view.head;
      else if (view.head !== headIdentity) headIdentityStable = false;
    }
  }

  store.append('error: connection reset by peer\n');
  const final = store.getCapView(H, T).view;
  assert.ok(final.tail.some((l) => l.includes('error: connection reset')));
  assert.ok(!final.head.some((l) => l.includes('error: connection reset')));
  assert.ok(maxCapRead <= H + T);
  assert.ok(headIdentityStable, 'head array identity must freeze');
});

test('window mounts O(viewport) rows', () => {
  clearToolOutputLineStores();
  const store = createLineStore();
  for (let i = 0; i < 5_000; i++) store.append(line(i) + '\n');
  const rowHeight = 18;
  const viewport = 320;
  const win = store.getWindow(rowHeight, viewport, 0);
  const mid = store.getWindow(rowHeight, viewport, 2_500 * rowHeight);
  const budget = Math.ceil(viewport / rowHeight) + 10;
  assert.ok(win.end - win.start <= budget, `topMounted=${win.end - win.start}`);
  assert.ok(mid.end - mid.start <= budget, `midMounted=${mid.end - mid.start}`);
  assert.equal(win.start, 0);
  assert.ok(mid.start >= 2_500 - 10 && mid.end <= 2_500 + 30);
});

test('ToolStubPart is a handle; finish flushes partial and peek is bounded', () => {
  clearToolOutputLineStores();
  const stub = createToolStubPart('job-1', 'npm test');
  assert.equal(stub.kind, 'tool-stub');
  assert.ok(!JSON.stringify(stub).includes('payload'));

  const store = syncToolOutputLineStore('job-1', 'partA');
  let mid = store.getCapView(2, 2).view;
  assert.equal(mid.peek, 'partA');
  assert.equal(mid.status, 'running');

  syncToolOutputLineStore('job-1', 'partAB\nc-line\ndangl');
  finishToolOutputLineStore('job-1', 'error');
  const after = store.getCapView(2, 2).view;
  assert.equal(after.status, 'error');
  assert.deepEqual([...store.getLines(0, store.getLineCount())], ['partAB', 'c-line', 'dangl']);
  assert.ok((after.peek ?? '').length <= 80);
});

test('registry appends only the prefix delta while output grows', () => {
  clearToolOutputLineStores();
  let text = '';
  let store = syncToolOutputLineStore('stream-1', text);
  let maxTouched = 0;
  for (let i = 0; i < 2_000; i++) {
    text += line(i) + '\n';
    // Every 50 lines, "flush" a cumulative snapshot the way messageParts does.
    if (i % 50 === 49) {
      const before = store.getLineCount();
      store = syncToolOutputLineStore('stream-1', text);
      const added = store.getLineCount() - before;
      // Each sync should only land the new lines, not rebuild the log.
      assert.ok(added <= 55, `sync added ${added} lines at i=${i}`);
      maxTouched = Math.max(maxTouched, added);
    }
  }
  assert.equal(store.getLineCount(), 2_000);
  assert.ok(maxTouched <= 55);
});

test('buildToolCells streams caps without rebuilding allLines eagerly', () => {
  clearToolOutputLineStores();
  const chunks = 40;
  const linesPer = 25;
  let text = '';
  let lastHead: readonly string[] | null = null;
  let headStable = true;

  for (let c = 0; c < chunks; c++) {
    for (let i = 0; i < linesPer; i++) text += `chunk${c} line${i}\n`;
    const cells = buildToolCells([part({ toolCallId: 'call-stream', output: text, state: 'output-partial' })]);
    const detail = cells[0].detail;
    assert.equal(detail.type, 'text');
    if (detail.type !== 'text') return;
    assert.equal(detail.omitted, (c + 1) * linesPer - TOOL_OUTPUT_MAX_LINES * 2);
    assert.ok(detail.running);
    if (lastHead === null) lastHead = detail.source.getCapView(TOOL_OUTPUT_MAX_LINES, TOOL_OUTPUT_MAX_LINES).view.head;
    else {
      const head = detail.source.getCapView(TOOL_OUTPUT_MAX_LINES, TOOL_OUTPUT_MAX_LINES).view.head;
      if (head !== lastHead) headStable = false;
    }
    // Lazy allLines: materializing it is allowed, but the cap path must not need it.
    assert.equal(detail.lines.length, TOOL_OUTPUT_MAX_LINES * 2);
  }

  assert.ok(headStable, 'cap head identity must stay frozen across stream rebuilds');

  // Failure at the end stays in the tail of a text detail (output-available).
  const settled = buildToolCells([
    part({
      toolCallId: 'call-stream',
      output: `${text}FAIL: suite exploded at the end\n`,
      state: 'output-available',
    }),
  ]);
  const detail = settled[0].detail;
  assert.equal(detail.type, 'text');
  if (detail.type !== 'text') return;
  assert.ok(!detail.running);
  assert.ok(detail.allLines[detail.allLines.length - 1].includes('FAIL: suite exploded'));
  assert.ok(detail.lines.some((l) => l.includes('FAIL: suite exploded')));

  // Preserve existing behaviour: output-error still becomes an error detail.
  const failed = buildToolCells([
    part({
      toolCallId: 'call-fail',
      output: 'partial log\n',
      state: 'output-error',
      errorText: 'command failed',
    }),
  ]);
  assert.equal(failed[0].detail.type, 'error');
});
