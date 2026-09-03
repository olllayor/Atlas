import { createServer } from 'vite';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

function calcStats(numbers) {
  if (!numbers || numbers.length === 0) {
    return { mean: 0, p50: 0, p95: 0, max: 0, count: 0 };
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    count: sorted.length,
    mean: Number(mean.toFixed(2)),
    p50: Number(p(0.5).toFixed(2)),
    p95: Number(p(0.95).toFixed(2)),
    max: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
  };
}

async function runBenchmark() {
  console.log('=== Composer Keyboard-to-Paint & React Profiler Benchmark ===');
  console.log('Starting Vite harness server on port 5175...');

  const server = await createServer({
    configFile: path.resolve(projectRoot, 'vite.harness.config.ts'),
    server: { port: 5175, strictPort: true },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5175;
  console.log(`Harness server running at http://localhost:${port}/perf-harness.html`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--enable-features=ExperimentalJavaScriptFeatures', '--no-sandbox'],
  });

  const ITERATIONS = 3;
  const TYPING_PHRASE = 'The quick brown fox jumps over the lazy dog ';
  const allIdleSamples = [];
  const allStreamingSamples = [];

  try {
    for (let run = 1; run <= ITERATIONS; run++) {
      console.log(`\n--- Run ${run} of ${ITERATIONS} ---`);
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on('console', msg => console.log('  [BROWSER CONSOLE]', msg.text()));
      page.on('pageerror', err => console.log('  [BROWSER ERROR]', err.message));

      await page.goto(`http://localhost:${port}/perf-harness.html?autostart=false`, {
        waitUntil: 'networkidle',
      });

      const textarea = page.locator('textarea[aria-label="Message"]');
      await textarea.waitFor({ state: 'visible', timeout: 10000 });

      // Ensure clean state
      await page.evaluate(() => window.harness.clearTypingMetrics());
      await textarea.click();

      // Phase 1: Idle typing
      console.log('  Testing typing while IDLE...');
      await page.keyboard.type(TYPING_PHRASE, { delay: 35 });
      await page.waitForTimeout(200);

      // Phase 2: Active streaming typing
      console.log('  Starting 33ms response stream...');
      await page.evaluate(() => window.harness.startStreaming());

      // Wait until stream has delivered a few flushes
      await page.waitForFunction(() => window.harness.flushCount() >= 6, { timeout: 5000 });
      console.log('  Testing typing while STREAMING...');
      await page.keyboard.type(TYPING_PHRASE, { delay: 35 });
      await page.waitForTimeout(200);

      const metrics = await page.evaluate(() => window.harness.getTypingMetrics());
      console.log(`  Collected: ${metrics.idle.length} idle samples, ${metrics.streaming.length} streaming samples`);

      allIdleSamples.push(...metrics.idle);
      allStreamingSamples.push(...metrics.streaming);

      await context.close();
    }

    console.log('\n======================================================');
    console.log('  TYPING LATENCY RESULTS ACROSS ALL RUNS');
    console.log('======================================================');

    const idleQueue = calcStats(allIdleSamples.map((s) => s.eventQueueMs));
    const streamQueue = calcStats(allStreamingSamples.map((s) => s.eventQueueMs));

    const idleJs = calcStats(allIdleSamples.map((s) => s.syncJsMs));
    const streamJs = calcStats(allStreamingSamples.map((s) => s.syncJsMs));

    const idleCommit = calcStats(allIdleSamples.map((s) => s.composerCommitMs));
    const streamCommit = calcStats(allStreamingSamples.map((s) => s.composerCommitMs));

    const idlePaint = calcStats(allIdleSamples.map((s) => s.keyboardToPaintMs));
    const streamPaint = calcStats(allStreamingSamples.map((s) => s.keyboardToPaintMs));

    console.log(`\nSample counts: Idle = ${allIdleSamples.length} keys, Streaming = ${allStreamingSamples.length} keys`);

    console.log('\n--- 1. Event Loop Queueing Lag (event.timeStamp -> JS handler) ---');
    console.log(`  Idle:      mean ${idleQueue.mean} ms | p50 ${idleQueue.p50} ms | p95 ${idleQueue.p95} ms | max ${idleQueue.max} ms`);
    console.log(`  Streaming: mean ${streamQueue.mean} ms | p50 ${streamQueue.p50} ms | p95 ${streamQueue.p95} ms | max ${streamQueue.max} ms`);

    console.log('\n--- 2. Synchronous Key Handling (Input / DOM mutation) ---');
    console.log(`  Idle:      mean ${idleJs.mean} ms | p50 ${idleJs.p50} ms | p95 ${idleJs.p95} ms | max ${idleJs.max} ms`);
    console.log(`  Streaming: mean ${streamJs.mean} ms | p50 ${streamJs.p50} ms | p95 ${streamJs.p95} ms | max ${streamJs.max} ms`);

    console.log('\n--- 3. Composer React Profiler Commit Duration ---');
    console.log(`  Idle:      mean ${idleCommit.mean} ms | p50 ${idleCommit.p50} ms | p95 ${idleCommit.p95} ms | max ${idleCommit.max} ms`);
    console.log(`  Streaming: mean ${streamCommit.mean} ms | p50 ${streamCommit.p50} ms | p95 ${streamCommit.p95} ms | max ${streamCommit.max} ms`);

    console.log('\n--- 4. Real Keyboard-to-Paint Latency (Keydown -> Frame Presentation) ---');
    console.log(`  Idle:      mean ${idlePaint.mean} ms | p50 ${idlePaint.p50} ms | p95 ${idlePaint.p95} ms | max ${idlePaint.max} ms`);
    console.log(`  Streaming: mean ${streamPaint.mean} ms | p50 ${streamPaint.p50} ms | p95 ${streamPaint.p95} ms | max ${streamPaint.max} ms`);

    console.log('\n======================================================');
  } finally {
    await browser.close();
    await server.close();
    console.log('Benchmark completed cleanly.');
  }
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
