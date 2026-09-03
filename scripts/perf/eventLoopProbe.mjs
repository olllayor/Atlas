/**
 * Measures main-thread event loop delay using Node's perf_hooks.monitorEventLoopDelay.
 *
 * Run it against Electron's Node, not the system one — better-sqlite3 is built
 * for Electron's ABI:
 *
 *   ELECTRON_RUN_AS_NODE=1 npx electron --import tsx scripts/perf/eventLoopProbe.mjs
 * 
 * Records min, mean, p50, p90, p99, and max event-loop lag in milliseconds during
 * typical operations (idle, database query bursts, and child process execution).
 */

import { monitorEventLoopDelay } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAppDatabase } from '../../src/main/db/client.ts';
import { AttachmentStore } from '../../src/main/attachments/AttachmentStore.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

async function runEventLoopProbe() {
  console.log('=== Event Loop Lag Probe (Main Thread) ===\n');

  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();

  /*
    The histogram is sampled by a timer, so it can only see delay that the loop
    lived through. Fully synchronous work blocks the sampler as well and lands
    zero samples — for those phases the honest number is the wall-clock time the
    loop spent blocked, which each phase prints on its own.
  */
  function printHistogram(phaseName) {
    console.log(`--- ${phaseName} ---`);
    if (histogram.count === 0) {
      console.log('  No samples: the loop was blocked for the whole phase.');
      console.log('  Read the wall-clock elapsed time above as the stall instead.\n');
      histogram.reset();
      return;
    }
    console.log(`  Min:  ${(histogram.min / 1e6).toFixed(2)} ms`);
    console.log(`  Mean: ${(histogram.mean / 1e6).toFixed(2)} ms`);
    console.log(`  p50:  ${(histogram.percentile(50) / 1e6).toFixed(2)} ms`);
    console.log(`  p90:  ${(histogram.percentile(90) / 1e6).toFixed(2)} ms`);
    console.log(`  p99:  ${(histogram.percentile(99) / 1e6).toFixed(2)} ms`);
    console.log(`  Max:  ${(histogram.max / 1e6).toFixed(2)} ms\n`);
    histogram.reset();
  }

  // Phase 1: Idle event loop
  await new Promise((resolve) => setTimeout(resolve, 1000));
  printHistogram('1. Idle event loop (1 second)');

  // Phase 2: Rapid SQLite reads/writes (simulating turn persistence)
  const tempDir = mkdtempSync(join(tmpdir(), 'atlas-probe-'));
  try {
    const dbPath = join(tempDir, 'test.db');
    const attachmentStore = new AttachmentStore(join(tempDir, 'attachments'));
    const db = createAppDatabase(dbPath, attachmentStore);

    const t0 = performance.now();
    for (let i = 0; i < 500; i++) {
      db.raw.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(`key-${i}`, JSON.stringify({ index: i, timestamp: Date.now() }));
    }
    const writeElapsed = performance.now() - t0;
    console.log(`Executed 500 SQLite upserts in ${writeElapsed.toFixed(2)} ms (${(writeElapsed / 500).toFixed(3)} ms each, all of it blocking)`);
    printHistogram('2. SQLite rapid write burst (500 upserts)');

    // Phase 3: Subprocess execution (simulating git probe / ps probe)
    const tSub = performance.now();
    for (let i = 0; i < 10; i++) {
      await execFileAsync('/bin/ps', ['-A', '-o', 'pid=,ppid=,comm=']);
    }
    const subElapsed = performance.now() - tSub;
    console.log(`Executed 10 child process ps calls in ${subElapsed.toFixed(2)} ms`);
    printHistogram('3. Subprocess execution (10 ps probes)');

  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    histogram.disable();
  }
}

runEventLoopProbe().catch(console.error);
