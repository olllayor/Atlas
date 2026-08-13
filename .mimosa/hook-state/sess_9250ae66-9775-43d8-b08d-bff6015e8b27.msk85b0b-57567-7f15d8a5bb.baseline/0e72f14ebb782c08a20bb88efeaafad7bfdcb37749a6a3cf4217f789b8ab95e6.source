import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BoundedCommandOutput,
  COMMAND_OUTPUT_HEAD_LINES,
  COMMAND_OUTPUT_LINE_HEAD_CHARS,
  COMMAND_OUTPUT_LINE_TAIL_CHARS,
  COMMAND_OUTPUT_TAIL_LINES
} from '../src/main/ai/tools/commandOutputCap.js';
import { runCommand } from '../src/main/ai/tools/toolRuntime.js';

/** A lone surrogate survives in a JS string but becomes U+FFFD once encoded. */
function hasBrokenCharacters(value: string) {
  return Buffer.from(value, 'utf8').toString('utf8') !== value;
}

function collect(chunks: string[], byteBudget: number) {
  const sink = new BoundedCommandOutput(byteBudget);

  for (const chunk of chunks) {
    sink.write(chunk);
  }

  return sink;
}

test('output under budget passes through byte-for-byte', () => {
  const text = 'first\nsecond\n\nthird with trailing newline\n';
  const sink = collect(text.split(/(?<=\n)/), 1024);

  assert.equal(sink.toString(), text);
  assert.equal(sink.truncated, false);
});

test('a long single line under budget is not shortened', () => {
  const line = 'x'.repeat(COMMAND_OUTPUT_LINE_HEAD_CHARS + COMMAND_OUTPUT_LINE_TAIL_CHARS + 5_000);
  const sink = collect([line], 64 * 1024);

  assert.equal(sink.toString(), line);
  assert.equal(sink.truncated, false);
});

test('output over budget keeps head and tail and counts the dropped lines', () => {
  const totalLines = 5_000;
  const lines = Array.from({ length: totalLines }, (_unused, index) => `line-${index}`);
  const sink = collect([`${lines.join('\n')}\n`], 1024);
  const result = sink.toString();
  const resultLines = result.split('\n');

  assert.equal(sink.truncated, true);

  const expectedOmitted = totalLines - COMMAND_OUTPUT_HEAD_LINES - COMMAND_OUTPUT_TAIL_LINES;
  const markerIndex = resultLines.findIndex((line) => line.includes('lines omitted'));

  assert.equal(markerIndex, COMMAND_OUTPUT_HEAD_LINES);
  assert.equal(resultLines[markerIndex], `… +${expectedOmitted} lines omitted (output exceeded 1 KiB)`);

  // Head, marker, tail, and the empty in-progress line after the final newline.
  assert.equal(resultLines.length, COMMAND_OUTPUT_HEAD_LINES + 1 + COMMAND_OUTPUT_TAIL_LINES + 1);
  assert.deepEqual(resultLines.slice(0, COMMAND_OUTPUT_HEAD_LINES), lines.slice(0, COMMAND_OUTPUT_HEAD_LINES));
  assert.deepEqual(resultLines.slice(markerIndex + 1, -1), lines.slice(-COMMAND_OUTPUT_TAIL_LINES));
  assert.equal(resultLines.at(-1), '');
  assert.equal(result.includes('line-2500'), false);
});

test('a single newline-free line larger than the budget stays bounded', () => {
  const sink = new BoundedCommandOutput(64 * 1024);
  const chunkSize = 64 * 1024;
  const totalChunks = 80; // ~5 MiB of output with no newline at all.

  for (let index = 0; index < totalChunks; index += 1) {
    sink.write('a'.repeat(chunkSize));
  }

  const result = sink.toString();

  assert.equal(sink.truncated, true);
  assert.ok(
    result.length < COMMAND_OUTPUT_LINE_HEAD_CHARS + COMMAND_OUTPUT_LINE_TAIL_CHARS + 200,
    `expected a bounded buffer, got ${result.length} characters`
  );
  assert.equal(result.startsWith('a'.repeat(COMMAND_OUTPUT_LINE_HEAD_CHARS)), true);
  assert.equal(result.endsWith('a'.repeat(COMMAND_OUTPUT_LINE_TAIL_CHARS)), true);

  const omitted = chunkSize * totalChunks - COMMAND_OUTPUT_LINE_HEAD_CHARS - COMMAND_OUTPUT_LINE_TAIL_CHARS;
  assert.equal(result.includes(`…[${omitted} characters omitted mid-line]…`), true);
});

test('multi-byte characters are never split when a line is trimmed', () => {
  // The leading ASCII character puts every surrogate pair on an odd offset, so
  // both the head cut and the rolling tail cut land inside a pair.
  const line = `a${'\u{1F600}'.repeat(20_000)}b`;
  const sink = collect([line], 1024);
  const result = sink.toString();

  assert.equal(hasBrokenCharacters(result), false);
  assert.equal(result.startsWith(`a${'\u{1F600}'.repeat(999)}`), true);
  assert.equal(result.endsWith(`${'\u{1F600}'.repeat(999)}b`), true);

  for (const character of result.replace(/…\[[^\]]+\]…/, '')) {
    assert.equal(character === 'a' || character === 'b' || character === '\u{1F600}', true);
  }
});

test('multi-byte characters survive chunk boundaries in a real command', async () => {
  const text = '\u{1F600}你好';
  const result = await runCommand(process.execPath, [
    '-e',
    `process.stdout.write(${JSON.stringify(text)}.repeat(50000))`
  ]);

  assert.equal(result.stdoutTruncated, undefined);
  assert.equal(hasBrokenCharacters(result.stdout), false);
  assert.equal(result.stdout, text.repeat(50_000));
});

test('stdout and stderr are budgeted independently', async () => {
  const result = await runCommand(
    process.execPath,
    [
      '-e',
      "for (let i = 0; i < 5000; i += 1) process.stdout.write(`out-${i}\\n`); process.stderr.write('err-only\\n');"
    ],
    { maxOutputBytes: 1024 }
  );

  assert.equal(result.stdoutTruncated, true);
  assert.match(result.stdout, /lines omitted/);
  assert.match(result.stdout, /out-0\n/);
  assert.match(result.stdout, /out-4999\n/);

  assert.equal(result.stderrTruncated, undefined);
  assert.equal(result.stderr, 'err-only\n');
});
