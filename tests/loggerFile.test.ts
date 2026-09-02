/**
 * The buffered file writer. The singleton `logger` never calls `configure` in
 * unit tests, so these exercise a dedicated instance against a real temp
 * directory: what lands on disk, in what order, and when.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Logger } from '../src/main/observability/logger';

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function readLog(directory: string) {
  return readFileSync(join(directory, 'main.log'), 'utf8');
}

test('buffered lines land on disk after the tick, in order', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-logger-'));
  const log = new Logger();
  log.configure({ directory });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  log.info('first', { n: 1 });
  log.warn('second', { n: 2 });
  log.info('third');

  // Nothing is required to have been written yet — that is the point of the
  // buffer — but after one tick the whole batch is down, in emit order.
  await tick();
  const lines = readLog(directory).trim().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(JSON.parse(lines[0]!).event, 'first');
  assert.equal(JSON.parse(lines[1]!).event, 'second');
  assert.equal(JSON.parse(lines[2]!).event, 'third');
});

test('flushSync drains the buffer without waiting for the tick', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-logger-'));
  const log = new Logger();
  log.configure({ directory });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  log.info('before-quit');
  log.flushSync();

  assert.equal(readLog(directory).trim().split('\n').length, 1);
});

test('error lines bypass the buffer, but never overtake earlier lines', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-logger-'));
  const log = new Logger();
  log.configure({ directory });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  log.info('turned-into-an-error');
  log.error('provider exploded');

  // Right after the call: no tick needed. The buffered info line went out
  // first because the error flush drains the buffer before writing itself.
  const lines = readLog(directory).trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]!).event, 'turned-into-an-error');
  assert.equal(JSON.parse(lines[1]!).event, 'provider exploded');
});

test('the file rolls and prunes with a tiny injected limit', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-logger-'));
  const log = new Logger();
  log.configure({ directory, maxLogBytes: 200 });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  // First batch overshoots the limit (the roll is lazy: it happens before the
  // write that would cross it, so this batch lands in the fresh file).
  for (let index = 0; index < 30; index += 1) {
    log.info('filler', { index, padding: 'x'.repeat(40) });
  }
  await tick();

  // The next flush sees the tracked size past the limit and rolls first.
  log.info('after-roll');
  await tick();

  const files = readdirSync(directory).filter((name) => name.startsWith('main.log'));
  assert.ok(files.length > 1, 'expected the log to have rolled');
  assert.equal(files.filter((name) => name === 'main.log').length, 1);
  // The live file restarted small: approxSize tracking reset with the roll.
  assert.ok(statSync(join(directory, 'main.log')).size < 200 * 3);
  // And nothing was lost overall: the live file plus rolled ones hold the lines.
  const totalLines = files
    .map((name) => readFileSync(join(directory, name), 'utf8').trim().split('\n').length)
    .reduce((a, b) => a + b, 0);
  assert.equal(totalLines, 31);
});

test('a reconfigured logger starts a fresh size without appending to a stale fd', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-logger-'));
  const log = new Logger();
  log.configure({ directory });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  log.info('one');
  await tick();
  log.configure({ directory });
  log.info('two');
  await tick();

  const lines = readLog(directory).trim().split('\n');
  assert.deepEqual(lines.map((line) => JSON.parse(line).event), ['one', 'two']);
});
